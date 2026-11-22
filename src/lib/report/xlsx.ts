import { createZip, type ZipEntry } from "./zip";
import type { ColumnKind, Sheet } from "./export";

/**
 * Office Open XML (xlsx) workbook writer — no external dependencies.
 *
 * ## Why this is written by hand
 *
 * The export must work on a serverless function with no binary add-ons, and a
 * generated workbook has a very narrow job: styled, filterable, RTL tables that
 * open in Excel, LibreOffice, Numbers and Google Sheets without a repair
 * prompt. That is a few hundred lines of SpreadsheetML, so the project carries
 * no spreadsheet dependency.
 *
 * ## Correctness rules encoded here
 *
 * 1. Element names are **lower-case** exactly as the SpreadsheetML schema
 *    requires (`<row>`, not `<Row>`) — a capitalised tag makes Excel offer to
 *    "repair" the file and silently drop every style.
 * 2. Attributes belong to the element that owns them: right-to-left is a
 *    `sheetView` attribute, *never* a `workbookView` one. A stray
 *    `<workbookView rightToLeft="1">` made strict readers (openpyxl) reject the
 *    whole workbook.
 * 3. Every numeric column carries its own `numFmt` — money with thousands
 *    separators, percentages with one decimal, days/indices as integers. A
 *    single global format turned "2 days" into "2.00" and made budget columns
 *    read as decimals.
 * 4. Text columns are written as inline strings so the file needs no shared
 *    string table, and are marked with `quotePrefix`-safe content: any cell that
 *    starts with `=`, `+`, `-`, `@` is forced to text so a project name can
 *    never become a live formula (CWE-1236).
 * 5. Sheets carry a frozen header, an auto-filter over the used range, sensible
 *    per-column widths measured in *display* width (Persian text is wide), RTL
 *    reading order, and a print setup (A4 landscape, fit to width) that matches
 *    what the report prints.
 */

/** Upper bound for a column width (Excel's own limit is 255, 60 is readable). */
const MAX_COL_WIDTH = 58;
const MIN_COL_WIDTH = 9;

const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const sheetName = (name: string, index: number) => {
  const cleaned = name.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28);
  return cleaned || `Sheet${index + 1}`;
};

function columnName(index: number): string {
  let n = index;
  let label = "";
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * Display width of a cell, in "Excel characters".
 *
 * Persian glyphs are wider than Latin ones and a digit is narrower than an
 * average letter, so a plain `String.length` produces columns that are visibly
 * too narrow for the very content they were measured on.
 */
function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x0600 && code <= 0x06ff) width += 1.35; // Arabic/Persian block
    else if (code >= 0x0660 && code <= 0x06f9) width += 0.8; // Persian digits
    else if (/[0-9]/.test(char)) width += 0.62;
    else if (/[A-Z]/.test(char)) width += 0.85;
    else if (/[a-z]/.test(char)) width += 0.72;
    else if (char === " ") width += 0.4;
    else width += 0.78;
  }
  return width;
}

/**
 * Style ids, in `cellXfs` order.
 *
 * Each id maps to a `numFmtId` in the stylesheet below: 49 `@` (text), 1 `0`
 * (integer), 164 `0.0` (one decimal), 3 `#,##0` (money), 165 `0.0%` (percent —
 * applied to the 0..1 fractions produced by `percentColumnsAsFractions`), and 14
 * (date serial). Keeping the map named means a cell's style cannot drift from
 * the stylesheet the way bare magic numbers do.
 */
const STYLE = {
  header: 1,
  text: 2,
  textAlt: 3,
  integer: 4,
  integerAlt: 5,
  decimal: 6,
  decimalAlt: 7,
  money: 8,
  moneyAlt: 9,
  percent: 10,
  percentAlt: 11,
  date: 12,
  dateAlt: 13,
} as const;

const KIND_STYLE: Record<ColumnKind, { base: number; alt: number }> = {
  text: { base: STYLE.text, alt: STYLE.textAlt },
  wbs: { base: STYLE.text, alt: STYLE.textAlt },
  integer: { base: STYLE.integer, alt: STYLE.integerAlt },
  decimal: { base: STYLE.decimal, alt: STYLE.decimalAlt },
  money: { base: STYLE.money, alt: STYLE.moneyAlt },
  percent: { base: STYLE.percent, alt: STYLE.percentAlt },
  date: { base: STYLE.date, alt: STYLE.dateAlt },
};

/** ISO `yyyy-mm-dd` → Excel serial day number (1900 date system). */
function excelSerial(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utc)) return null;
  // 1899-12-30 is Excel's day 0 (it keeps Lotus' phantom 1900-02-29).
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const isFormulaWord = (value: string) => /^[=+@]/.test(value) || (value.startsWith("-") && !/^-\d/.test(value));

