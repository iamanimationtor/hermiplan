/**
 * HERMIPLAN — the whole journey, from an empty browser to a real deliverable.
 *
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/journey-check.ts
 *
 * Why this suite exists
 * ---------------------
 * Every other suite tests one layer. This one walks the path a person actually
 * walks — register, define a project, save it, look at the report, hand it to
 * someone — and **opens every artifact** the way the receiving tool would:
 *
 *   • the .xlsx is unzipped and its sheet XML parsed (row counts, numbers that
 *     are numbers, RTL, frozen header, a real number format),
 *   • the .csv is decoded with its BOM and every row counted against the data,
 *   • the MS Project XML is parsed for unique UIDs and ISO-8601 durations,
 *   • the print document is checked for A4 rules, an embedded font and the
 *     absence of any external resource (it must print with no network),
 *   • the delivery zip is verified entry by entry (CRC) and its manifest is
 *     read back.
 *
 * A file that merely has the right extension is not "output"; the assertions
 * below are about content, not about the HTTP status being 200.
 */
import "dotenv/config";
import { Client } from "pg";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { readZip } from "./lib/zip-read";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const RUN = Date.now().toString().slice(-6);
const USERNAME = `journey${RUN}`;
const PASSWORD = "Journey-Pass-2026";
const CLIENT_IP = `10.77.${Number(RUN.slice(0, 3)) % 250}.${Number(RUN.slice(3)) % 250}`;

