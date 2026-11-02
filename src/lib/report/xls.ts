import { isIsoDate } from "@/lib/engine/calendar";
import type { Sheet, SheetCell, SheetDate, SheetPercent, SheetCurrency, SheetStyledValue, SheetVisualStyle } from "./export";
import { escapeXml } from "./xml";

function cellStyle(cell: SheetCell): string {
  if (typeof cell === "object" && cell !== null) {
    switch (cell.kind) {
      case "date": return "date";
      case "percent": return "percent";
      case "currency": return "currency";
      case "styled": {
        const styles: Record<SheetVisualStyle, string> = {
          ganttPhase: "phaseBar",
          ganttPlanned: "ganttBar",
          ganttCritical: "criticalBar",
          ganttComplete: "completeBar",
          ganttMilestone: "milestoneBar",
        };
        return styles[cell.style];
      }
    }
  }
  return typeof cell === "number" && Number.isInteger(cell) ? "integer" : "cell";
}

function cellData(cell: SheetCell): { type: "String" | "Number" | "DateTime"; value: string | number } | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? { type: "Number", value: cell } : null;
  if (typeof cell !== "object") return { type: "String", value: cell };

  switch (cell.kind) {
    case "date":
      return isIsoDate(cell.value)
        ? { type: "DateTime", value: `${cell.value}T00:00:00.000` }
        : { type: "String", value: cell.value };
    case "percent":
      return Number.isFinite(cell.value) ? { type: "Number", value: cell.value / 100 } : null;
    case "currency":
      return Number.isFinite(cell.value) ? { type: "Number", value: cell.value } : null;
    case "styled":
      return typeof cell.value === "number" && Number.isFinite(cell.value)
        ? { type: "Number", value: cell.value }
        : { type: "String", value: cell.value };
  }
}

function widthPoints(width: number): number {
  return Math.max(32, Math.min(560, width * 7));
}

function buildWorksheet(sheet: Sheet): string {
  if (!sheet.headers.length) throw new Error(`Worksheet "${sheet.name}" must have at least one column`);
  const filterColumns = Math.max(0, Math.min(sheet.filterColumnCount ?? sheet.headers.length, sheet.headers.length));
  const rowCount = sheet.rows.length + 1;
  const columns = sheet.headers
    .map((_, index) => {
      const width = sheet.columns?.[index]?.width ?? 18;
      return `<Column ss:AutoFitWidth="0" ss:Width="${widthPoints(width).toFixed(1)}"/>`;
    })
    .join("");
  const header = `<Row ss:AutoFitHeight="1" ss:Height="30">${sheet.headers
    .map((value) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`)
    .join("")}</Row>`;
  const rows = sheet.rows
    .map((row) => {
      const cells = sheet.headers
        .map((_, index) => {
          const cell = row[index] ?? "";
          const data = cellData(cell);
          if (!data) return "<Cell/>";
          return `<Cell ss:StyleID="${cellStyle(cell)}"><Data ss:Type="${data.type}">${escapeXml(data.value)}</Data></Cell>`;
        })
        .join("");
      return `<Row ss:AutoFitHeight="1">${cells}</Row>`;
    })
    .join("");
  const autoFilter = filterColumns
    ? `<x:AutoFilter x:Range="R1C1:R${rowCount}C${filterColumns}"/>`
    : "";
  const freezeColumns = Math.max(0, Math.min(sheet.freezeColumns ?? 0, sheet.headers.length - 1));
  const freeze = `<FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal>${freezeColumns ? `<SplitVertical>${freezeColumns}</SplitVertical>` : ""}<TopRowBottomPane>1</TopRowBottomPane><LeftColumnRightPane>${freezeColumns}</LeftColumnRightPane><ActivePane>${freezeColumns ? 3 : 2}</ActivePane>`;

  return `<Worksheet ss:Name="${escapeXml(sheet.name)}">
  <Table ss:ExpandedColumnCount="${sheet.headers.length}" ss:ExpandedRowCount="${rowCount}" x:FullColumns="1" x:FullRows="1" ss:DefaultRowHeight="20">${columns}${header}${rows}</Table>
  ${autoFilter}
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/>${freeze}<DisplayRightToLeft/><FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight><PaperSizeIndex>9</PaperSizeIndex></Print><PageSetup><Layout x:Orientation="${sheet.headers.length > 8 ? "Landscape" : "Portrait"}" x:FitToPage="1"/><Header x:Margin="0.2"/><Footer x:Margin="0.2"/><PageMargins x:Bottom="0.5" x:Left="0.25" x:Right="0.25" x:Top="0.5"/></PageSetup></WorksheetOptions>
</Worksheet>`;
}

const STYLES = `<Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Vazirmatn" ss:Size="10"/><Interior/><NumberFormat/><Protection/></Style>
  <Style ss:ID="hdr"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Vazirmatn" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#123A5C" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#123A5C"/></Borders></Style>
  <Style ss:ID="cell"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Vazirmatn" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE3EA"/></Borders></Style>
  <Style ss:ID="integer" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0;[Red]-#,##0"/></Style>
  <Style ss:ID="number" ss:Parent="cell"><NumberFormat ss:Format="#,##0.##;[Red]-#,##0.##"/></Style>
  <Style ss:ID="currency" ss:Parent="cell"><NumberFormat ss:Format="#,##0.00;[Red]-#,##0.00"/></Style>
  <Style ss:ID="percent" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
  <Style ss:ID="date" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="yyyy-mm-dd"/></Style>
  <Style ss:ID="ganttBar" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/></Style>
  <Style ss:ID="criticalBar" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#FECACA" ss:Pattern="Solid"/></Style>
  <Style ss:ID="completeBar" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style>
  <Style ss:ID="milestoneBar" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#92400E"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="phaseBar" ss:Parent="cell"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Interior ss:Color="#E8EEF5" ss:Pattern="Solid"/></Style>
</Styles>`;

/** SpreadsheetML 2003 workbook (`.xls` compatibility format), not BIFF. */
export function buildExcelXml(sheets: Sheet[]): string {
  if (!sheets.length) throw new Error("An Excel 2003 workbook must contain at least one sheet");
  const worksheets = sheets.map(buildWorksheet).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel">
  ${STYLES}
  ${worksheets}
</Workbook>`;
}
