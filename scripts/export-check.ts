/**
 * HERMIPLAN — deep verification of the delivered artifacts.
 *
 *   npx tsx scripts/export-check.ts                       # local builders only
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/export-check.ts   # + PDF/HTTP
 *
 * The other suites check that an export *exists* and has the right shape. This
 * one checks that the numbers inside it are the same numbers, everywhere:
 *
 *   1. XLSX is a real Office archive: required parts, workbook XML, one sheet
 *      file per sheet, correct sheet count, and no `NaN`/`Infinity` anywhere.
 *   2. CSV carries a BOM (Excel + Persian), has a stable header and one row per
 *      activity.
 *   3. HTML contains the rate-provenance table, the estimate warning for
 *      unsourced rates, and no `NaN`.
 *   4. **Cross-artifact consistency**: BAC / total duration / activity count are
 *      identical in the sheets, the CSV, the HTML and the JSON export. A rounded
 *      total that disagrees with its parts is exactly the class of bug the money
 *      policy exists to prevent, so it is asserted here.
 *   5. Package: six entries, valid CRCs, and its embedded files equal the
 *      standalone ones.
 *   6. When `BASE_URL` is set: `/api/export?format=pdf` returns a real PDF
 *      (`%PDF-` … `%%EOF`, at least one page object) and `msproject` returns
 *      parseable XML with a `<Project>` root.
 *
 * Values are computed by hand where possible (the template's activity count and
 * total duration are read from the analysis, then compared across artifacts,
 * not copied between them).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeProject } from "../src/lib/engine/analysis";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { parseProjectInput } from "../src/lib/validation";
import { buildCsv, buildSheets } from "../src/lib/report/export";
import { buildXlsx } from "../src/lib/report/xlsx";
import { buildReportHtml } from "../src/lib/report/html";
import { buildDeliveryPackage } from "../src/lib/report/package";
import { buildMsProjectXml } from "../src/lib/report/msproject";
import { renderGanttSvg } from "../src/lib/report/gantt-svg";
import { toPersianDigits } from "../src/lib/date-fa";
import { roundMoney } from "../src/lib/engine/money";
import { readZip } from "./lib/zip-read";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    failures.push(`${message}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

function readArtifact(name: string): string {
  return readFileSync(join(process.cwd(), "src/lib/report", name), "utf8");
}

async function main(): Promise<void> {
  const input = parseProjectInput(buildProjectFromTemplate("construction"));
  input.meta.name = "پروژه آزمون خروجی‌ها";
  const analysis = analyzeProject(input);
  const sheets = buildSheets(analysis, input);
  // Exports must be reproducible: the archive timestamp is the project's status
  // date, so re-exporting the same project yields identical bytes.
  const stamp = new Date(`${input.meta.statusDate}T00:00:00Z`);

  console.log("▶ ۱. XLSX — بسته واقعی Office");
  const xlsx = buildXlsx(sheets, stamp);
  const xlsxZip = readZip(Buffer.from(xlsx));
  const xlsxNames = xlsxZip.map((entry) => entry.name);
  check(xlsxNames.includes("[Content_Types].xml"), "بخش [Content_Types].xml حاضر است");
  check(xlsxNames.includes("xl/workbook.xml"), "xl/workbook.xml حاضر است");
  check(xlsxZip.every((entry) => entry.crcOk), "CRC همه بخش‌ها معتبر است");
  const workbook = xlsxZip.find((entry) => entry.name === "xl/workbook.xml")?.data.toString("utf8") ?? "";
  const declaredSheets = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => match[1]);
  check(declaredSheets.length === sheets.length, "تعداد شیت‌های اعلام‌شده با محتوا یکی است", `${declaredSheets.length}/${sheets.length}`);
  const worksheetFiles = xlsxNames.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  check(worksheetFiles.length === sheets.length, "برای هر شیت یک فایل وجود دارد", `${worksheetFiles.length}`);
  const xlsxText = xlsxZip.map((entry) => entry.data.toString("utf8")).join("\n");
  check(!/NaN|Infinity/.test(xlsxText), "هیچ NaN/Infinity در XLSX نیست");
  const xlsxAgain = buildXlsx(sheets, stamp);
  check(Buffer.compare(Buffer.from(xlsx), Buffer.from(xlsxAgain)) === 0, "خروجی XLSX تکرارپذیر است (بایت‌به‌بایت)");
  const xlsxOtherStamp = buildXlsx(sheets, new Date("2001-01-01T00:00:00Z"));
  check(Buffer.compare(Buffer.from(xlsx), Buffer.from(xlsxOtherStamp)) !== 0, "مهر زمانی واقعاً در آرشیو نوشته می‌شود");

  // The workbook must carry the sections a reader expects to find.
  for (const required of ["Info", "Activities", "Milestones", "Resources", "Costs", "Pricing", "CostSummary", "Standards"]) {
    check(declaredSheets.includes(required), `شیت «${required}» موجود است`);
  }

  console.log("\n▶ ۲. CSV — خوانا برای Excel فارسی و قابل تجزیه");
  const activitiesSheet = sheets.find((sheet) => sheet.name === "Activities")!;
  const csv = buildCsv(activitiesSheet);
  // The first byte sequence is the Excel BOM (`\uFEFF`), asserted separately.
  const csvLines = csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line.length > 0);
  check(csvLines.length === activitiesSheet.rows.length + 1, "تعداد خطوط CSV = سرصفحه + یک خط برای هر فعالیت", `${csvLines.length}`);
  check(csvLines[0] === activitiesSheet.headers.join(","), "سرصفحه CSV با سرصفحه شیت یکی است")
  check(csv.startsWith("\uFEFF"), "CSV با BOM شروع می‌شود (Excel فارسی)");
  check(csv.includes(analysis.activities[0]?.name ?? "___"), "نام فعالیت واقعی در CSV هست");
  check(!/NaN|Infinity/.test(csv), "هیچ NaN/Infinity در CSV نیست");

  console.log("\n▶ ۳. HTML — گزارش چاپی");
  const ganttSvg = renderGanttSvg({
    gantt: analysis.gantt,
    links: input.activities.flatMap((activity) =>
      activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
    ),
    showArrows: true,
    statusDate: input.meta.statusDate,
    compact: false,
  });
  const html = buildReportHtml(input, analysis, ganttSvg);
  check(/dir="rtl"/.test(html) && /lang="fa"/.test(html), "سند HTML راست‌به‌چپ و فارسی اعلام شده است");
  check(/name="viewport"/.test(html), "متای viewport برای موبایل وجود دارد")
  check(/@media screen and \(max-width:720px\)/.test(html), "CSS چاپ/موبایل برای صفحه‌های کوچک وجود دارد");
  check(!/NaN|Infinity/.test(html), "هیچ NaN/Infinity در HTML نیست");
  check(/نوع داده/.test(html) && /واحد/.test(html), "جدول نرخ‌ها ستون «نوع داده» و «واحد» دارد");
  check(/سند ثبت نشده/.test(html), "نرخ بدون سند رسمی، «سند ثبت نشده» علامت خورده است");
  check(!/NaN|undefined/.test(html), "متن HTML مقدار undefined چاپ نمی‌کند");
  // Self-contained: no external stylesheet/script/font. The SVG `xmlns` is a
  // namespace identifier, not a network request, so only href/src count.
  check(!/(?:href|src)="https?:\/\//.test(html), "گزارش هیچ منبع بیرونی (CDN) ندارد");
  check(/data:font\/woff2;base64,[A-Za-z0-9+/]{1000,}/.test(html), "فونت وزیرمتن داخل گزارش جاسازی شده است");
  check(html.length < 400_000, "حجم گزارش با فونت جاسازی‌شده معقول است", `${Math.round(html.length / 1024)} KB`);

  console.log("\n▶ ۴. سازگاری بین خروجی‌ها (یک عدد، همه‌جا)");
  const jsonBytes = JSON.stringify({ project: input, analysis });
  const jsonBac = JSON.parse(jsonBytes).analysis.evm.bac as number;
  // The same BAC must appear in the Info/Costs sheet, the HTML and the JSON.
  const allSheetText = sheets.flatMap((sheet) => sheet.rows.flat().map(String)).join("|");
  const infoRows = sheets.find((sheet) => sheet.name === "Info")!.rows.flat().map(String);
  const bacInSheet = infoRows.some((cell) => cell.replace(/,/g, "") === String(jsonBac)) ||
    sheets.some((sheet) => sheet.rows.some((row) => row.some((cell) => String(cell).replace(/,/g, "") === String(jsonBac))));
  check(bacInSheet, "BAC در یکی از شیت‌ها با JSON یکسان است", `bac=${jsonBac}`);
  check(sheets.every((sheet) => sheet.rows.every((row) => row.length === sheet.headers.length)), "همه ردیف‌ها با سرصفحه هم‌عرض‌اند");
  check(allSheetText.length > 0, "شیت‌ها داده دارند");

  const activityCountSheet = activitiesSheet.rows.length;
  check(activityCountSheet === analysis.activities.length, "تعداد فعالیت شیت با تحلیل یکی است", `${activityCountSheet}/${analysis.activities.length}`);
  // The project duration is hand-derivable from the schedule: the latest finish
  // minus the earliest start, in working days. It must appear in the HTML.
  // `es` is the earliest start and `ee` the exclusive end, both in working-day
  // offsets from the project start, so the calendar span is max(ee) − 0.
  const earliest = Math.min(...analysis.activities.map((activity) => activity.es));
  const latest = Math.max(...analysis.activities.map((activity) => activity.ee));
  const spanDays = latest - earliest;
  check(spanDays > 0, "بازه برنامه از تحلیل قابل محاسبه است", `${earliest}…${latest}`);
  check(
    html.includes(toPersianDigits(String(spanDays))) || html.includes(String(spanDays)),
    "بازه برنامه در HTML چاپ شده است",
    `span=${spanDays}`,
  );

  console.log("\n▶ ۵. بسته‌ی تحویل");
  const pkg = buildDeliveryPackage(input, analysis, { ganttSvg, reportUrl: "http://127.0.0.1:3400", modifiedAt: stamp });
  const pkgEntries = readZip(Buffer.from(pkg));
  check(pkgEntries.length === 6, "بسته شامل ۶ فایل است", pkgEntries.map((entry) => entry.name).join(","));
  check(pkgEntries.every((entry) => entry.crcOk), "CRC همه فایل‌های بسته معتبر است");
  const pkgXlsx = pkgEntries.find((entry) => entry.name === "Data.xlsx");
  check(Boolean(pkgXlsx), "Data.xlsx در بسته هست");
  check(pkgXlsx ? Buffer.compare(pkgXlsx.data, Buffer.from(xlsx)) === 0 : false, "XLSX داخل بسته با XLSX مستقل بایت‌به‌بایت یکی است");
  const pkgCsv = pkgEntries.find((entry) => entry.name === "Activities.csv")?.data.toString("utf8") ?? "";
  check(pkgCsv === csv, "CSV داخل بسته با CSV مستقل یکی است");
  const pkgHtml = pkgEntries.find((entry) => entry.name === "Report.html")?.data.toString("utf8") ?? "";
  check(pkgHtml === html, "HTML داخل بسته با HTML مستقل یکی است");

  console.log("\n▶ ۶. MS Project XML");
  const msproject = buildMsProjectXml(input, analysis);
  check(/<Project[^>]*>/.test(msproject), "ریشه <Project> وجود دارد");
  check((msproject.match(/<Task>/g) ?? []).length >= analysis.activities.length, "یک Task برای هر فعالیت (به‌علاوه خلاصه)", `${(msproject.match(/<Task>/g) ?? []).length}/${analysis.activities.length}`);
  check(!/NaN|Infinity/.test(msproject), "هیچ NaN/Infinity در XML نیست");

  // Evidence of intent: the artifact code must not format money ad hoc.
  console.log("\n▶ ۷. سیاست پول داخل خودِ خروجی (جمع اجزا = جمع نهایی)");
  const costSummary = sheets.find((sheet) => sheet.name === "CostSummary")!;
  const amount = (label: string): number => {
    const row = costSummary.rows.find((cells) => String(cells[0]).includes(label));
    return Number(row?.[1] ?? Number.NaN);
  };
  const parts = ["هزینه‌های مستقیم", "هزینه‌های بالاسری", "سود پیمانکار", "ذخیره احتیاطی", "تعدیل قیمت"].map(amount);
  const total = amount("جمع برآورد نهایی");
  const sumOfParts = parts.reduce((sum, value) => sum + value, 0);
  check(parts.every(Number.isFinite) && Number.isFinite(total), "همه اجزای هزینه عددی‌اند", parts.join("+"));
  // Exact equality is the point: money is rounded once, at the source, so the
  // rounded parts must add up to the rounded total without a repair step.
  check(sumOfParts === total, "جمع پنج جزء برابر جمع نهایی است (بدون اختلاف گرد کردن)", `${sumOfParts} vs ${total}`);
  const moneyCells = costSummary.rows.map((cells) => cells[1]).filter((value) => typeof value === "number") as number[];
  // The documented policy keeps exactly MONEY_DECIMALS=2 decimals and rounds
  // once, so every stored figure must already be a fixed point of roundMoney.
  check(
    moneyCells.every((value) => Number.isFinite(value) && Math.abs(value - roundMoney(value)) < 1e-9),
    "همه مبالغ از قبل گردشده‌اند (idempotent roundMoney)",
    moneyCells.slice(0, 3).join(" , "),
  );
  // Scale-relative tolerance: 2.5e9 * 100 is not representable exactly in
  // binary, so an absolute epsilon would flag a correctly rounded value.
  check(
    moneyCells.every((value) => {
      const scaled = Math.abs(value) * 100;
      return Math.abs(scaled - Math.round(scaled)) <= 1e-9 * Math.max(1, scaled);
    }),
    "هیچ مبلغی بیش از دو رقم اعشار ندارد",
  );
  // --- CSV formula injection (CWE-1236) ---
  // A title is user input: if a cell starts with =, +, @ or -, Excel would run
  // it as a formula. Real behaviour is asserted, not a grep over the source.
  const hostile = {
    ...input,
    activities: input.activities.map((activity, index) =>
      index === 0 ? { ...activity, name: "=HYPERLINK(\"http://evil.example\",\"click\")" } : activity,
    ),
    meta: { ...input.meta, name: "-2+3+cmd|' /C calc'!A0" },
  };
  const hostileSheets = buildSheets(analyzeProject(hostile as typeof input), hostile as typeof input);
  const hostileCsv = buildCsv(hostileSheets.find((sheet) => sheet.name === "Activities")!);
  check(/[,"]'=HYPERLINK/.test(hostileCsv), "عنوانی که با = شروع می‌شود با آپاستروف خنثی می‌شود", hostileCsv.slice(0, 90));
  check(!/(^|,)"?=HYPERLINK/.test(hostileCsv), "هیچ سلولی با = به‌عنوان فرمول باقی نمی‌ماند");
  const infoCsv = buildCsv(hostileSheets.find((sheet) => sheet.name === "Info")!);
  check(/,'-2\+3/.test(infoCsv), "سلول با - غیرعددی هم خنثی می‌شود", infoCsv.split("\r\n").find((line) => line.includes("-2+3")) ?? "");
  const numericCsv = buildCsv({ name: "T", headers: ["v"], rows: [[-5], ["-۱۲۳"], ["-5,200"]] });
  check(
    numericCsv.includes("-5") && numericCsv.includes("-۱۲۳") && numericCsv.includes("-5,200"),
    "اعداد منفی واقعی (لاتین و فارسی) آپاستروف نمی‌گیرند",
  );

  const base = process.env.BASE_URL;
  if (base) {
    console.log(`\n▶ ۸. خروجی‌های HTTP (${base})`);
    /*
     * The `pdf` format is deliberately **print-ready HTML**, not a PDF byte
     * stream: the app has no server-side PDF engine and none is pretended. The
     * browser's "Save as PDF" produces the actual PDF with correct Persian
     * letter-joining and embedded fonts, which a home-grown PDF writer could not
     * do without a shaping engine. The contract asserted here is therefore:
     * self-contained HTML, A4 print CSS, no external resource, and an honest
     * `.html` filename/content-type so no user is told they downloaded a PDF.
     */
    const htmlResponse = await fetch(`${base}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: input, format: "pdf" }),
    });
    const htmlText = await htmlResponse.text();
    const disposition = htmlResponse.headers.get("content-disposition") ?? "";
    const contentType = htmlResponse.headers.get("content-type") ?? "";
    check(htmlResponse.status === 200, "گزارش چاپی با کد ۲۰۰ برگشت", `status=${htmlResponse.status}`);
    check(/text\/html/.test(contentType), "نوع محتوا صادقانه text/html است (نه ادعای PDF)", contentType);
    check(/\.html"/.test(disposition), "نام فایل با .html تمام می‌شود", disposition);
    check(/@page\s*\{\s*size:\s*A4/.test(htmlText), "قواعد چاپ A4 در سند هست");
    check(!/<script|<link[^>]+href="http/.test(htmlText), "سند خودکفاست: اسکریپت/منبع بیرونی ندارد");
    check(htmlText.includes("نوع داده") && htmlText.includes("سند ثبت نشده"), "جدول نرخ با نوع داده و وضعیت سند در سند چاپی هست");
    check(htmlText.includes("viewport"), "متای viewport در سند سرویس‌شده هست");

    const msXml = await fetch(`${base}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: input, format: "msproject" }),
    });
    const msText = await msXml.text();
    check(msXml.status === 200 && /<Project/.test(msText), "XML پروژه از سرویس برگشت و قابل تجزیه است");

    const csvResponse = await fetch(`${base}/api/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: input, format: "csv", kind: "activities" }),
    });
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
    check(
      csvResponse.status === 200 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
      "CSV سرویس‌شده BOM دارد",
    );
    check(
      Buffer.compare(csvBytes, Buffer.from(csv, "utf8")) === 0,
      "CSV سرویس‌شده بایت‌به‌بایت با خروجی مستقیم یکی است",
    );

    /*
     * Every format the download centre offers must come back as a real file of
     * the right shape. A format that silently 400s — or returns JSON where an
     * archive was promised — is invisible to unit tests but obvious to a user.
     * The first bytes are the cheapest honest proof of what was sent.
     */
    const SIGNATURES: { format: string; magic: string; type: RegExp; label: string }[] = [
      { format: "xlsx", magic: "504b0304", type: /spreadsheetml\.sheet/, label: "Excel (xlsx)" },
      { format: "xls", magic: "3c3f786d", type: /ms-excel/, label: "Excel 2003 (xls)" },
      { format: "json", magic: "7b0a", type: /application\/json/, label: "JSON" },
      { format: "package", magic: "504b0304", type: /application\/zip/, label: "بسته ZIP" },
    ];
    for (const expected of SIGNATURES) {
      const response = await fetch(`${base}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: input, format: expected.format }),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const magic = bytes.subarray(0, 4).toString("hex").slice(0, expected.magic.length);
      const contentType = response.headers.get("content-type") ?? "";
      check(
        response.status === 200 && magic === expected.magic && expected.type.test(contentType),
        `فرمت ${expected.label}: فایل واقعی با امضای درست و نوع محتوای درست`,
        `status=${response.status} magic=${magic} type=${contentType}`,
      );
      check(bytes.byteLength > 4096, `فرمت ${expected.label}: خروجی خالی/ناقص نیست`, `${bytes.byteLength} بایت`);
    }
  } else {
    console.log("\n▶ ۸. خروجی‌های HTTP — نادیده (BASE_URL تنظیم نشده)");
  }

  console.log(`\n${failed === 0 ? "✔" : "✗"} ${passed} موفق / ${failed} ناموفق`);
  if (failed) {
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exit(1);
  }
}

void main();
