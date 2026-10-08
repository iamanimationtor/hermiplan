import { createZip, type ZipEntry } from "./zip";
import type { Sheet } from "./export";

/**
 * Office Open XML (xlsx) workbook writer — no external dependencies.
 * Produces a genuine Excel file with styled headers, RTL sheets, frozen
 * header rows and auto column widths.
 */

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

function buildSheet(sheet: Sheet, index: number): string {
  const columns = sheet.headers.length;
  const rows: string[] = [];

  rows.push(
    `<Row r="1">${sheet.headers
      .map(
        (header, i) =>
          `<c r="${columnName(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(header)}</t></is></c>`,
      )
      .join("")}</Row>`,
  );

  sheet.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = row
      .map((cell, i) => {
        const ref = `${columnName(i)}${r}`;
        if (typeof cell === "number" && Number.isFinite(cell)) {
          return `<c r="${ref}" s="3"><v>${cell}</v></c>`;
        }
        return `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell ?? ""))}</t></is></c>`;
      })
      .join("");
    rows.push(`<Row r="${r}">${cells}</Row>`);
  });

  const cols = Array.from({ length: columns }, (_, i) => {
    const headerWidth = Math.max(...[sheet.headers[i]?.length ?? 8, 12]);
    const sample = Math.max(...sheet.rows.slice(0, 60).map((row) => String(row[i] ?? "").length), 10);
    const width = Math.min(Math.max(headerWidth, sample) * 1.1 + 2, 46);
    return `<col min="${i + 1}" max="${i + 1}" width="${width.toFixed(1)}" customWidth="1"/>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView rightToLeft="1" tabSelected="${index === 0 ? 1 : 0}" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19" baseColWidth="12"/>
  <cols>${cols}</cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A1:${columnName(columns - 1)}${sheet.rows.length + 1}"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="10"/><name val="Vazirmatn"/></font>
    <font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Vazirmatn"/></font>
    <font><sz val="10"/><color rgb="FF1F2937"/><name val="Vazirmatn"/></font>
    <font><b/><sz val="10"/><color rgb="FF12335A"/><name val="Vazirmatn"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF12335A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD7DEE6"/></left><right style="thin"><color rgb="FFD7DEE6"/></right><top style="thin"><color rgb="FFD7DEE6"/></top><bottom style="thin"><color rgb="FFD7DEE6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="4" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Builds a real .xlsx file (Uint8Array) from the report sheets. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
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
</Relationships>`,
  });

  entries.push({
    name: "xl/workbook.xml",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/>
  <bookViews><workbookView rightToLeft="1" xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>
    ${names
      .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("\n    ")}
  </sheets>
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

  return createZip(entries);
}
