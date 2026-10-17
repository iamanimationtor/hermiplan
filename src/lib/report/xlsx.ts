import { createZip, type ZipEntry } from "./zip";
import {
  type Sheet,
  type SheetCell,
  type SheetDate,
  type SheetPercent,
  type SheetCurrency,
  type SheetStyledValue,
  type SheetVisualStyle,
} from "./export";
import { escapeXml } from "./xml";
import { isIsoDate } from "@/lib/engine/calendar";

const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;
const EXCEL_UNIX_EPOCH = 25_569;
const MAX_CELL_TEXT_LENGTH = 32_767;

function columnName(index: number): string {
  let n = index;
  let label = "";
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function dateSerial(value: string): number | null {
  if (!isIsoDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) + EXCEL_UNIX_EPOCH;
}

function isObject(value: SheetCell): value is SheetDate | SheetPercent | SheetCurrency | SheetStyledValue {
  return typeof value === "object" && value !== null;
}

function cellText(cell: SheetCell): string {
  if (cell === null) return "";
  if (typeof cell !== "object") return String(cell);
  return String(cell.value);
}

function uniqueSheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    const clean = Array.from(sheet.name.replace(/[\\/*?:\[\]]/g, " ").replace(/^'+|'+$/g, "").trim())
      .slice(0, 31)
      .join("");
    const base = clean || `Sheet${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      const ending = ` (${suffix++})`;
      candidate = `${Array.from(base).slice(0, Math.max(1, 31 - ending.length)).join("")}${ending}`;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  });
}

function styleId(cell: SheetCell, rowIndex: number): number {
  if (isObject(cell)) {
    if (cell.kind === "date") return 8;
    if (cell.kind === "percent") return 7;
    if (cell.kind === "currency") return 6;
    const styles: Record<SheetVisualStyle, number> = {
      ganttPhase: 13,
      ganttPlanned: 9,
      ganttCritical: 10,
      ganttComplete: 11,
      ganttMilestone: 12,
    };
    return styles[cell.style];
  }
  if (typeof cell === "number") return Number.isInteger(cell) ? 5 : 4;
  return rowIndex % 2 === 0 ? 2 : 3;
}

function excelValue(cell: SheetCell): { type: "inlineStr" | "number"; value: string | number } | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return null;
    return { type: "number", value: Object.is(cell, -0) ? 0 : cell };
  }
  if (typeof cell !== "object") {
    const text = String(cell);
    if (!text) return null;
    return { type: "inlineStr", value: Array.from(text).slice(0, MAX_CELL_TEXT_LENGTH).join("") };
  }

  switch (cell.kind) {
    case "date": {
      const serial = dateSerial(cell.value);
      return serial === null ? { type: "inlineStr", value: cell.value } : { type: "number", value: serial };
    }
    case "percent":
      return Number.isFinite(cell.value) ? { type: "number", value: cell.value / 100 } : null;
    case "currency":
      return Number.isFinite(cell.value) ? { type: "number", value: cell.value } : null;
    case "styled":
      return typeof cell.value === "number" && Number.isFinite(cell.value)
        ? { type: "number", value: cell.value }
        : { type: "inlineStr", value: Array.from(String(cell.value)).slice(0, MAX_CELL_TEXT_LENGTH).join("") };
  }
}

function displayWidth(value: string): number {
  return Array.from(value.replace(/[\r\n]+/g, " ")).reduce((width, character) => {
    const code = character.codePointAt(0) ?? 0;
    // CJK, Hangul, Arabic/Persian and full-width glyphs generally occupy more
    // space than ASCII in common spreadsheet fonts.
    return width + (code >= 0x2e80 ? 1.8 : 1);
  }, 0);
}

function columnWidths(sheet: Sheet): number[] {
  return sheet.headers.map((header, columnIndex) => {
    const configured = sheet.columns?.[columnIndex]?.width;
    if (typeof configured === "number" && Number.isFinite(configured)) {
      return Math.max(4, Math.min(80, configured));
    }
    let best = Math.max(12, displayWidth(header) + 2);
    for (const row of sheet.rows.slice(0, 100)) {
      best = Math.max(best, Math.min(60, displayWidth(cellText(row[columnIndex] ?? "")) + 2));
    }
    return Math.max(10, Math.min(48, best));
  });
}

function rowHeight(row: SheetCell[], widths: number[]): number {
  let lineCount = 1;
  row.forEach((cell, index) => {
    const text = cellText(cell);
    const width = Math.max(4, widths[index] ?? 12);
    const lines = text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(displayWidth(line) / width)), 0);
    lineCount = Math.max(lineCount, lines);
  });
  // Excel's maximum row height is 409.5 pt. Content remains intact in the cell
  // even when a very long note exceeds the maximum visible height.
  return Math.min(409.5, Math.max(20, lineCount * 15 + 4));
}

function buildSheet(sheet: Sheet, index: number): string {
  if (!sheet.headers.length) throw new Error(`Worksheet "${sheet.name}" must have at least one column`);
  if (sheet.headers.length > MAX_COLUMNS) throw new RangeError(`Worksheet "${sheet.name}" exceeds Excel's column limit`);
  if (sheet.rows.length + 1 > MAX_ROWS) throw new RangeError(`Worksheet "${sheet.name}" exceeds Excel's row limit`);

  const lastColumn = columnName(sheet.headers.length - 1);
  const lastRow = sheet.rows.length + 1;
  const widths = columnWidths(sheet);
  const freezeColumns = Math.max(0, Math.min(sheet.freezeColumns ?? 0, sheet.headers.length - 1));
  const activeCell = freezeColumns ? `${columnName(freezeColumns)}2` : "A2";
  const activePane = freezeColumns ? "bottomRight" : "bottomLeft";
  const filterColumns = Math.max(0, Math.min(sheet.filterColumnCount ?? sheet.headers.length, sheet.headers.length));

  const headerCells = sheet.headers
    .map((header, columnIndex) => {
      const value = Array.from(String(header ?? "")).slice(0, MAX_CELL_TEXT_LENGTH).join("");
      const ref = `${columnName(columnIndex)}1`;
      return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    })
    .join("");

  const bodyRows = sheet.rows.map((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = sheet.headers
      .map((_, columnIndex) => {
        const cell = row[columnIndex] ?? "";
        const resolved = excelValue(cell);
        if (!resolved) return "";
        const ref = `${columnName(columnIndex)}${r}`;
        const style = styleId(cell, rowIndex);
        if (resolved.type === "number") {
          return `<c r="${ref}" s="${style}"><v>${resolved.value}</v></c>`;
        }
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(resolved.value)}</t></is></c>`;
      })
      .join("");
    const height = rowHeight(row, widths);
    return `<row r="${r}" ht="${height.toFixed(1)}" customHeight="1">${cells}</row>`;
  });

  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width.toFixed(1)}" customWidth="1"/>`)
    .join("");
  const filter = filterColumns
    ? `<autoFilter ref="A1:${columnName(filterColumns - 1)}${lastRow}"/>`
    : "";
  const printFitWidth = sheet.name === "Gantt" ? 0 : 1;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" rightToLeft="1" tabSelected="${index === 0 ? 1 : 0}" workbookViewId="0"><pane xSplit="${freezeColumns}" ySplit="1" topLeftCell="${activeCell}" activePane="${activePane}" state="frozen"/><selection pane="${activePane}" activeCell="${activeCell}" sqref="${activeCell}"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20" baseColWidth="12"/>
  <cols>${cols}</cols>
  <sheetData><row r="1" ht="34" customHeight="1">${headerCells}</row>${bodyRows.join("")}</sheetData>
  ${filter}
  <printOptions horizontalCentered="0" verticalCentered="0"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="9" orientation="${sheet.name === "Gantt" || sheet.headers.length > 8 ? "landscape" : "portrait"}" fitToWidth="${printFitWidth}" fitToHeight="0"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="#,##0.##;[Red]-#,##0.##"/>
    <numFmt numFmtId="165" formatCode="#,##0.00;[Red]-#,##0.00"/>
    <numFmt numFmtId="166" formatCode="0.0%"/>
    <numFmt numFmtId="167" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="10"/><name val="Vazirmatn"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Vazirmatn"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF12335A"/><name val="Vazirmatn"/><family val="2"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF12335A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFECACA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD7DEE6"/></left><right style="thin"><color rgb="FFD7DEE6"/></right><top style="thin"><color rgb="FFD7DEE6"/></top><bottom style="thin"><color rgb="FFD7DEE6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="14">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Builds a standards-based .xlsx Office Open XML workbook from report sheets. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  if (!sheets.length) throw new Error("An Excel workbook must contain at least one non-empty sheet");

  const names = uniqueSheetNames(sheets);
  const entries: ZipEntry[] = [];
  const safeSheets = sheets.map((sheet, index) => ({ ...sheet, name: names[index] }));

  entries.push({
    name: "[Content_Types].xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${safeSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`,
  });

  entries.push({
    name: "_rels/.rels",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  entries.push({
    name: "xl/workbook.xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000" activeTab="0"/></bookViews>
  <sheets>${safeSheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n    ")}
  </sheets>
  <definedNames>${safeSheets.map((_, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${escapeXml(names[i].replace(/'/g, "''"))}'!$1:$1</definedName>`).join("\n    ")}</definedNames>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`,
  });

  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
  <Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });

  entries.push({ name: "xl/styles.xml", content: STYLES });
  safeSheets.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: buildSheet(sheet, index) });
  });

  return createZip(entries, { compressionLevel: 6 });
}
