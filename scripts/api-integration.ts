import "dotenv/config";
/**
 * HERMIPLAN — API integration, authorization and export-integrity tests.
 *
 * Runs against a live server (start one first):
 *   npx next start -p 3100 &
 *   BASE_URL=http://localhost:3100 npx tsx scripts/api-integration.ts
 *
 * Verifies the real user journey with real cookies and real downloaded files.
 */
import { execSync } from "node:child_process";
import { buildProjectFromTemplate } from "../src/lib/templates";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

/** unique per run so the in-memory rate limiter cannot leak between runs */
const RUN_ID = Date.now().toString().slice(-6);
const CLIENT_IP = `10.40.${Number(RUN_ID.slice(0, 3)) % 250}.${Number(RUN_ID.slice(3)) % 250}`;
/** unique per run so the per-phone OTP throttle never interferes */
const PHONE_A = `0912${RUN_ID.slice(0, 7)}1`.slice(0, 11);
const PHONE_B = `0912${RUN_ID.slice(0, 7)}2`.slice(0, 11);
const PHONE_C = `0912${RUN_ID.slice(0, 7)}3`.slice(0, 11);
const MINIMAL_PROJECT = JSON.stringify({
  meta: { name: "حداقلی", type: "general", currency: "IRR", startDate: "2026-01-03", statusDate: "2026-01-03" },
});
/**
 * Database connection used only to verify guest-project claiming directly in
 * PostgreSQL. Supplied by the environment (locally through .env) — no
 * credentials are embedded in this file.
 */
const PG = process.env.DATABASE_URL;
if (!PG) {
  console.error("DATABASE_URL must be set (see .env.example) to run the database assertions.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];
const ok = (condition: boolean, message: string, detail?: string) => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    failures.push(message);
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
};

/** Minimal cookie jar so guest/session identities behave like real browsers. */
class Jar {
  private cookies = new Map<string, string>();
  set(response: Response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const cookie of raw) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = pair.split("=");
      if (name) this.cookies.set(name.trim(), rest.join("="));
    }
  }
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

async function call(
  jar: Jar | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; response: Response }> {
  const headers = new Headers(init.headers ?? {});
  if (jar && jar.header()) headers.set("cookie", jar.header());
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  if (jar) jar.set(response);
  const body = await response.text();
  return { status: response.status, body, response };
}

function buildPayload(name: string): string {
  const p = buildProjectFromTemplate("construction");
  p.meta.name = name;
  p.meta.deadline = "2026-12-01";
  return JSON.stringify(p);
}