let passed = 0;
const failures: string[] = [];
function ok(condition: boolean, message: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

class Jar {
  private cookies = new Map<string, string>();
  set(response: Response): void {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = pair.split("=");
      if (name) this.cookies.set(name.trim(), rest.join("="));
    }
  }
  header(): string {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function call(
  jar: Jar | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; bytes: Buffer; headers: Headers }> {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-forwarded-for", CLIENT_IP);
  if (jar?.header()) headers.set("cookie", jar.header());
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  if (jar) jar.set(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: bytes.toString("utf8"), bytes, headers: response.headers };
}

/** The project a real estimator would have: many activities, resources, risks. */
function realisticProject() {
  const project = buildProjectFromTemplate("construction");
  project.meta.name = "برج اداری آرمان — فاز یک";
  project.meta.code = "ARM-01";
  project.meta.client = "شرکت توسعه آرمان";
  project.meta.manager = "مهندس رضایی";
  project.meta.statusDate = "2026-06-30";
  project.meta.deadline = "2026-12-20";
  project.meta.location = "تهران، سعادت‌آباد";
  return project;
}

function xmlText(entries: { name: string; data: Buffer }[], name: string): string {
  return entries.find((entry) => entry.name === name)?.data.toString("utf8") ?? "";
}

async function main(): Promise<void> {
  console.log(`▶ سرور: ${BASE} · کاربر: ${USERNAME}\n`);

  /* ---------------- ۱. حساب کاربری ---------------- */
  console.log("▶ ۱. ساخت حساب با نام کاربری و رمز عبور");
  const jar = new Jar();
  const registered = await call(jar, "/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "register", username: USERNAME, password: PASSWORD }),
  });
  ok(registered.status === 201, "ثبت‌نام ⇒ ۲۰۱", `got ${registered.status} ${registered.body.slice(0, 120)}`);
  ok(jar.header().includes("hermiplan_session"), "کوکی نشست صادر شد");

  const project = realisticProject();
  const reportOptions = { sections: ["cover", "executive", "gantt", "cost", "risks", "history"] };

  /* ---------------- ۲. تعریف پروژه ---------------- */
  console.log("\n▶ ۲. تعریف و ذخیره پروژه");
  const created = await call(jar, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ project, reportOptions }),
  });
  const createdBody = JSON.parse(created.body || "{}") as { id?: string; version?: number };
  const id = createdBody.id ?? "";
  ok(created.status === 201 && Boolean(id), "پروژه ساخته شد ⇒ ۲۰۱ + شناسه", `got ${created.status}`);
  ok(createdBody.version === 1, "نسخه اول ثبت شد", String(createdBody.version));

  const read = await call(jar, `/api/projects/${id}`);
  const readBody = JSON.parse(read.body || "{}") as {
    project?: { activities?: unknown[]; resources?: unknown[] };
    analysis?: {
      activities?: unknown[];
      criticalPath?: string[];
      schedule?: { workingDays?: number; finishDate?: string };
      costs?: { budget?: number };
      evm?: { spi?: number | null; cpi?: number | null };
      health?: { score?: number };
    };
  };
  ok(read.status === 200, "پروژه خوانده می‌شود ⇒ ۲۰۰", `got ${read.status}`);
  const analysis = readBody.analysis ?? {};
  ok((analysis.activities?.length ?? 0) >= 10, "تحلیل شامل همه فعالیت‌هاست", String(analysis.activities?.length));
  ok((analysis.criticalPath?.length ?? 0) > 0, "مسیر بحرانی محاسبه شده است", String(analysis.criticalPath?.length));
  ok((analysis.schedule?.workingDays ?? 0) > 0, "مدت پروژه بزرگ‌تر از صفر است", String(analysis.schedule?.workingDays));
  ok((analysis.costs?.budget ?? 0) > 0, "بودجه محاسبه شده است", String(analysis.costs?.budget));
  ok(typeof analysis.health?.score === "number", "امتیاز سلامت تحلیل تولید شده است");

  /* ---------------- ۳. ویرایش + تاریخچه ---------------- */
  console.log("\n▶ ۳. ویرایش، نسخه‌گذاری و مقایسه");
  const edited = structuredClone(project);
  edited.meta.name = "برج اداری آرمان — فاز یک (بازنگری)";
  edited.activities[0].progress = 45;
  const patched = await call(jar, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ project: edited, reportOptions, expectedVersion: 1 }),
  });
  const patchedBody = JSON.parse(patched.body || "{}") as { version?: number };
  ok(patched.status === 200, "ویرایش با نسخه درست ⇒ ۲۰۰", `got ${patched.status}`);
  ok(patchedBody.version === 2, "شماره نسخه بالا رفت", String(patchedBody.version));

  const history = await call(jar, `/api/projects/${id}/versions?limit=10`);
  const historyBody = JSON.parse(history.body || "{}") as { versions?: { version: number }[] };
  ok((historyBody.versions?.length ?? 0) >= 2, "تاریخچه حداقل دو نسخه دارد", String(historyBody.versions?.length));

  const diff = await call(jar, `/api/projects/${id}/versions/1/diff`);
  const diffBody = JSON.parse(diff.body || "{}") as { diff?: { identical?: boolean; counts?: { total?: number } } };
  ok(diffBody.diff?.identical === false, "مقایسه نسخه ۱ با وضعیت جاری تفاوت را نشان می‌دهد");

  /* ---------------- ۴. خروجی‌ها، یکی‌یکی باز و بازرسی‌شده ---------------- */
  console.log("\n▶ ۴. خروجی واقعی در همه فرمت‌ها");
  const exportBody = (format: string) =>
    JSON.stringify({ project: edited, format, reportOptions, reportUrl: `${BASE}/report/${id}` });
  const artifact = async (format: string) => call(jar, "/api/export", { method: "POST", body: exportBody(format) });

  /* ۴-الف. XLSX */
  const xlsx = await artifact("xlsx");
  ok(xlsx.status === 200, "xlsx ⇒ ۲۰۰", `got ${xlsx.status}`);
  ok(
    xlsx.headers.get("content-type")?.includes("spreadsheetml") ?? false,
    "xlsx: نوع محتوا درست است",
    String(xlsx.headers.get("content-type")),
  );
  ok(xlsx.bytes.subarray(0, 2).toString("latin1") === "PK", "xlsx: امضای zip (PK)");
  ok(/\.xlsx"/.test(xlsx.headers.get("content-disposition") ?? ""), "xlsx: نام فایل پسوند درست دارد");
  const xlsxEntries = readZip(xlsx.bytes);
  ok(xlsxEntries.every((entry) => entry.crcOk), "xlsx: CRC همه اجزا سالم است");
  const workbookXml = xmlText(xlsxEntries, "xl/workbook.xml");
  const sheetNames = [...workbookXml.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
  ok(
    ["Info", "Activities", "Resources", "Costs", "Risks"].every((name) => sheetNames.includes(name)),
    "xlsx: برگه‌های اصلی وجود دارند",
    sheetNames.join(", "),
  );
  const activitySheet =
    xlsxEntries
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
      .map((entry) => entry.data.toString("utf8"))
      .find((xml) => xml.includes(edited.activities[0].name.slice(0, 12))) ??
    "";
  ok(activitySheet.length > 0, "xlsx: برگه فعالیت‌ها پیدا شد");
  const activityRows = [...activitySheet.matchAll(/<row r="(\d+)"/g)].length;
  ok(
    activityRows === edited.activities.length + 1,
    "xlsx: تعداد ردیف برگه فعالیت = فعالیت‌ها + سربرگ",
    `${activityRows} در برابر ${edited.activities.length + 1}`,
  );
  ok(activitySheet.includes(edited.activities[0].name.slice(0, 12)), "xlsx: نام فعالیت واقعی داخل برگه است");
  ok(
    /rightToLeft="1"/.test(activitySheet) || /rightToLeft="1"/.test(workbookXml),
    "xlsx: برگه‌ها راست‌به‌چپ تنظیم شده‌اند",
  );
  ok(/state="frozen"/.test(activitySheet), "xlsx: سطر سربرگ ثابت (freeze) شده است");
  ok(
    /<c r="[A-Z]+2"(?: s="\d+")?><v>-?\d/.test(activitySheet),
    "xlsx: ستون‌های عددی به‌صورت عدد ذخیره شده‌اند (نه متن)",
  );
  ok(/<numFmt |numFmtId="4"/.test(xmlText(xlsxEntries, "xl/styles.xml")), "xlsx: قالب عددی برای مبالغ تعریف شده است");
  ok(xlsxEntries.length >= 8, "xlsx: بسته شامل همه اجزای لازم است", String(xlsxEntries.length));

  /* ۴-ب. Excel 2003 (XML) */
  const xls = await artifact("xls");
  ok(xls.status === 200, "xls ⇒ ۲۰۰", `got ${xls.status}`);
  const xlsText = xls.body;
  ok(xlsText.startsWith("<?xml") || xlsText.startsWith("\uFEFF<?xml"), "xls: سند XML است");
  ok(/<Workbook[\s>]/.test(xlsText), "xls: ریشه Workbook دارد");
  ok((xlsText.match(/<Worksheet /g) ?? []).length >= 3, "xls: چند برگه دارد");
  ok(xlsText.includes(edited.meta.name.slice(0, 10)), "xls: نام پروژه داخل برگه است");
  ok(/ss:Type="Number"/.test(xlsText), "xls: سلول‌های عددی با نوع Number هستند");

  /* ۴-ج. CSV */
  const csv = await artifact("csv");
  ok(csv.status === 200, "csv ⇒ ۲۰۰", `got ${csv.status}`);
  ok(csv.bytes.subarray(0, 3).toString("hex") === "efbbbf", "csv: BOM برای Excel فارسی");
  const csvText = csv.body.replace(/^\uFEFF/, "");
  const csvLines = csvText.trim().split(/\r?\n/);
  ok(csvLines.length === edited.activities.length + 1, "csv: تعداد سطر = فعالیت‌ها + سربرگ", String(csvLines.length));
  ok(csvLines[0].includes("WBS") && csvLines[0].includes("عنوان فعالیت"), "csv: سربرگ ستون‌ها درست است");
  ok(csvText.includes(edited.activities[0].name.slice(0, 12)), "csv: داده واقعی فعالیت‌ها هست");
  const csvFirstCell = csvLines[1].split(",")[0];
  ok(/^\d+(\.\d+)*$/.test(csvFirstCell), "csv: ستون WBS سلسله‌مراتبی عددی است", csvFirstCell);

  /* ۴-د. JSON */
  const json = await artifact("json");
  ok(json.status === 200, "json ⇒ ۲۰۰", `got ${json.status}`);
  let parsedJson: { project?: { meta?: { name?: string }; activities?: unknown[] }; analysis?: { activities?: unknown[] } } = {};
  let jsonOk = true;
  try {
    parsedJson = JSON.parse(json.body) as typeof parsedJson;
  } catch {
    jsonOk = false;
  }
  ok(jsonOk, "json: بدنه JSON معتبر است");
  ok(parsedJson.project?.meta?.name === edited.meta.name, "json: نام پروژه یکسان است");
  ok(
    parsedJson.project?.activities?.length === edited.activities.length &&
      parsedJson.analysis?.activities?.length === edited.activities.length,
    "json: تعداد فعالیت‌ها در ورودی و تحلیل یکسان است",
  );

  /* ۴-ه. MS Project XML */
  const ms = await artifact("msproject");
  ok(ms.status === 200, "msproject ⇒ ۲۰۰", `got ${ms.status}`);
  ok(ms.body.startsWith("<?xml"), "msproject: اعلان XML در ابتدا");
  ok(ms.body.includes('xmlns="http://schemas.microsoft.com/project"'), "msproject: فضای‌نام MSPDI دارد");
  const taskBlocks = [...ms.body.matchAll(/<Task>[\s\S]*?<\/Task>/g)].map((match) => match[0]);
  const uids = taskBlocks.map((block) => block.match(/<UID>(\d+)<\/UID>/)?.[1] ?? "");
  ok(
    taskBlocks.length >= edited.activities.length,
    "msproject: تعداد وظیفه (Task) با فعالیت‌ها + فازها می‌خواند",
    `${taskBlocks.length} در برابر ${edited.activities.length}`,
  );
  ok(uids.every((uid) => uid.length > 0) && new Set(uids).size === uids.length, "msproject: UID وظیفه‌ها یکتا هستند");
  ok(
    taskBlocks.every((block) => /<Duration>PT\d+H\d+M\d+S<\/Duration>/.test(block)),
    "msproject: هر وظیفه مدت کامل ISO-8601 دارد (PT#H#M#S)",
  );
  ok(taskBlocks.every((block) => /<Cost>-?\d+(\.\d+)?<\/Cost>/.test(block)), "msproject: هزینه هر وظیفه ثبت شده است");
  ok(ms.body.includes(edited.activities[0].name.slice(0, 12)), "msproject: نام فعالیت‌ها داخل سند است");
  ok(/<PredecessorUID>\d+<\/PredecessorUID>/.test(ms.body), "msproject: وابستگی‌ها منتقل شده‌اند");

  /* ۴-و. گزارش چاپی (PDF از مسیر مرورگر) */
  const print = await artifact("pdf");
  ok(print.status === 200, "pdf/print ⇒ ۲۰۰", `got ${print.status}`);
  ok(print.body.trimStart().toLowerCase().startsWith("<!doctype html"), "print: سند HTML کامل است");
  ok(/lang="fa"/.test(print.body) && /dir="rtl"/.test(print.body), "print: زبان و جهت درست");
  ok(/@page[^}]*size:\s*A4/.test(print.body), "print: قاعده A4 تعریف شده است");
  ok(/@media print/.test(print.body), "print: قاعده‌های چاپ وجود دارد");
  ok(print.body.includes(edited.meta.name.slice(0, 10)), "print: نام پروژه در سند چاپی");
  ok(print.body.includes(edited.activities[0].name.slice(0, 10)), "print: فعالیت‌ها در سند چاپی");
  ok(/data:font\/woff2;base64,/.test(print.body), "print: قلم داخل سند جاسازی شده (چاپ بدون شبکه)");
  ok(!/<script/i.test(print.body), "print: هیچ اسکریپتی در سند چاپی نیست");
  ok(
    !/<(?:img|link)[^>]+(?:src|href)="https?:\/\//i.test(print.body),
    "print: هیچ منبع بیرونی شبکه‌ای ندارد",
  );

  /* ۴-ز. بسته تحویل */
  const pkg = await artifact("package");
  ok(pkg.status === 200, "package ⇒ ۲۰۰", `got ${pkg.status}`);
  const pkgEntries = readZip(pkg.bytes);
  ok(pkgEntries.length >= 6, "package: حداقل ۶ فایل دارد", String(pkgEntries.length));
  ok(pkgEntries.every((entry) => entry.crcOk), "package: CRC همه فایل‌ها سالم است");
  const pkgNames = pkgEntries.map((entry) => entry.name);
  ok(
    [".xlsx", ".csv", ".json", ".xml", ".html"].every((ext) => pkgNames.some((name) => name.endsWith(ext))),
    "package: همه فرمت‌های اصلی داخل بسته هستند",
    pkgNames.join(", "),
  );
  const manifest = pkgEntries.find((entry) => /\.(txt|md)$/i.test(entry.name));
  ok(Boolean(manifest), "package: فهرست تحویل (README) دارد", pkgNames.join(", "));

  /* ---------------- ۵. گزارش و اشتراک ---------------- */
  console.log("\n▶ ۵. گزارش و لینک اشتراک");
  const reportPage = await call(jar, `/report/${id}`);
  ok(reportPage.status === 200, "صفحه گزارش برای مالک ⇒ ۲۰۰", `got ${reportPage.status}`);
  ok(reportPage.body.includes(edited.meta.name.slice(0, 10)), "صفحه گزارش نام پروژه را نشان می‌دهد");

  const anonymous = await call(null, `/report/${id}`);
  ok(anonymous.status === 404, "صفحه گزارش برای ناشناس ⇒ ۴۰۴", `got ${anonymous.status}`);

  const share = await call(jar, `/api/projects/${id}/share`, {
    method: "POST",
    body: JSON.stringify({ label: "تحویل به کارفرما" }),
  });
  const shareBody = JSON.parse(share.body || "{}") as { token?: string; tokenId?: string };
  ok(share.status === 201 && (shareBody.token ?? "").length === 43, "لینک اشتراک ساخته شد", `got ${share.status}`);
  const shared = await call(null, `/s/${shareBody.token}`);
  ok(shared.status === 200, "لینک اشتراک برای مهمان باز است ⇒ ۲۰۰", `got ${shared.status}`);
  ok(shared.body.includes(edited.meta.name.slice(0, 10)), "لینک اشتراک نام پروژه را نشان می‌دهد");
  ok(!shared.body.includes("ساخت لینک جدید"), "لینک اشتراک کنترل مالک ندارد");

  const revoke = await call(jar, `/api/projects/${id}/share?tokenId=${shareBody.tokenId}`, { method: "DELETE" });
  ok(revoke.status === 200, "ابطال لینک انجام شد");
  ok((await call(null, `/s/${shareBody.token}`)).status === 404, "لینک باطل‌شده ⇒ ۴۰۴");

  /* ---------------- ۶. پاک‌سازی ---------------- */
  console.log("\n▶ ۶. پاک‌سازی");
  const removed = await call(jar, `/api/projects/${id}`, { method: "DELETE" });
  ok(removed.status === 200, "پروژه حذف شد");
  ok((await call(jar, `/api/projects/${id}`)).status === 404, "پس از حذف ⇒ ۴۰۴");

  /* حساب آزمون پاک می‌شود تا پایگاه با هر اجرا باد نکند */
  if (process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("delete from users where lower(username) = $1", [USERNAME]);
    await client.end();
  }

  console.log(
    failures.length === 0
      ? `\n✔ ${passed} بررسی سفر کامل (حساب → پروژه → خروجی) — همه موفق`
      : `\n✘ ${passed} موفق / ${failures.length} ناموفق`,
  );
  if (failures.length) {
    for (const failure of failures) console.error(`   - ${failure}`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("✘ اجرای آزمون سفر با خطا متوقف شد:", error);
  process.exit(1);
});
