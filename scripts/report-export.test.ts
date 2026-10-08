import assert from "node:assert/strict";
import { analyzeProject } from "@/lib/engine/analysis";
import { buildProjectFromTemplate } from "@/lib/templates";
import { DEFAULT_REPORT_SECTIONS, REPORT_SECTIONS } from "@/lib/validation";
import { buildCsv, buildSheets } from "@/lib/report/export";
import { buildReportHtml } from "@/lib/report/html";
import { buildDeliveryPackage } from "@/lib/report/package";
import { buildXlsx } from "@/lib/report/xlsx";

function zipTextEntry(archive: Uint8Array, wantedName: string): string {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 30 <= archive.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(archive.subarray(nameStart, nameStart + nameLength));
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + size;

    if (name === wantedName) {
      assert.equal(method, 0, "test helper expects STORE-compressed ZIP entries");
      return decoder.decode(archive.subarray(contentStart, contentEnd));
    }
    offset = contentEnd;
  }

  throw new Error(`ZIP entry not found: ${wantedName}`);
}

const project = buildProjectFromTemplate("construction");
const analysis = analyzeProject(project);
const sheets = buildSheets(analysis, project);

// Legitimate numeric negatives remain numeric; untrusted text with formula
// prefixes (including leading whitespace) is neutralized before CSV quoting.
const csv = buildCsv({
  name: "Formula-safety",
  headers: ["مبلغ", "ورودی متنی"],
  rows: [
    [-4200, " -42+cmd|' /C calc'!A0"],
    [15, "=1+1"],
    [0, "@SUM(A1:A2)"],
  ],
});
assert.match(csv, /\r\n-4200,' -42\+cmd/);
assert.match(csv, /\r\n15,'=1\+1/);
assert.match(csv, /\r\n0,'@SUM/);

// The workbook must use case-sensitive SpreadsheetML element names and
// declare dimensions for clients that rely on worksheet bounds.
const workbook = buildXlsx(sheets);
const activitySheet = zipTextEntry(workbook, "xl/worksheets/sheet2.xml");
assert.match(activitySheet, /<dimension ref="A1:P\d+"\/>/);
assert.match(activitySheet, /<row r="1">/);
assert.doesNotMatch(activitySheet, /<Row\b/);
assert.match(zipTextEntry(workbook, "xl/workbook.xml"), /<workbookView xWindow=/);
assert.doesNotMatch(zipTextEntry(workbook, "xl/workbook.xml"), /workbookView rightToLeft=/);

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
const packagedHtml = zipTextEntry(packageBytes, "Report.html");
assert.ok(packagedHtml.includes('data-sections="risks"'));
assert.ok(!packagedHtml.includes('data-sections="executive"'));

console.log(`Report/export regression checks passed (${DEFAULT_REPORT_SECTIONS.length} default report sections).`);