async function main() {
  console.log(`▶ سرور هدف: ${BASE} · IP آزمون: ${CLIENT_IP} · شماره‌ها: ${PHONE_A}/${PHONE_B}/${PHONE_C}\n`);

  /* ---------------- 1. ساخت پروژه و چرخه مالکیت ---------------- */
  console.log("▶ ۱. ساخت پروژه و دسترسی مالک");
  const owner = new Jar();
  const projectJson = buildPayload("پروژه تست یکپارچگی");
  const payload = JSON.stringify({ project: JSON.parse(projectJson), reportOptions: { sections: ["cover", "executive", "gantt"] } });

  const created = await call(owner, "/api/projects", { method: "POST", body: payload });
  ok(created.status === 201, "ساخت پروژه با ۲۰۱", created.body.slice(0, 120));
  const id = JSON.parse(created.body || "{}").id;
  ok(Boolean(id), "شناسه پروژه بازگردانده شد");

  ok(owner.has("hermiplan_guest"), "کوکی مهمان httpOnly صادر شد");
  const read = await call(owner, `/api/projects/${id}`);
  ok(read.status === 200, "مالک می‌تواند داده پروژه را بخواند");
  ok(JSON.parse(read.body).project.meta.name === "پروژه تست یکپارچگی", "داده خوانده‌شده با داده ذخیره‌شده یکسان است");

  /* ---------------- 2. جداسازی کاربران ---------------- */
  console.log("\n▶ ۲. جداسازی کاربران (Tenant Isolation)");
  const stranger = new Jar();
  const strangerRead = await call(stranger, `/api/projects/${id}`);
  ok(strangerRead.status === 403, "خواندن داده خام پروژه توسط غریبه ⇒ ۴۰۳", `got ${strangerRead.status}`);

  const strangerPatch = await call(stranger, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ project: JSON.parse(projectJson) }),
  });
  ok(strangerPatch.status === 403, "ویرایش پروژه توسط غریبه ⇒ ۴۰۳", `got ${strangerPatch.status}`);

  const strangerDelete = await call(stranger, `/api/projects/${id}`, { method: "DELETE" });
  ok(strangerDelete.status === 403, "حذف پروژه توسط غریبه ⇒ ۴۰۳", `got ${strangerDelete.status}`);

  const badId = await call(owner, "/api/projects/not-a-uuid");
  ok(badId.status === 400, "شناسه نامعتبر ⇒ ۴۰۰");

  /* ---------------- 3. گزارش قابل اشتراک و حالت خصوصی ---------------- */
  console.log("\n▶ ۳. لینک گزارش و کلید خصوصی");
  const publicReport = await call(new Jar(), `/report/${id}`);
  ok(publicReport.status === 200, "صفحه گزارش به‌صورت پیش‌فرض قابل اشتراک است");

  const privatise = await call(owner, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isPublic: false }),
  });
  ok(privatise.status === 200, "مالک می‌تواند گزارش را خصوصی کند");

  const privateReport = await call(new Jar(), `/report/${id}`);
  ok(privateReport.status === 404, "گزارش خصوصی برای غریبه ⇒ ۴۰۴", `got ${privateReport.status}`);
  const ownerReport = await call(owner, `/report/${id}`);
  ok(ownerReport.status === 200, "مالک همچنان گزارش خصوصی را می‌بیند");

  const apiAfterPrivate = await call(stranger, `/api/projects/${id}`);
  ok(apiAfterPrivate.status === 403, "داده خام پس از خصوصی‌سازی هم محدود است");

  /* ---------------- 4. ویرایش و ماندگاری ---------------- */
  console.log("\n▶ ۴. ویرایش، ماندگاری و رفرش");
  const renamed = JSON.parse(projectJson);
  renamed.meta.name = "پروژه ویرایش‌شده";
  renamed.activities = renamed.activities.slice(0, 5);
  const patched = await call(owner, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ project: renamed }),
  });
  ok(patched.status === 200, "ویرایش مالک با ۲۰۰ انجام شد", patched.body.slice(0, 120));

  const reread = await call(owner, `/api/projects/${id}`);
  const rereadBody = JSON.parse(reread.body);
  ok(rereadBody.project.meta.name === "پروژه ویرایش‌شده", "نام ویرایش‌شده ماندگار است");
  ok(rereadBody.project.activities.length === 5, "تعداد فعالیت ویرایش‌شده ماندگار است");
  ok(rereadBody.analysis.activities.length === 5, "تحلیل موتور با داده جدید هم‌خوان است");

  /* ---------------- 5. اعتبارسنجی و خطاها ---------------- */
  console.log("\n▶ ۵. اعتبارسنجی ورودی");
  // validation checks use their own client identity so a rate-limited bucket
  // from an earlier suite run cannot mask the actual validation behaviour
  const validationIp = `${CLIENT_IP}.200`;
  const post = (path: string, body: string) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": validationIp },
      body,
    });

  const badProject = await post("/api/projects", JSON.stringify({ project: { activities: "not-an-array" } }));
  ok(badProject.status === 422, "داده نامعتبر ⇒ ۴۲۲", `got ${badProject.status}`);
  const badJson = await post("/api/analyze", "{oops");
  ok(badJson.status === 400, "بدنه خراب ⇒ ۴۰۰", `got ${badJson.status}`);
  const tooBig = await post("/api/analyze", JSON.stringify({ project: { activities: [] } }).padEnd(3_100_000, " "));
  ok(tooBig.status === 413, "بدنه بیش از حد مجاز ⇒ ۴۱۳", `got ${tooBig.status}`);

  /* ---------------- 6. OTP و انتقال پروژه‌های مهمان ---------------- */
  console.log("\n▶ ۶. ورود با OTP و انتقال پروژه‌های مهمان");
  const phone = PHONE_A;
  const otpJar = new Jar();
  // ساخت یک پروژه مهمان در همین مرورگر
  const guestProject = await call(otpJar, "/api/projects", { method: "POST", body: payload });
  const guestId = JSON.parse(guestProject.body).id;

  const request = await call(otpJar, "/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "request", phone }),
  });
  const requestBody = JSON.parse(request.body);

  if (requestBody.loginUnavailable) {
    // Production configuration: no SMS provider and demo OTP not explicitly
    // enabled. Login must be refused, no code may be leaked, and nothing may
    // be written to the database.
    skipped += 6;
    ok(request.status === 503, "بدون سرویس پیامک و بدون فعال‌سازی صریح دمو ⇒ ۵۰۳", `got ${request.status}`);
    ok(!requestBody.code, "هیچ کدی در پاسخ فاش نمی‌شود");
    const rows = execSync(
      `psql "${PG}" -t -A -c "select count(*) from otp_codes where phone='${phone}'"`,
      { encoding: "utf-8" },
    ).trim();
    ok(rows === "0", "هیچ ردیف OTP نوشته نمی‌شود", rows);
    console.log("  ⚠ مسیر ورود (۶ بررسی) در این پیکربندی نادیده گرفته شد — حالت دمو فعال نیست");
    console.log("    (برای آزمودن ورود: HERMIPLAN_ALLOW_DEMO_OTP=1 را تنظیم کنید)");
  } else {
    ok(request.status === 200 && typeof requestBody.code === "string", "کد نمایشی صادر شد (حالت بدون سرویس پیامک)");

    // تلاش‌های نادرست ⇒ محدودیت brute-force
    let attemptsMessage = "";
    for (let i = 0; i < 5; i += 1) {
      const wrong = await call(otpJar, "/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "verify", phone, code: "00000" }),
      });
      attemptsMessage = JSON.parse(wrong.body).error ?? "";
    }
    ok(attemptsMessage.length > 0, "کد نادرست با پیام رد شد", attemptsMessage);
    const exhausted = await call(otpJar, "/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "verify", phone, code: requestBody.code }),
    });
    ok(exhausted.status === 401, "پس از ۵ تلاش نامعتبر، کد باطل می‌شود", `got ${exhausted.status}`);

    // کد تازه ⇒ ورود موفق + انتقال پروژه‌های مهمان
    const phone2 = PHONE_B;
    const request2 = await call(otpJar, "/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "request", phone: phone2 }),
    });
    const code2 = JSON.parse(request2.body).code;
    const verified = await call(otpJar, "/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "verify", phone: phone2, code: code2 }),
    });
    ok(verified.status === 200, "ورود با کد صحیح انجام شد", verified.body.slice(0, 120));
    ok(otpJar.has("hermiplan_session"), "کوکی نشست صادر شد");

    const claimed = JSON.parse(verified.body).claimedProjects ?? 0;
    ok(claimed >= 1, "پروژه‌های مهمان به حساب منتقل شدند", `claimed=${claimed}`);
    const ownerInDb = execSync(
      `psql "${PG}" -t -A -c "select coalesce(owner_user::text,'NULL') from projects where id='${guestId}'"`,
      { encoding: "utf-8" },
    ).trim();
    ok(ownerInDb !== "NULL" && ownerInDb.length > 10, "owner_user در پایگاه داده ثبت شد", ownerInDb);

    const sessionUser = await call(otpJar, "/api/auth");
    ok(JSON.parse(sessionUser.body).user?.phone === phone2, "نشست کاربر را برمی‌گرداند");
  }

  const logout = await call(otpJar, "/api/auth", { method: "DELETE" });
  ok(logout.status === 200, "خروج انجام شد");
  const afterLogout = await call(otpJar, "/api/auth");
  ok(JSON.parse(afterLogout.body).user === null, "نشست پس از خروج باطل است");
  await call(otpJar, `/api/projects/${guestId}`, { method: "DELETE" });

  /* ---------------- 7. حذف ---------------- */
  console.log("\n▶ ۷. حذف پروژه");
  const deleted = await call(owner, `/api/projects/${id}`, { method: "DELETE" });
  ok(deleted.status === 200, "حذف توسط مالک انجام شد");
  const afterDelete = await call(owner, `/api/projects/${id}`);
  ok(afterDelete.status === 404, "پروژه حذف‌شده دیگر یافت نمی‌شود");
  await call(otpJar, `/api/projects/${guestId}`, { method: "DELETE" });

  /* ---------------- 8. خروجی‌ها: فایل‌های واقعی ---------------- */
  console.log("\n▶ ۸. صحت فایل‌های خروجی");
  const exportPayload = JSON.stringify({ project: JSON.parse(projectJson), format: "package" });
  const pkg = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: exportPayload,
  });
  ok(pkg.status === 200, "بسته کامل دریافت شد");
  const zipBytes = new Uint8Array(await pkg.arrayBuffer());
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/it-package.zip", zipBytes);
  const names = execSync("python3 -c \"import zipfile;z=zipfile.ZipFile('/tmp/it-package.zip');print(','.join(z.namelist()));print(z.testzip())\"", {
    encoding: "utf-8",
  }).trim().split("\n");
  ok(names[0].split(",").length === 6, "بسته شامل ۶ فایل است", names[0]);
  ok(names[1] === "None", "یکپارچگی ZIP (CRC) تأیید شد", names[1]);

  const jsonExport = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: JSON.parse(projectJson), format: "json" }),
  });
  const exported = JSON.parse(await jsonExport.text());
  ok(jsonExport.status === 200 && exported.analysis, "خروجی JSON معتبر است");
  ok(
    exported.analysis.activities.length === exported.project.activities.length,
    "تعداد فعالیت در خروجی با ورودی یکسان است",
  );
  ok(
    exported.project.meta.deadline === "2026-12-01",
    "تاریخ هدف پایان در خروجی حفظ شده است",
  );

  const csvExport = await fetch(`${BASE}/api/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: JSON.parse(projectJson), format: "csv" }),
  });
  const csvBytes = new Uint8Array(await csvExport.arrayBuffer());
  ok(
    csvExport.status === 200 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    "CSV با BOM فارسی‌خوان تولید شد (EF BB BF)",
    `bytes=${csvBytes[0]},${csvBytes[1]},${csvBytes[2]}`,
  );
  const csv = new TextDecoder("utf-8").decode(csvBytes.subarray(3));
  ok(csv.split("\r\n").length > 5, "CSV شامل داده فعالیت است");
  ok(!/^[-+=@]/m.test(csv.split("\r\n")[1] ?? ""), "CSV در برابر تزریق فرمول ایمن است");

  /* ---------------- 9. محدودیت نرخ درخواست ---------------- */
  console.log("\n▶ ۹. محدودیت نرخ درخواست");
  let saw429 = false;
  for (let i = 0; i < 70; i += 1) {
    const response = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: MINIMAL_PROJECT,
    });
    if (response.status === 429) {
      saw429 = true;
      break;
    }
  }
  ok(saw429, "درخواست‌های پیاپی بیش از حد مجاز ⇒ ۴۲۹");
  const otherClient = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.99.99.99" },
    body: MINIMAL_PROJECT,
  });
  ok(otherClient.status === 200, "محدودیت به‌ازای هر IP است، نه سراسری", `got ${otherClient.status}`);

  console.log(`\n══════════ نتیجه: ${passed} موفق / ${failed} ناموفق / ${skipped} نادیده ══════════`);
  if (failures.length) failures.forEach((message) => console.error(`  • ${message}`));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("خطای اجرای آزمون:", error);
  process.exit(1);
});
