import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { POST } from "@/app/api/export/route";
import { analyzeProject } from "@/lib/engine/analysis";
import type { ProjectInput } from "@/lib/engine/types";
import { buildProjectFromTemplate } from "@/lib/templates";
import { buildSheets, CSV_SHEET_OPTIONS } from "@/lib/report/export";
import { downloadFilenameFromDisposition, safeDownloadFilename } from "@/lib/report/download";
import { crc32 } from "@/lib/report/zip";

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const expandedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const contentStart = nameStart + nameLength + extraLength;
    const compressed = bytes.subarray(contentStart, contentStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : null;
    assert.ok(content, `unsupported ZIP method ${method}: ${name}`);
    assert.equal(content.length, expandedSize, `expanded size check: ${name}`);
    assert.equal(crc32(content), crc, `CRC check: ${name}`);
    out.set(name, content);
    offset = contentStart + compressedSize;
  }
  assert.ok(out.size > 0, "ZIP has entries");
  return out;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function excelJsInput(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function largeProject(source: ProjectInput): ProjectInput {
  const project = structuredClone(source);
  const resourceId = project.resources[0]?.id;
  project.meta.name = "Large export regression / پروژه بزرگ ۵۰۰ فعالیت";
  project.meta.description = "پروژه بزرگ برای بررسی ردیف‌های زیاد و نمودار ماهانه";
  project.baseline = null;
  project.milestones = [];
  project.risks = [];
  project.activities = Array.from({ length: 500 }, (_, index) => {
    const id = `large-${index + 1}`;
    const isMilestone = index > 0 && (index + 1) % 100 === 0;
    return {
      ...structuredClone(source.activities[index % source.activities.length]),
      id,
      code: `L${String(index + 1).padStart(4, "0")}`,
      name: index % 2 === 0 ? `Activity ${index + 1} — task` : `فعالیت ${index + 1} — کار` ,
      phase: `Phase ${Math.floor(index / 50) + 1} / فاز ${Math.floor(index / 50) + 1}`,
      duration: isMilestone ? 0 : 1 + (index % 5),
      predecessors: index === 0 ? [] : [{ predecessorId: `large-${index}`, type: "FS", lag: 0 }],
      resources: resourceId ? [{ resourceId, units: 1 }] : [],
      progress: index % 5 === 0 ? 20 : 0,
      milestone: isMilestone,
      actualCost: undefined,
      notes: index % 25 === 0 ? `گزارش فعالیت ${index + 1}` : undefined,
    };
  });
  return project;
}

async function exportRequest(
  format: string,
  project: ProjectInput,
  options: { kind?: string; ip?: string } = {},
): Promise<Response> {
  const ip = options.ip ?? `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
  return POST(
    new Request("http://hermiplan.test/api/export", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({
        project,
        format,
        ...(options.kind ? { kind: options.kind } : {}),
        reportOptions: { sections: ["cover", "executive", "activities", "gantt", "risks"] },
      }),
    }),
  );
}

async function main() {
  const project = buildProjectFromTemplate("construction");
  project.meta.name = "پروژه آزمون خروجی ۱۴۰۵ — HERMIPLAN";
  project.calendar.holidays = ["2026-05-01"];
  const normalizedProject = JSON.parse(JSON.stringify(project)) as ProjectInput;
  let run = 1;
  const nextIp = () => `198.51.100.${run++}`;

  console.log("▶ API download headers, names, and real file bodies");
  const htmlResponse = await exportRequest("pdf", project, { ip: nextIp() });
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.headers.get("content-type") ?? "", /^text\/html; charset=utf-8/);
  assert.equal(htmlResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(htmlResponse.headers.get("x-content-type-options"), "nosniff");
  const asciiFallback = htmlResponse.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "";
  assert.ok(asciiFallback.startsWith("HERMIPLAN-") && /^[\x20-\x7e]+$/.test(asciiFallback));
  const html = await htmlResponse.text();
  assert.ok(html.length > 10_000 && html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("نمودار گانت"));
  assert.ok(!html.startsWith("%PDF"), "legacy `pdf` id is explicitly printable HTML, not a fake PDF payload");
  const htmlFilename = downloadFilenameFromDisposition(htmlResponse.headers.get("content-disposition"), "fallback.html");
  assert.ok(htmlFilename.includes("پروژه-خروجی") || htmlFilename.endsWith("-Report.html"));
  assert.ok(htmlFilename.endsWith("-Report.html"));

  const edgeNameProject = structuredClone(project);
  edgeNameProject.meta.name = `${"x".repeat(71)}😀${"y".repeat(20)}`;
  const edgeNameResponse = await exportRequest("json", edgeNameProject, { ip: nextIp() });
  assert.equal(edgeNameResponse.status, 200, "a filename truncated near a surrogate pair remains valid Unicode");
  const edgeFilename = downloadFilenameFromDisposition(edgeNameResponse.headers.get("content-disposition"), "fallback.json");
  assert.ok(edgeFilename.includes("😀"));
  assert.doesNotThrow(() => encodeURIComponent(edgeFilename));

  const xlsxResponse = await exportRequest("xlsx", project, { ip: nextIp() });
  assert.equal(xlsxResponse.status, 200);
  assert.equal(xlsxResponse.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const xlsxBytes = new Uint8Array(await xlsxResponse.arrayBuffer());
  assert.ok(xlsxBytes.length > 5_000 && xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b);
  const downloadedWorkbook = new ExcelJS.Workbook();
  await downloadedWorkbook.xlsx.load(excelJsInput(xlsxBytes));
  assert.ok(downloadedWorkbook.getWorksheet("Activities"));
  assert.ok(downloadedWorkbook.getWorksheet("Gantt"));
  assert.equal(downloadedWorkbook.getWorksheet("Activities")?.rowCount, project.activities.length + 1);
  assert.ok(downloadFilenameFromDisposition(xlsxResponse.headers.get("content-disposition"), "fallback.xlsx").endsWith("-Data.xlsx"));

  const xlsResponse = await exportRequest("xls", project, { ip: nextIp() });
  assert.equal(xlsResponse.status, 200);
  assert.match(xlsResponse.headers.get("content-type") ?? "", /^application\/vnd\.ms-excel; charset=utf-8/);
  const xlsText = await xlsResponse.text();
  assert.equal(XMLValidator.validate(xlsText), true);
  assert.ok(xlsText.includes('ss:Type="DateTime"'));
  assert.ok(xlsText.includes('ss:Name="Activities"'));
  assert.ok(xlsResponse.headers.get("content-disposition")?.includes("filename*=UTF-8''"));

  const csvResponse = await exportRequest("csv", project, { kind: "dependencies", ip: nextIp() });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type") ?? "", /^text\/csv; charset=utf-8/);
  const csvBytes = new Uint8Array(await csvResponse.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(csvBytes.subarray(3));
  assert.ok(csv.startsWith("شناسه پیش‌نیاز ورودی,"));
  assert.ok(csv.split("\r\n").length > project.activities.length);
  assert.ok(downloadFilenameFromDisposition(csvResponse.headers.get("content-disposition"), "fallback.csv").endsWith("-Dependencies.csv"));

  const jsonResponse = await exportRequest("json", project, { ip: nextIp() });
  assert.equal(jsonResponse.status, 200);
  assert.match(jsonResponse.headers.get("content-type") ?? "", /^application\/json; charset=utf-8/);
  const json = JSON.parse(await jsonResponse.text()) as {
    schemaVersion: number;
    project: ProjectInput;
    analysis: { activities: unknown[] };
    meta?: { reportSections?: number };
  };
  assert.equal(json.schemaVersion, 1);
  assert.deepEqual(json.project, normalizedProject, "JSON preserves all serialized input fields");
  assert.equal(json.analysis.activities.length, project.activities.length);
  assert.equal(json.meta, undefined, "no unrelated reportSections field is injected into project metadata");

  const msResponse = await exportRequest("msproject", project, { ip: nextIp() });
  assert.equal(msResponse.status, 200);
  assert.match(msResponse.headers.get("content-type") ?? "", /^application\/xml; charset=utf-8/);
  const msXml = await msResponse.text();
  assert.equal(XMLValidator.validate(msXml), true, "MSPDI output is parseable XML");
  const msProject = new XMLParser({ ignoreAttributes: false }).parse(msXml).Project;
  const tasks = asArray<{ Name: string; ConstraintType?: number; PredecessorLink?: unknown }>(msProject.Tasks.Task);
  assert.equal(tasks.length, new Set(project.activities.map((activity) => activity.phase)).size + project.activities.length);
  assert.ok(tasks.some((task) => task.Name === project.activities[0].name));
  assert.ok(tasks.some((task) => task.PredecessorLink), "dependency edges are present in MSPDI");
  assert.ok(msXml.includes("<Exceptions>"), "calendar holidays are represented as MSPDI exceptions");
  const resources = asArray<{ Type: number; MaxUnits: number }>(msProject.Resources.Resource);
  assert.ok(resources.length > 0);
  assert.ok(resources.every((resource) => Number.isFinite(resource.Type)));
  assert.ok(downloadFilenameFromDisposition(msResponse.headers.get("content-disposition"), "fallback.xml").endsWith("-MSProject.xml"));

  const packageResponse = await exportRequest("package", project, { ip: nextIp() });
  assert.equal(packageResponse.status, 200);
  assert.equal(packageResponse.headers.get("content-type"), "application/zip");
  const packageBytes = new Uint8Array(await packageResponse.arrayBuffer());
  assert.ok(packageBytes.length > 20_000);
  const packageFiles = zipEntries(packageBytes);
  for (const name of ["README.txt", "Report.html", "Data.xlsx", "Data.xls", "Project.json", "MSProject.xml", "CSV/Activities.csv", "CSV/Dependencies.csv"]) {
    assert.ok(packageFiles.has(name), `package contains ${name}`);
  }
  assert.ok(packageFiles.size >= 20, "package includes each available CSV table in addition to primary artifacts");
  const packagedWorkbook = new ExcelJS.Workbook();
  await packagedWorkbook.xlsx.load(excelJsInput(packageFiles.get("Data.xlsx")!));
  assert.ok(packagedWorkbook.getWorksheet("Gantt"));
  const packagedData = JSON.parse(new TextDecoder().decode(packageFiles.get("Project.json"))) as { project: ProjectInput };
  assert.deepEqual(packagedData.project, normalizedProject);

  console.log("▶ CSV selection validation and Unicode-safe download names");
  const invalidFormat = await exportRequest("pdf.exe", project, { ip: nextIp() });
  assert.equal(invalidFormat.status, 400);
  const invalidCsvKind = await exportRequest("csv", project, { kind: "unknown", ip: nextIp() });
  assert.equal(invalidCsvKind.status, 400);
  const unavailableCsvKind = await exportRequest("csv", project, { kind: "baseline", ip: nextIp() });
  assert.equal(unavailableCsvKind.status, 422, "missing optional table does not silently fall back to Activities");
  assert.ok(CSV_SHEET_OPTIONS.some((option) => option.id === "dependencies"));
  assert.equal(
    downloadFilenameFromDisposition("attachment; filename=HERMIPLAN-export.csv; filename*=UTF-8''HERMIPLAN-%D9%BE%D8%B1%D9%88%DA%98%D9%87-Activities.csv", "fallback.csv"),
    "HERMIPLAN-پروژه-Activities.csv",
  );
  assert.equal(safeDownloadFilename("../evil\\name.csv"), "evil-name.csv");
  assert.equal(safeDownloadFilename("bad\uD800name.csv"), "bad�name.csv", "unpaired UTF-16 surrogate is replaced before download");

  console.log("▶ empty, large, and unschedulable project cases");
  const empty: ProjectInput = {
    meta: { name: "پروژه خالی", type: "general", currency: "IRR", startDate: "2026-03-21", statusDate: "2026-03-21" },
    calendar: { workDays: [6, 0, 1, 2, 3], holidays: [], hoursPerDay: 8 },
    activities: [], resources: [], milestones: [], risks: [], baseline: null,
  };
  const emptyAnalysis = analyzeProject(empty);
  const emptySheets = buildSheets(emptyAnalysis, empty);
  assert.ok(emptySheets.every((sheet) => sheet.headers.length > 0));
  const emptyResponse = await exportRequest("xlsx", empty, { ip: nextIp() });
  assert.equal(emptyResponse.status, 200);
  const emptyXlsxBytes = new Uint8Array(await emptyResponse.arrayBuffer());
  const emptyXlsx = new ExcelJS.Workbook();
  await emptyXlsx.xlsx.load(excelJsInput(emptyXlsxBytes));
  assert.ok(emptyXlsx.worksheets.length > 0);
  assert.ok(emptyXlsx.worksheets.some((sheet) => sheet.name === "Info"));

  const large = largeProject(project);
  const largeAnalysis = analyzeProject(large);
  const largeSheets = buildSheets(largeAnalysis, large);
  const largeActivitySheet = largeSheets.find((sheet) => sheet.name === "Activities");
  const largeGantt = largeSheets.find((sheet) => sheet.name === "Gantt");
  assert.equal(largeActivitySheet?.rows.length, 500, "no task row is lost in a large project");
  assert.ok(largeGantt && largeGantt.headers.length < 120, "large-project Gantt uses a readable monthly scale");
  const largeXlsxBytes = await (async () => {
    const response = await exportRequest("xlsx", large, { ip: nextIp() });
    assert.equal(response.status, 200);
    return new Uint8Array(await response.arrayBuffer());
  })();
  const largeWorkbook = new ExcelJS.Workbook();
  await largeWorkbook.xlsx.load(excelJsInput(largeXlsxBytes));
  assert.equal(largeWorkbook.getWorksheet("Activities")?.rowCount, 501);
  assert.equal(largeWorkbook.getWorksheet("Gantt")?.rowCount, largeGantt!.rows.length + 1);

  const cyclic = buildProjectFromTemplate("general");
  cyclic.activities = cyclic.activities.slice(0, 3).map((activity, index, all) => ({
    ...activity,
    id: `cycle-${index + 1}`,
    code: `CY${index + 1}`,
    predecessors: index === 0
      ? [{ predecessorId: "cycle-2", type: "FS", lag: 0 }]
      : index === 1
        ? [{ predecessorId: "cycle-1", type: "FS", lag: 0 }]
        : [],
  }));
  const cyclicAnalysis = analyzeProject(cyclic);
  const cyclicSheets = buildSheets(cyclicAnalysis, cyclic);
  assert.equal(cyclicSheets.find((sheet) => sheet.name === "Activities")?.rows.length, 3, "unscheduled source tasks remain in the workbook");
  assert.ok(cyclicSheets.find((sheet) => sheet.name === "Checks")?.rows.some((row) => String(row[1]).includes("حلقه وابستگی")));
  assert.ok(cyclicSheets.find((sheet) => sheet.name === "WBS")?.rows.some((row) => row[0] === ""), "uncomputed WBS fields are left blank, not fabricated");
  assert.ok(cyclicAnalysis.errors.length > 0);
  const cyclicHtmlResponse = await exportRequest("pdf", cyclic, { ip: nextIp() });
  assert.equal(cyclicHtmlResponse.status, 200);
  const cyclicHtml = await cyclicHtmlResponse.text();
  for (const activity of cyclic.activities) assert.ok(cyclicHtml.includes(activity.name), `HTML retains source activity ${activity.code}`);
  assert.ok(cyclicHtml.includes("زمان‌بندی محاسبه نشد"), "HTML labels unscheduled rows instead of inventing dates");

  console.log(`Export API regression checks passed (${project.activities.length}-task sample, ${large.activities.length}-task project, empty project, cyclic inputs, ${packageFiles.size} ZIP entries).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
