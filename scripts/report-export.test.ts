import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { analyzeProject } from "@/lib/engine/analysis";
import { buildProjectFromTemplate } from "@/lib/templates";
import { DEFAULT_REPORT_SECTIONS, REPORT_SECTIONS } from "@/lib/validation";
import { buildCsv, buildSheets, currencyCell, dateCell, percentCell, styledCell } from "@/lib/report/export";
import { buildReportHtml } from "@/lib/report/html";
import { buildDeliveryPackage } from "@/lib/report/package";
import { buildExcelXml } from "@/lib/report/xls";
import { buildXlsx } from "@/lib/report/xlsx";
import { crc32 } from "@/lib/report/zip";
import type { ProjectInput } from "@/lib/engine/types";

function readZipEntries(archive: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= archive.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    const compressed = archive.subarray(contentStart, contentEnd);
    const content = method === 0 ? compressed : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : null;
    assert.ok(content, `unsupported ZIP compression method ${method} in ${name}`);
    assert.equal(content.length, uncompressedSize, `uncompressed size mismatch for ${name}`);
    assert.equal(crc32(content), expectedCrc, `CRC mismatch for ${name}`);
    entries.set(name, content);
    offset = contentEnd;
  }
  assert.ok(entries.size > 0, "ZIP contains at least one local-file entry");
  return entries;
}

function zipTextEntry(entries: Map<string, Uint8Array>, name: string): string {
  const entry = entries.get(name);
  assert.ok(entry, `ZIP entry not found: ${name}`);
  return new TextDecoder().decode(entry);
}