function buildSheet(sheet: Sheet, index: number): string {
  const columns = sheet.headers.length;
  const kinds: ColumnKind[] = Array.from({ length: columns }, (_, i) => sheet.columnKinds?.[i] ?? "text");
  const rows: string[] = [];

  rows.push(
    `<row r="1" ht="30" customHeight="1" s="0" customFormat="1">${sheet.headers
      .map(
        (header, i) =>
          `<c r="${columnName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${xml(header)}</t></is></c>`,
      )
      .join("")}</row>`,
  );

  sheet.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const alt = rowIndex % 2 === 1;
    const cells = row
      .map((cell, i) => {
        const ref = `${columnName(i)}${r}`;
        const kind = kinds[i] ?? "text";
        const style = alt ? KIND_STYLE[kind].alt : KIND_STYLE[kind].base;

        if (kind === "date") {
          const serial = typeof cell === "string" ? excelSerial(cell) : null;
          // A date column that receives a non-date keeps the text, not a fake
          // serial — a wrong date is worse than an unformatted one.
          if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
          return `<c r="${ref}" s="${alt ? STYLE.textAlt : STYLE.text}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell ?? ""))}</t></is></c>`;
        }

        if (kind !== "text" && kind !== "wbs" && typeof cell === "number" && Number.isFinite(cell)) {
          return `<c r="${ref}" s="${style}"><v>${cell}</v></c>`;
        }

        const text = String(cell ?? "");
        // Defuse spreadsheet formulas in text cells (project names, notes …).
        const safe = isFormulaWord(text) ? `'${text}` : text;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(safe)}</t></is></c>`;
      })
      .join("");
    rows.push(`<row r="${r}">${cells}</row>`);
  });

  const cols = Array.from({ length: columns }, (_, i) => {
    const headerWidth = displayWidth(sheet.headers[i] ?? "");
    const sample = Math.max(
      ...sheet.rows.slice(0, 200).map((row) => {
        const value = row[i];
        if (typeof value === "number") return displayWidth(value.toLocaleString("en-US"));
        if ((kinds[i] ?? "text") === "date") return 10.5;
        return displayWidth(String(value ?? ""));
      }),
      8,
    );
    const width = Math.min(Math.max(headerWidth, sample) + 2.5, MAX_COL_WIDTH);
    const clamped = Math.max(width, MIN_COL_WIDTH);
    return `<col min="${i + 1}" max="${i + 1}" width="${clamped.toFixed(1)}" customWidth="1"/>`;
  }).join("");

  const lastCell = `${columnName(columns - 1)}${sheet.rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView rightToLeft="1" tabSelected="${index === 0 ? 1 : 0}" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19" baseColWidth="12"/>
  <cols>${cols}</cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A1:${lastCell}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/**
 * Stylesheet.
 *
 * Two visual variants per column kind: a plain row and a banded row, so long
 * tables stay readable when printed. Money uses `#,##0` (IRR amounts are whole
 * rials — decimals would be noise), percent uses `0.0%` and dates use the
 * Persian-friendly `yyyy-mm-dd` that the rest of the product prints.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
  <fonts count="3">
    <font><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF12335A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F6FA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD7DEE6"/></left><right style="thin"><color rgb="FFD7DEE6"/></right><top style="thin"><color rgb="FFD7DEE6"/></top><bottom style="thin"><color rgb="FFD7DEE6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="1" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="1" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="14" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="14" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;


/**
 * Builds a real .xlsx file (Uint8Array) from the report sheets.
 *
 * The workbook is deterministic: the same sheets and `modified` date produce
 * byte-identical output, which is what makes "is this the same file?" and
 * cache validation meaningful.
 */
export function buildXlsx(sheets: Sheet[], modified?: Date): Uint8Array {
  const names = sheets.map((sheet, index) => sheetName(sheet.name, index));
  const entries: ZipEntry[] = [];

  entries.push({
    name: "[Content_Types].xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("\n  ")}
</Types>`,
  });

  entries.push({
    name: "_rels/.rels",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  });

  const stamp = (modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  entries.push({
    name: "docProps/core.xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>HERMIPLAN — ${xml(sheets[0]?.rows[0]?.[1] !== undefined ? String(sheets[0].rows[0][1]) : "Project workbook")}</dc:title>
  <dc:creator>HERMIPLAN — Mohammad Shirmardi</dc:creator>
  <cp:lastModifiedBy>HERMIPLAN</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>`,
  });

  entries.push({
    name: "docProps/app.xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>HERMIPLAN</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${xml(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts>
</Properties>`,
  });

  entries.push({
    name: "xl/workbook.xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0" defaultThemeVersion="164011"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>
    ${names
      .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("\n    ")}
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`,
  });

  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("\n  ")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });

  entries.push({ name: "xl/styles.xml", content: STYLES });
  sheets.forEach((sheet, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, content: buildSheet(sheet, i) });
  });

  return createZip(entries, modified);
}