function excelJsInput(bytes: Uint8Array): ArrayBuffer {
  // ExcelJS 4.x declares ArrayBuffer here; a copied byte buffer is supported by JSZip at runtime.
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function makeProject(): ProjectInput {
  const project = buildProjectFromTemplate("construction");
  const originalAnalysis = analyzeProject(project);
  project.baseline = {
    name: "Baseline 1405",
    createdAt: "2026-03-21T08:00:00.000Z",
    activities: originalAnalysis.activities.map((activity) => ({
      activityId: activity.id,
      startDate: activity.startDate,
      finishDate: activity.finishDate,
      duration: activity.duration,
      cost: activity.budgetCost,
    })),
  };
  project.meta.name = "پروژه خروجی حرفه‌ای — HERMIPLAN ۱۴۰۵";
  project.meta.description = "ترکیب فارسی و English؛ برای بررسی فایل‌های خروجی";
  project.meta.budget = 9_876_543_210;
  project.meta.deadline = "2026-12-21";
  project.calendar.holidays = ["2026-05-01", "2026-06-01"];
  project.activities[0].duration += 1;
  project.activities[0].name = `اجرای سازه / Long activity name — ${"نام طولانی ".repeat(12)}`;
  project.activities[0].progress = 42.5;
  project.activities[0].actualCost = 12_345_678;
  project.activities[0].constraintType = "SNET";
  project.activities[0].constraintDate = "2026-04-12";
  project.activities[0].deliverable = "گزارش نهایی + shop drawing؛ drawing pack";
  project.activities[0].notes = '=HYPERLINK("https://example.invalid", "unsafe formula") — یادداشت فارسی';
  project.resources[0].type = "material";
  project.resources[0].capacity = 0;
  project.resources[0].unit = "کیلوگرم";
  if (project.risks[0]) project.risks[0].mitigation = `برنامه کاهش ریسک ${"با متن طولانی ".repeat(12)}`;
  return project;
}

async function main() {
  const project = makeProject();
  const analysis = analyzeProject(project);
  const sheets = buildSheets(analysis, project);
  const workbookBytes = buildXlsx(sheets);
  const workbookEntries = readZipEntries(workbookBytes);

  // Check the generated file with a separate spreadsheet reader, not only by
  // looking at HTTP status or searching the raw XML strings.
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelJsInput(workbookBytes));
  assert.ok(workbook.worksheets.length >= 10, "real multi-sheet workbook loaded by ExcelJS");
  assert.ok(workbook.worksheets.every((sheet) => sheet.rowCount >= 1 && sheet.columnCount >= 1), "no worksheet is blank");
  assert.ok(workbook.worksheets.some((sheet) => sheet.name === "Dependencies"));
  assert.ok(workbook.worksheets.some((sheet) => sheet.name === "Assignments"));
  assert.ok(workbook.worksheets.some((sheet) => sheet.name === "Baseline"));
  assert.ok(workbook.worksheets.some((sheet) => sheet.name === "Gantt"));

  const baselineSheet = workbook.getWorksheet("Baseline");
  assert.ok(baselineSheet);
  const baselineHeaders = Array.from({ length: baselineSheet.columnCount }, (_, index) =>
    String(baselineSheet.getRow(1).getCell(index + 1).value ?? ""),
  );
  const baselineRow = Array.from({ length: baselineSheet.rowCount - 1 }, (_, index) => index + 2).find(
    (row) => baselineSheet.getCell(row, 1).value === project.activities[0].id,
  );
  assert.ok(baselineRow, "baseline includes the source activity");
  const finishVarianceColumn = baselineHeaders.indexOf("انحراف پایان (روز تقویمی)") + 1;
  const baselineActivity = project.baseline!.activities.find((activity) => activity.activityId === project.activities[0].id)!;
  const currentActivity = analysis.activities.find((activity) => activity.id === project.activities[0].id)!;
  const expectedFinishVariance = Math.round((Date.parse(`${currentActivity.finishDate}T00:00:00Z`) - Date.parse(`${baselineActivity.finishDate}T00:00:00Z`)) / 86_400_000);
  assert.equal(baselineSheet.getCell(baselineRow, finishVarianceColumn).value, expectedFinishVariance, "finish variance is current finish minus baseline finish, not duration variance");

  const activitySheet = workbook.getWorksheet("Activities");
  assert.ok(activitySheet, "Activities sheet exists");
  const headers = Array.from({ length: activitySheet.columnCount }, (_, index) =>
    String(activitySheet.getRow(1).getCell(index + 1).value ?? ""),
  );
  const column = (header: string) => {
    const index = headers.indexOf(header);
    assert.ok(index >= 0, `Activities sheet contains column ${header}`);
    return index + 1;
  };
  const activityId = project.activities[0].id;
  const rowNumber = Array.from({ length: activitySheet.rowCount - 1 }, (_, index) => index + 2).find(
    (row) => activitySheet.getCell(row, column("شناسه فعالیت")).value === activityId,
  );
  assert.ok(rowNumber, "source activity row is present");
  const expectedActivity = analysis.activities.find((activity) => activity.id === activityId);
  assert.ok(expectedActivity);
  const dateValue = activitySheet.getCell(rowNumber, column("شروع (Excel / Gregorian)")).value;
  assert.ok(dateValue instanceof Date, "Excel start date is a native date cell, not an inline string");
  assert.equal(dateValue.toISOString().slice(0, 10), expectedActivity.startDate, "date round-trips without timezone shift");
  assert.equal(activitySheet.getCell(rowNumber, column("شروع (Excel / Gregorian)")).numFmt, "yyyy-mm-dd");
  const progressCell = activitySheet.getCell(rowNumber, column("پیشرفت فیزیکی"));
  assert.equal(progressCell.value, 0.425, "percentage is stored as a usable Excel fraction");
  assert.equal(progressCell.numFmt, "0.0%");
  assert.equal(activitySheet.getCell(rowNumber, column("یادداشت فعالیت")).value, project.activities[0].notes);
  assert.equal(activitySheet.getCell(rowNumber, column("شرح تحویل")).value, project.activities[0].deliverable);
  const firstDependencies = activitySheet.getCell(rowNumber, column("پیش‌نیازها (نوع و Lag)")).value;
  assert.ok(firstDependencies === null || firstDependencies === "", "no false predecessor is exported for the first activity");
  const activityView = activitySheet.views[0] as unknown as Record<string, unknown> | undefined;
  assert.equal(activityView?.rightToLeft, true, "worksheet view is RTL");
  assert.equal(activityView?.ySplit, 1, "header row is frozen");
  assert.ok(activitySheet.autoFilter, "table filtering is enabled");

  const ganttSheet = workbook.getWorksheet("Gantt");
  assert.ok(ganttSheet);
  const ganttView = ganttSheet.views[0] as unknown as Record<string, unknown> | undefined;
  assert.equal(ganttView?.rightToLeft, true);
  assert.equal(ganttView?.xSplit, 11, "Gantt labels stay visible while scrolling the timeline");
  assert.ok(ganttSheet.autoFilter);
  const infoSheet = workbook.getWorksheet("Info");
  assert.ok(infoSheet);
  const ganttNoteRow = Array.from({ length: infoSheet.rowCount - 1 }, (_, index) => index + 2).find(
    (row) => infoSheet.getCell(row, 1).value === "نمودار Excel",
  );
  assert.ok(ganttNoteRow);
  assert.ok(String(infoSheet.getCell(ganttNoteRow, 2).value).includes("به تاریخ تکمیل واقعی تبدیل نشده"));
  let hasGanttBar = false;
  ganttSheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    row.eachCell((cell, columnIndex) => {
      if (columnIndex > 11 && cell.fill?.type === "pattern" && cell.fill.pattern === "solid") hasGanttBar = true;
    });
  });
  assert.ok(hasGanttBar, "Gantt timeline has actual styled bars, not only text date columns");
  assert.ok(workbookEntries.has("xl/styles.xml"));
  assert.ok(workbookEntries.has("xl/worksheets/sheet5.xml"));
  const workbookXml = new TextDecoder().decode(workbookEntries.get("xl/workbook.xml"));
  assert.match(workbookXml, /<workbookView xWindow=/);
  assert.match(workbookXml, /<definedName name="_xlnm\.Print_Titles"/);
  assert.doesNotMatch(workbookXml, /workbookView rightToLeft=/, "RTL is correctly declared per worksheet view");
  const activitySheetXml = new TextDecoder().decode(workbookEntries.get("xl/worksheets/sheet2.xml"));
  assert.match(activitySheetXml, /<dimension ref="A1:AC\d+"\/>/);
  assert.match(activitySheetXml, /rightToLeft="1"/);
  assert.match(activitySheetXml, /<autoFilter ref="A1:AC\d+"\/>/);
  assert.doesNotMatch(activitySheetXml, /<Row\b/);

  // CSV formula safety: numeric negatives stay numeric; untrusted text is
  // quoted and neutralized, with a UTF-8 BOM and Windows-friendly CRLF.
  const csv = buildCsv({
    name: "Formula-safety",
    headers: ["مبلغ", "ورودی متنی"],
    rows: [
      [-4200, " -42+cmd|' /C calc'!A0"],
      [15, "=1+1"],
      [0, "@SUM(A1:A2)"],
    ],
  });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /\r\n-4200,' -42\+cmd/);
  assert.match(csv, /\r\n15,'=1\+1/);
  assert.match(csv, /\r\n0,'@SUM/);
  const formulaNote = buildCsv({ name: "Notes", headers: ["یادداشت"], rows: [[project.activities[0].notes ?? ""]] });
  assert.ok(formulaNote.includes("'=HYPERLINK"), "formula-like notes are neutralized in CSV");

  // The `.xls` endpoint uses the real Excel 2003 SpreadsheetML XML format.
  const legacyXml = buildExcelXml(sheets);
  assert.equal(XMLValidator.validate(legacyXml), true, "legacy Excel XML is well-formed");
  assert.ok(legacyXml.includes('ss:Type="DateTime"'), "legacy workbook preserves native DateTime values");
  assert.ok(legacyXml.includes('ss:Format="0.0%"'), "legacy workbook styles percent values");
  assert.ok(legacyXml.includes("DisplayRightToLeft"));
  const legacyParsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(legacyXml);
  const rawLegacySheets: unknown = legacyParsed.Workbook.Worksheet;
  const legacySheets = (Array.isArray(rawLegacySheets) ? rawLegacySheets : [rawLegacySheets]) as Record<string, unknown>[];
  assert.ok(legacySheets.some((sheet) => sheet["@_ss:Name"] === "Activities"));
  assert.ok(legacySheets.some((sheet) => sheet["@_ss:Name"] === "Gantt"));

  const completeHtml = buildReportHtml(project, analysis, "", {
    sections: REPORT_SECTIONS.map((section) => section.key),
    includeNotes: false,
  });
  const renderedSectionKeys = new Set(
    [...completeHtml.matchAll(/data-sections="([^"]+)"/g)].flatMap((match) => match[1].split(" ")),
  );
  for (const section of REPORT_SECTIONS) {
    if (section.key === "cover") continue;
    assert.ok(renderedSectionKeys.has(section.key), `standalone report is missing section ${section.key}`);
  }
  assert.ok(completeHtml.includes("<header class=\"cover\">"));
  assert.ok(completeHtml.includes("@media screen and (max-width:640px)"));
  assert.ok(!completeHtml.includes("https://"), "standalone HTML should not need internet access");
  assert.ok(!completeHtml.includes("__HERMIPLAN_SECTION_INDEX__"), "section indexes should be finalized");

  const selectedHtml = buildReportHtml(project, analysis, "", {
    sections: ["activities", "risks"],
    includeNotes: false,
  });
  assert.ok(selectedHtml.includes('data-sections="activities"'));
  assert.ok(selectedHtml.includes('data-sections="risks"'));
  assert.ok(!selectedHtml.includes('data-sections="executive"'));
  assert.ok(!selectedHtml.includes("<header class=\"cover\">"));

  const emptyHtml = buildReportHtml(project, analysis, "", { sections: [] });
  assert.ok(emptyHtml.includes("هیچ بخشی برای گزارش انتخاب نشده است"));

  const hostileProject = {
    ...project,
    meta: { ...project.meta, name: "<script>alert(1)</script>" },
  };
  const escapedHtml = buildReportHtml(hostileProject, analysis, "", { sections: ["cover"] });
  assert.ok(escapedHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!escapedHtml.includes("<script>alert(1)</script>"));

  const packageBytes = buildDeliveryPackage(project, analysis, {
    ganttSvg: "",
    reportUrl: "",
    reportOptions: { sections: ["risks"], includeNotes: false },
  });
  const packageEntries = readZipEntries(packageBytes);
  const packageNames = [...packageEntries.keys()];
  for (const name of ["README.txt", "Report.html", "Data.xlsx", "Data.xls", "MSProject.xml", "Project.json", "CSV/Activities.csv", "CSV/Dependencies.csv"]) {
    assert.ok(packageEntries.has(name), `delivery package contains ${name}`);
  }
  assert.ok(packageNames.length > 15, "delivery package contains the workbook, legacy Excel, and every available CSV table");
  const packagedHtml = zipTextEntry(packageEntries, "Report.html");
  assert.ok(packagedHtml.includes('data-sections="risks"'));
  assert.ok(!packagedHtml.includes('data-sections="executive"'));
  const packagedJson = JSON.parse(zipTextEntry(packageEntries, "Project.json")) as { project: ProjectInput; reportOptions?: { sections?: string[] } };
  assert.deepEqual(packagedJson.project, JSON.parse(JSON.stringify(project)), "package JSON preserves the exact serializable input project");
  assert.deepEqual(packagedJson.reportOptions?.sections, ["risks"]);

  const packagedWorkbook = new ExcelJS.Workbook();
  await packagedWorkbook.xlsx.load(excelJsInput(packageEntries.get("Data.xlsx")!));
  assert.ok(packagedWorkbook.getWorksheet("Gantt"), "packaged workbook reopens in ExcelJS");

  // Data wrappers intentionally retain ordinary values for CSV and native
  // typed values for the spreadsheet formats.
  assert.deepEqual([dateCell("2026-03-21"), percentCell(45), currencyCell(12), styledCell("◆", "ganttMilestone")].map((cell) => cell && typeof cell === "object" ? cell.kind : cell), ["date", "percent", "currency", "styled"]);

  console.log(`Report/export regression checks passed (${DEFAULT_REPORT_SECTIONS.length} default report sections, ${sheets.length} workbook sheets, ${packageNames.length} ZIP entries).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
