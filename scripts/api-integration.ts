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
import { Client } from "pg";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { readZip } from "./lib/zip-read";
import { randomUUID } from "node:crypto";

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

/**
 * Read-only database assertions go through the same `pg` driver the application
 * uses, so the suite needs nothing beyond Node and the project dependencies.
 * (The previous implementation shelled out to `psql`, which is not installed on
 * managed runtimes such as Netlify and made the suite unrunnable there.)
 */
let client: Client | null = null;
async function dbQuery(text: string, params: unknown[] = []): Promise<string> {
  if (!client) {
    client = new Client({ connectionString: PG });
    await client.connect();
  }
  const result = await client.query(text, params);
  return String(result.rows[0] ? Object.values(result.rows[0])[0] ?? "" : "");
}
/** Executes a statement that returns no value (test fixtures only). */
async function dbRun(text: string, params: unknown[] = []): Promise<number> {
  if (!client) {
    client = new Client({ connectionString: PG });
    await client.connect();
  }
  const result = await client.query(text, params);
  return result.rowCount ?? 0;
}
async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
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
  init: RequestInit & { ip?: string } = {},
): Promise<{ status: number; body: string; response: Response }> {
  const headers = new Headers(init.headers ?? {});
  // Every request carries the run's own client IP: the rate limiter is backed by
  // PostgreSQL, so without this header all runs would share one bucket and a
  // previous run could exhaust the quota of the next one. `ip` overrides it for
  // suites that intentionally issue many writes in a row.
  headers.set("x-forwarded-for", init.ip ?? CLIENT_IP);
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
  // Design decision: a non-owner must not be able to distinguish "does not
  // exist" from "belongs to someone else", so the answer is 404 — never 403,
  // which would confirm the UUID is real.
  const stranger = new Jar();
  const strangerRead = await call(stranger, `/api/projects/${id}`);
  ok(strangerRead.status === 404, "خواندن داده خام پروژه توسط غریبه ⇒ ۴۰۴ (بدون افشای وجود)", `got ${strangerRead.status}`);
  ok(!strangerRead.body.includes("پروژه تست یکپارچگی"), "پاسخ به غریبه هیچ داده‌ای از پروژه را افشا نمی‌کند", strangerRead.body.slice(0, 80));

  const strangerPatch = await call(stranger, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ project: JSON.parse(projectJson) }),
  });
  ok(strangerPatch.status === 404, "ویرایش پروژه توسط غریبه ⇒ ۴۰۴", `got ${strangerPatch.status}`);

  const strangerDelete = await call(stranger, `/api/projects/${id}`, { method: "DELETE" });
  ok(strangerDelete.status === 404, "حذف پروژه توسط غریبه ⇒ ۴۰۴", `got ${strangerDelete.status}`);

  const strangerVisibility = await call(stranger, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isPublic: true }),
  });
  ok(strangerVisibility.status === 404, "غریبه نمی‌تواند پروژه را عمومی کند ⇒ ۴۰۴", `got ${strangerVisibility.status}`);

  const badId = await call(owner, "/api/projects/not-a-uuid");
  ok(badId.status === 400, "شناسه نامعتبر ⇒ ۴۰۰");

  /* ---------------- 3. گزارش: خصوصی به‌صورت پیش‌فرض + لینک اشتراک با توکن ---------------- */
  console.log("\n▶ ۳. گزارش خصوصی، لینک اشتراک توکنی و ابطال");
  const defaultReport = await call(new Jar(), `/report/${id}`);
  ok(defaultReport.status === 404, "گزارش به‌صورت پیش‌فرض خصوصی است (غریبه ⇒ ۴۰۴)", `got ${defaultReport.status}`);
  const ownerReportDefault = await call(owner, `/report/${id}`);
  ok(ownerReportDefault.status === 200, "مالک گزارش خصوصی خود را می‌بیند", `got ${ownerReportDefault.status}`);

  const strangerShare = await call(stranger, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  ok(strangerShare.status === 404, "غریبه نمی‌تواند لینک اشتراک بسازد ⇒ ۴۰۴", `got ${strangerShare.status}`);

  const crossOriginShare = await call(owner, `/api/projects/${id}/share`, {
    method: "POST",
    body: "{}",
    headers: { origin: "https://evil.example" },
  });
  ok(crossOriginShare.status === 403, "ساخت لینک از دامنه دیگر رد می‌شود (CSRF) ⇒ ۴۰۳", `got ${crossOriginShare.status}`);

  const badExpiry = await call(owner, `/api/projects/${id}/share`, {
    method: "POST",
    body: JSON.stringify({ expiresAt: "2020-01-01T00:00:00.000Z" }),
  });
  ok(badExpiry.status === 422, "تاریخ انقضای گذشته پذیرفته نمی‌شود ⇒ ۴۲۲", `got ${badExpiry.status}`);

  const share = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  ok(share.status === 201, "مالک لینک اشتراک می‌سازد ⇒ ۲۰۱", share.body.slice(0, 160));
  const shareBody = JSON.parse(share.body || "{}") as { token?: string; url?: string; tokenId?: string };
  const shareToken = shareBody.token ?? "";
  ok(shareToken.length === 43 && /^[A-Za-z0-9_-]+$/.test(shareToken), "توکن ۲۵۶ بیت base64url است (۴۳ نویسه)");
  ok(
    shareToken !== id && !shareToken.includes(id.replace(/-/g, "")),
    "توکن از شناسه پروژه مشتق نشده است",
  );
  ok((shareBody.url ?? "").includes(`/s/${shareToken}`), "آدرس عمومی لینک روی /s/<token> است");

  // The token itself must never be stored: only its SHA-256 digest.
  const storedHash = await dbQuery("select token_hash from project_share_tokens where id = $1", [shareBody.tokenId]);
  ok(storedHash.length === 64 && storedHash !== shareToken, "در پایگاه داده فقط هش SHA-256 ذخیره شده است");
  const auditRows = await dbQuery(
    "select count(*) from project_events where project_id = $1 and kind = 'share-created'",
    [id],
  );
  ok(Number(auditRows) >= 1, "ساخت لینک در دفتر رخدادها ثبت شده است");

  const sharedReport = await call(new Jar(), `/s/${shareToken}`);
  ok(sharedReport.status === 200, "لینک اشتراک گزارش را برای غریبه باز می‌کند", `got ${sharedReport.status}`);

  const uuidStillForbidden = await call(new Jar(), `/report/${id}`);
  ok(
    uuidStillForbidden.status === 404,
    "دانستن UUID حتی پس از ساخت لینک، مجوز نیست ⇒ ۴۰۴",
    `got ${uuidStillForbidden.status}`,
  );

  const rawAfterShare = await call(stranger, `/api/projects/${id}`);
  ok(rawAfterShare.status === 404, "لینک اشتراک دسترسی به داده خام را باز نمی‌کند", `got ${rawAfterShare.status}`);
  const editAfterShare = await call(stranger, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ project: JSON.parse(projectJson) }),
  });
  ok(editAfterShare.status === 404, "لینک اشتراک حق ویرایش نمی‌دهد", `got ${editAfterShare.status}`);

  const metadata = await call(owner, `/api/projects/${id}/share`);
  ok(metadata.status === 200, "مالک فهرست لینک‌ها را می‌بیند", `got ${metadata.status}`);
  ok(!metadata.body.includes(shareToken), "فهرست لینک‌ها توکن خام را افشا نمی‌کند");

  const revoked = await call(owner, `/api/projects/${id}/share?tokenId=${shareBody.tokenId}`, { method: "DELETE" });
  ok(revoked.status === 200, "ابطال یک لینک ⇒ ۲۰۰", `got ${revoked.status}`);
  const afterRevoke = await call(new Jar(), `/s/${shareToken}`);
  ok(afterRevoke.status === 404, "لینک باطل‌شده فوراً ⇒ ۴۰۴", `got ${afterRevoke.status}`);

  const second = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  const secondToken = (JSON.parse(second.body || "{}") as { token?: string }).token ?? "";
  ok(second.status === 201 && secondToken.length === 43, "ساخت لینک دوم موفق است");
  const revokeAll = await call(owner, `/api/projects/${id}/share?all=1`, { method: "DELETE" });
  ok(revokeAll.status === 200, "ابطال همه لینک‌ها ⇒ ۲۰۰");
  const afterRevokeAll = await call(new Jar(), `/s/${secondToken}`);
  ok(afterRevokeAll.status === 404, "پس از ابطال همه، لینک دوم ⇒ ۴۰۴", `got ${afterRevokeAll.status}`);

  const publicFlag = await dbQuery("select case when is_public then 't' else 'f' end from projects where id = $1", [id]);
  ok(publicFlag === "f", "پس از ابطال همه لینک‌ها، پروژه دوباره خصوصی است");

  /* ------ ۳-ب. بازبینی سخت‌گیرانه: انقضا، ابطال، سقف لینک، افشا ------ */
  console.log("\n▶ ۳-ب. بازبینی لینک اشتراک: انقضا، تکرارِ پس از ابطال، سقف، افشا");

  // (۱) an expired link must stop working even though it was never revoked
  const expiring = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  const expiringBody = JSON.parse(expiring.body || "{}") as { token?: string; tokenId?: string };
  const expiringToken = expiringBody.token ?? "";
  ok(expiringToken.length === 43, "لینک دارای تاریخ انقضا ساخته شد");
  const aliveBeforeExpiry = await call(new Jar(), `/s/${expiringToken}`);
  ok(aliveBeforeExpiry.status === 200, "پیش از انقضا لینک کار می‌کند", `got ${aliveBeforeExpiry.status}`);
  // The API refuses to create an already-expired link, so expiry is forced here.
  await dbRun("update project_share_tokens set expires_at = now() - interval '1 second' where id = $1", [
    expiringBody.tokenId,
  ]);
  const afterExpiry = await call(new Jar(), `/s/${expiringToken}`);
  ok(afterExpiry.status === 404, "پس از انقضا لینک فوراً ⇒ ۴۰۴", `got ${afterExpiry.status}`);
  const stillNotRaw = await call(stranger, `/api/projects/${id}`);
  ok(stillNotRaw.status === 404, "لینک منقضی هیچ دسترسی جانبی نمی‌دهد");

  // (۲) revoking one link must not revoke its sibling, and a revoked link must
  //     never come back to life after a new link is issued (no id reuse).
  const siblingA = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  const siblingB = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  const tokenA = (JSON.parse(siblingA.body || "{}") as { token?: string }).token ?? "";
  const bodyB = JSON.parse(siblingB.body || "{}") as { token?: string; tokenId?: string };
  const tokenB = bodyB.token ?? "";
  ok(tokenA !== tokenB, "دو لینک هم‌زمان توکن یکسان ندارند");
  await call(owner, `/api/projects/${id}/share?tokenId=${(JSON.parse(siblingA.body || "{}") as { tokenId?: string }).tokenId}`, {
    method: "DELETE",
  });
  ok((await call(new Jar(), `/s/${tokenA}`)).status === 404, "لینک باطل‌شده ⇒ ۴۰۴");
  ok((await call(new Jar(), `/s/${tokenB}`)).status === 200, "ابطال یک لینک، لینک دیگر را نمی‌بندد");
  await call(owner, `/api/projects/${id}/share?all=1`, { method: "DELETE" });
  ok((await call(new Jar(), `/s/${tokenB}`)).status === 404, "ابطال همه ⇒ لینک دوم ۴۰۴");
  const reissue = await call(owner, `/api/projects/${id}/share`, { method: "POST", body: "{}" });
  const reissuedToken = (JSON.parse(reissue.body || "{}") as { token?: string }).token ?? "";
  ok(reissuedToken !== tokenB, "لینک تازه توکن تازه دارد");
  ok((await call(new Jar(), `/s/${tokenB}`)).status === 404, "لینک باطل‌شده با صدور لینک جدید زنده نمی‌شود");
  ok((await call(new Jar(), `/s/${reissuedToken}`)).status === 200, "لینک تازه کار می‌کند");

  // (۳) hard cap on live links (bounded blast radius).
  // The extra links are seeded in the database on purpose: reaching the cap
  // through the API would first hit the "10 creations per hour" rate limit, and
  // the test would then be measuring the limiter instead of the cap.
  for (let index = 0; index < 9; index += 1) {
    await dbRun("insert into project_share_tokens (project_id, token_hash) values ($1, $2)", [
      id,
      `seed-${randomUUID()}-${index}`,
    ]);
  }
  const listed = await call(owner, `/api/projects/${id}/share`);
  const listedBody = JSON.parse(listed.body || "{}") as { tokens?: { active: boolean }[] };
  ok(
    (listedBody.tokens ?? []).filter((token) => token.active).length >= 10,
    "پایگاه اکنون ۱۰ لینک فعال دارد",
  );
  const overCap = await call(owner, `/api/projects/${id}/share`, {
    method: "POST",
    body: "{}",
    // A fresh client identity: 409 must come from the per-project cap, never from
    // the per-IP creation quota (which would make the assertion meaningless).
    ip: `${CLIENT_IP}.62`,
  });
  ok(overCap.status === 409, "سقف ۱۰ لینک فعال اعمال می‌شود ⇒ ۴۰۹ (نه ۴۲۹)", `got ${overCap.status}`);

  // (۴) CSRF on revocation
  const crossOriginRevoke = await call(owner, `/api/projects/${id}/share?all=1`, {
    method: "DELETE",
    headers: { origin: "https://evil.example" },
  });
  ok(crossOriginRevoke.status === 403, "ابطال از دامنه دیگر رد می‌شود ⇒ ۴۰۳", `got ${crossOriginRevoke.status}`);

  // (۵) the shared page must not expose owner controls or the project raw data
  const sharedHtml = await call(new Jar(), `/s/${reissuedToken}`);
  ok(sharedHtml.status === 200, "صفحه اشتراکی ۲۰۰ است");
  ok(!sharedHtml.body.includes("ساخت لینک جدید"), "صفحه اشتراکی دکمه ساخت لینک ندارد");
  ok(!sharedHtml.body.includes("ابطال همه لینک‌ها"), "صفحه اشتراکی کنترل ابطال ندارد");
  ok(sharedHtml.body.includes("فقط‌خواندنی"), "صفحه اشتراکی صریحاً فقط‌خواندنی است");

  // (۶) cleanup: revoke everything so the project ends private again
  await call(owner, `/api/projects/${id}/share?all=1`, { method: "DELETE" });
  const finalFlag = await dbQuery("select case when is_public then 't' else 'f' end from projects where id = $1", [id]);
  ok(finalFlag === "f", "وضعیت نهایی: پروژه خصوصی است");

  /* ------ ۳-ب-۲. بدنهٔ خالی در برابر بدنهٔ ناقص ------ */
  console.log("\n▶ ۳-ب-۲. بدنهٔ خالیِ مجاز و بدنهٔ ناقصِ رد‌شده");
  {
    // Own client IP: the share-create quota is 10/hour per IP, and this block must
    // not eat into the budget the revocation/expiry scenarios rely on.
    const ip = `${CLIENT_IP}.61`;
    const noBody = await call(owner, `/api/projects/${id}/share`, { method: "POST", ip });
    ok(noBody.status === 201, "POST بدون بدنه، لینک با پیش‌فرض می‌سازد", `got ${noBody.status}: ${noBody.body.slice(0, 80)}`);
    const created = JSON.parse(noBody.body || "{}") as { token?: string; tokenId?: string };
    ok((created.token ?? "").length === 43, "لینک ساخته‌شده توکن ۴۳ نویسه‌ای دارد");

    const truncated = await call(owner, `/api/projects/${id}/share`, {
      method: "POST",
      body: '{"label":',
      headers: { "content-type": "application/json" },
      ip,
    });
    ok(truncated.status === 400, "بدنهٔ JSON ناقص ⇒ ۴۰۰ (نه ساخت بی‌صدا)", `got ${truncated.status}`);

    if (created.tokenId) {
      const revoked = await call(owner, `/api/projects/${id}/share?tokenId=${created.tokenId}`, { method: "DELETE", ip });
      ok(revoked.status === 200, "لینک بی‌بدنه هم قابل ابطال است", `got ${revoked.status}`);
    }
  }

  /* ------ ۳-ج. سازگاری با لینک‌های قدیمی و پروژه حذف‌شده ------ */
  console.log("\n▶ ۳-ج. لینک قدیمی (پیش از توکن)، پروژه حذف‌شده");

  // A project published the old way — `is_public = true`, no token — must not be
  // reachable, because a UUID used to be the only "credential" and that is
  // exactly the model this release removes.
  const legacyFlag = await call(owner, `/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isPublic: true }),
  });
  ok(legacyFlag.status === 200, "پرچم عمومی قدیمی قابل تنظیم است ⇒ ۲۰۰", `got ${legacyFlag.status}`);
  const legacyRead = await dbQuery("select case when is_public then 't' else 'f' end from projects where id = $1", [id]);
  ok(legacyRead === "t", "پایگاه، وضعیت «منتشرشده» را ثبت کرد");
  const legacyStranger = await call(new Jar(), `/report/${id}`);
  ok(legacyStranger.status === 404, "پرچم عمومی به‌تنهایی دسترسی نمی‌دهد (لینک قدیمی) ⇒ ۴۰۴", `got ${legacyStranger.status}`);
  const legacyRaw = await call(stranger, `/api/projects/${id}`);
  ok(legacyRaw.status === 404, "داده خام هم با پرچم عمومی قدیمی باز نمی‌شود");
  const legacyList = await call(stranger, "/api/projects");
  ok(!legacyList.body.includes(id), "پروژه در فهرست پروژه‌های غریبه دیده نمی‌شود");

  // Revoking everything must also clear the flag, so the UI cannot claim the
  // report is shared while nothing grants access.
  await call(owner, `/api/projects/${id}/share?all=1`, { method: "DELETE" });
  const flagAfterAll = await dbQuery("select case when is_public then 't' else 'f' end from projects where id = $1", [id]);
  ok(flagAfterAll === "f", "ابطال همه، پرچم عمومی را هم برمی‌دارد");

  // A token that survives its project must stop working: the row is deleted by
  // ON DELETE CASCADE, so this also proves the foreign key is real.
  const doomedProject = await call(owner, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ project: JSON.parse(projectJson), reportOptions: {} }),
  });
  const doomedId = (JSON.parse(doomedProject.body || "{}") as { id?: string }).id ?? "";
  const doomedShare = await call(owner, `/api/projects/${doomedId}/share`, { method: "POST", body: "{}" });
  const doomedToken = (JSON.parse(doomedShare.body || "{}") as { token?: string }).token ?? "";
  ok(doomedToken.length === 43, "لینک برای پروژه‌ای که حذف خواهد شد ساخته شد");
  ok((await call(new Jar(), `/s/${doomedToken}`)).status === 200, "لینک پیش از حذف پروژه کار می‌کند");
  const doomedDelete = await call(owner, `/api/projects/${doomedId}`, { method: "DELETE" });
  ok(doomedDelete.status === 200 || doomedDelete.status === 204, "حذف پروژه ⇒ ۲۰۰/۲۰۴", `got ${doomedDelete.status}`);
  const orphanToken = await call(new Jar(), `/s/${doomedToken}`);
  ok(orphanToken.status === 404, "لینک پروژه حذف‌شده ⇒ ۴۰۴", `got ${orphanToken.status}`);
  const tokenRows = await dbQuery("select count(*) from project_share_tokens where project_id = $1", [doomedId]);
  ok(Number(tokenRows) === 0, "توکن‌ها با حذف پروژه پاک شدند (CASCADE)");

  const ownerReport = await call(owner, `/report/${id}`);
  ok(ownerReport.status === 200, "مالک همچنان گزارش را می‌بیند");
  const apiAfterPrivate = await call(stranger, `/api/projects/${id}`);
  ok(apiAfterPrivate.status === 404, "داده خام پس از خصوصی‌سازی هم محدود است");

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

  /* ---------------- 4-ب. تاریخچه نسخه‌ها، بازگردانی، ویرایش هم‌زمان ---------- */
  console.log("\n▶ ۴-ب. تاریخچه نسخه‌ها، بازگردانی و ویرایش هم‌زمان");

  const historyProject = JSON.parse(projectJson);
  historyProject.meta.name = "پروژه تاریخچه";
  historyProject.activities = historyProject.activities.slice(0, 4);
  const historyCreated = await call(owner, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ project: historyProject, reportOptions: {} }),
  });
  const historyId = (JSON.parse(historyCreated.body || "{}") as { id?: string }).id ?? "";
  ok(historyCreated.status === 201 && Boolean(historyId), "پروژه آزمون تاریخچه ساخته شد", historyCreated.body.slice(0, 120));
  ok(
    (JSON.parse(historyCreated.body || "{}") as { version?: number }).version === 1,
    "پاسخ ساخت، شماره نسخه ۱ را برمی‌گرداند",
  );

  const initialList = await call(owner, `/api/projects/${historyId}/versions`);
  const initialBody = JSON.parse(initialList.body || "{}") as {
    versions?: { version: number; reason: string; isCurrent: boolean; activities: number; reasonLabel: string }[];
    currentVersion?: number;
  };
  ok(initialList.status === 200, "فهرست تاریخچه با ۲۰۰", initialList.body.slice(0, 120));
  ok(initialBody.currentVersion === 1, "نسخه فعلی ۱ است", String(initialBody.currentVersion));
  ok(initialBody.versions?.length === 1, "یک نسخه ثبت شده", String(initialBody.versions?.length));
  ok(initialBody.versions?.[0]?.reason === "create", "علت نسخه اول «ایجاد» است", initialBody.versions?.[0]?.reason);
  ok(initialBody.versions?.[0]?.isCurrent === true, "نسخه اول جاری علامت خورده است");
  ok(initialBody.versions?.[0]?.activities === 4, "تعداد فعالیت‌ها در نسخه ثبت شده", String(initialBody.versions?.[0]?.activities));

  const editedProject = JSON.parse(JSON.stringify(historyProject));
  editedProject.meta.name = "پروژه تاریخچه — ویرایش دوم";
  editedProject.activities = editedProject.activities.slice(0, 2);
  const edit1 = await call(owner, `/api/projects/${historyId}`, {
    method: "PATCH",
    body: JSON.stringify({ project: editedProject }),
  });
  const edit1Body = JSON.parse(edit1.body || "{}") as { version?: number; unchanged?: boolean };
  ok(edit1.status === 200, "ویرایش اول با ۲۰۰", edit1.body.slice(0, 120));
  ok(edit1Body.version === 2, "شماره نسخه به ۲ رسید", String(edit1Body.version));
  ok(edit1Body.unchanged === false, "ویرایش واقعی، تغییر علامت خورده است");

  const editSame = await call(owner, `/api/projects/${historyId}`, {
    method: "PATCH",
    body: JSON.stringify({ project: editedProject }),
  });
  const editSameBody = JSON.parse(editSame.body || "{}") as { version?: number; unchanged?: boolean };
  ok(editSame.status === 200 && editSameBody.unchanged === true, "ذخیره محتوای یکسان، تغییر محسوب نمی‌شود");
  ok(editSameBody.version === 2, "ذخیره تکراری شماره نسخه را مصرف نمی‌کند", String(editSameBody.version));

  const afterEdits = JSON.parse((await call(owner, `/api/projects/${historyId}/versions`)).body || "{}") as {
    versions?: { version: number; reason: string }[];
  };
  ok(afterEdits.versions?.length === 2, "دو نسخه در تاریخچه", String(afterEdits.versions?.length));
  ok(afterEdits.versions?.[0]?.reason === "autosave", "علت نسخه دوم «ذخیره ویرایش» است", afterEdits.versions?.[0]?.reason);

  const staleEdit = await call(owner, `/api/projects/${historyId}`, {
    method: "PATCH",
    body: JSON.stringify({ project: historyProject, expectedVersion: 1 }),
  });
  const staleBody = JSON.parse(staleEdit.body || "{}") as { currentVersion?: number };
  ok(staleEdit.status === 409, "ویرایش بر پایه نسخه قدیمی ⇒ ۴۰۹", `got ${staleEdit.status}`);
  ok(staleBody.currentVersion === 2, "پاسخ ۴۰۹ نسخه فعلی را می‌گوید", String(staleBody.currentVersion));
  const afterConflict = await call(owner, `/api/projects/${historyId}`);
  ok(
    (JSON.parse(afterConflict.body || "{}") as { project?: { meta?: { name?: string } } }).project?.meta?.name ===
      "پروژه تاریخچه — ویرایش دوم",
    "ویرایش ردشده هیچ تغییری اعمال نکرد",
  );

  const detail = await call(owner, `/api/projects/${historyId}/versions/1`);
  const detailBody = JSON.parse(detail.body || "{}") as {
    project?: { meta?: { name?: string } };
    reasonLabel?: string;
    createdAt?: string;
  };
  ok(detail.status === 200, "خواندن نسخه ۱ با ۲۰۰", detail.body.slice(0, 120));
  ok(detailBody.project?.meta?.name === "پروژه تاریخچه", "محتوای نسخه ۱ همان وضعیت اولیه است");
  ok(Boolean(detailBody.reasonLabel), "برچسب فارسی علت برگردانده شد");
  ok(Boolean(detailBody.createdAt), "زمان نسخه برگردانده شد");

  const restore = await call(owner, `/api/projects/${historyId}/versions/1/restore`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion: 2 }),
  });
  const restoreBody = JSON.parse(restore.body || "{}") as { version?: number; restoredFrom?: number };
  ok(restore.status === 200, "بازگردانی با ۲۰۰", restore.body.slice(0, 160));
  ok(restoreBody.restoredFrom === 1, "پاسخ می‌گوید از کدام نسخه بازگردانی شد", String(restoreBody.restoredFrom));
  ok(restoreBody.version === 4, "بازگردانی دو نسخه تازه می‌سازد (۳ پیش از بازگردانی، ۴ بازگردانی)", String(restoreBody.version));

  const afterRestore = await call(owner, `/api/projects/${historyId}`);
  const afterRestoreBody = JSON.parse(afterRestore.body || "{}") as {
    project?: { meta?: { name?: string }; activities?: unknown[] };
    version?: number;
  };
  ok(afterRestoreBody.project?.meta?.name === "پروژه تاریخچه", "نام به وضعیت نسخه ۱ بازگشت");
  ok(afterRestoreBody.project?.activities?.length === 4, "فعالیت‌ها به وضعیت نسخه ۱ بازگشتند");
  ok(afterRestoreBody.version === 4, "نسخه جاری پروژه ۴ است", String(afterRestoreBody.version));

  const timeline = JSON.parse((await call(owner, `/api/projects/${historyId}/versions`)).body || "{}") as {
    versions?: { version: number; reason: string; isCurrent: boolean }[];
  };
  ok(timeline.versions?.length === 4, "چهار نسخه در تاریخچه", String(timeline.versions?.length));
  ok(
    timeline.versions?.[0]?.reason === "restore" && timeline.versions?.[1]?.reason === "pre-restore",
    "ترتیب «بازگردانی» و «پیش از بازگردانی» درست ثبت شده",
    `${timeline.versions?.[0]?.reason}/${timeline.versions?.[1]?.reason}`,
  );
  ok(timeline.versions?.[0]?.isCurrent === true, "نسخه بازگردانی‌شده جاری است");
  ok(
    timeline.versions?.find((item) => item.version === 1)?.isCurrent === false,
    "نسخه ۱ دیگر جاری نیست",
  );

  const restoreMissing = await call(owner, `/api/projects/${historyId}/versions/99/restore`, { method: "POST", body: "{}" });
  ok(restoreMissing.status === 404, "بازگردانی نسخه ناموجود ⇒ ۴۰۴", `got ${restoreMissing.status}`);
  const detailMissing = await call(owner, `/api/projects/${historyId}/versions/99`);
  ok(detailMissing.status === 404, "خواندن نسخه ناموجود ⇒ ۴۰۴", `got ${detailMissing.status}`);

  const strangerVersions = await call(stranger, `/api/projects/${historyId}/versions`);
  ok(strangerVersions.status === 404, "غریبه تاریخچه را نمی‌بیند ⇒ ۴۰۴", `got ${strangerVersions.status}`);
  const strangerRestore = await call(stranger, `/api/projects/${historyId}/versions/1/restore`, {
    method: "POST",
    body: "{}",
  });
  ok(strangerRestore.status === 404, "غریبه نمی‌تواند بازگردانی کند ⇒ ۴۰۴", `got ${strangerRestore.status}`);
  const anonVersions = await call(new Jar(), `/api/projects/${historyId}/versions`);
  ok(anonVersions.status === 404, "بدون کوکی، تاریخچه ⇒ ۴۰۴", `got ${anonVersions.status}`);

  const shareForHistory = await call(owner, `/api/projects/${historyId}/share`, {
    method: "POST",
    body: "{}",
    // Separate quota identity: this check is about history access, not throttling.
    ip: `${CLIENT_IP}.63`,
  });
  const historyToken = (JSON.parse(shareForHistory.body || "{}") as { token?: string }).token ?? "";
  ok(
    shareForHistory.status === 201 && historyToken.length === 43,
    "لینک اشتراک برای آزمون تاریخچه ساخته شد",
    `status ${shareForHistory.status} — ${shareForHistory.body.slice(0, 120)}`,
  );
  const viaShare = await call(new Jar(), `/api/projects/${historyId}/versions`, {
    headers: { "x-share-token": historyToken },
  });
  ok(viaShare.status === 404, "لینک اشتراک، تاریخچه را باز نمی‌کند ⇒ ۴۰۴", `got ${viaShare.status}`);
  const sharePage = await call(new Jar(), `/s/${historyToken}`);
  ok(sharePage.status === 200, "خود لینک اشتراک همچنان صفحه گزارش را نشان می‌دهد", `got ${sharePage.status}`);
  await call(owner, `/api/projects/${historyId}/share?all=1`, { method: "DELETE" });

  const restoreAudit = await dbQuery(
    "select count(*) from project_events where project_id = $1 and kind = 'restore'",
    [historyId],
  );
  ok(Number(restoreAudit) >= 1, "بازگردانی در دفتر رخدادها ثبت شد");
  const snapshotRows = await dbQuery(
    "select count(*) from project_versions where project_id = $1",
    [historyId],
  );
  ok(Number(snapshotRows) === 4, "چهار ردیف نسخه در پایگاه", String(snapshotRows));

  /* ---- ۴-ج. مقایسه نسخه‌ها (diff) ---- */
  console.log("\n▶ ۴-ج. مقایسه نسخه‌ها");
  const diffSame = await call(owner, `/api/projects/${historyId}/versions/1/diff`);
  const diffSameBody = JSON.parse(diffSame.body || "{}") as {
    from?: { version: number };
    to?: { version: number };
    diff?: { identical?: boolean; counts?: { total: number }; groups?: unknown[]; settings?: unknown[] };
  };
  ok(diffSame.status === 200, "مقایسه نسخه ۱ با نسخه جاری با ۲۰۰", diffSame.body.slice(0, 120));
  ok(diffSameBody.from?.version === 1, "پاسخ می‌گوید مبدأ نسخه ۱ است", String(diffSameBody.from?.version));
  ok(diffSameBody.to?.version === 4, "مقایسه پیش‌فرض با نسخه جاری انجام می‌شود", String(diffSameBody.to?.version));
  ok(
    diffSameBody.diff?.identical === true && (diffSameBody.diff?.counts?.total ?? -1) === 0,
    "پس از بازگردانی، نسخه ۱ و وضعیت جاری تفاوتی ندارند",
    JSON.stringify(diffSameBody.diff?.counts),
  );

  const diffChanged = await call(owner, `/api/projects/${historyId}/versions/2/diff`);
  const diffChangedBody = JSON.parse(diffChanged.body || "{}") as {
    diff?: {
      identical?: boolean;
      counts?: { total: number; changed?: number };
      settings?: { key: string; label: string }[];
      groups?: { key: string; label: string; entries: { status: string; fields: { key: string }[] }[] }[];
    };
  };
  ok(diffChanged.status === 200 && diffChangedBody.diff?.identical === false, "نسخه ۲ با وضعیت جاری تفاوت دارد");
  ok((diffChangedBody.diff?.counts?.total ?? 0) > 0, "تعداد تغییرات بزرگ‌تر از صفر است", String(diffChangedBody.diff?.counts?.total));
  ok(
    Boolean(diffChangedBody.diff?.settings?.some((field) => field.key === "name")),
    "تغییر نام پروژه در بخش تنظیمات گزارش می‌شود",
    JSON.stringify(diffChangedBody.diff?.settings?.map((field) => field.key)),
  );
  ok(
    Boolean(diffChangedBody.diff?.groups?.some((group) => group.key === "activities" && group.entries.length > 0)),
    "تغییر فعالیت‌ها در گروه خودش گزارش می‌شود",
    JSON.stringify(diffChangedBody.diff?.groups?.map((group) => group.key)),
  );

  const diffPair = await call(owner, `/api/projects/${historyId}/versions/1/diff?against=2`);
  const diffPairBody = JSON.parse(diffPair.body || "{}") as { from?: { version: number }; to?: { version: number } };
  ok(diffPair.status === 200 && diffPairBody.to?.version === 2, "مقایسه دو نسخه مشخص با پارامتر against کار می‌کند");

  const diffBadAgainst = await call(owner, `/api/projects/${historyId}/versions/1/diff?against=abc`);
  ok(diffBadAgainst.status === 400, "نسخه مقایسه نامعتبر ⇒ ۴۰۰", `got ${diffBadAgainst.status}`);
  const diffMissing = await call(owner, `/api/projects/${historyId}/versions/99/diff`);
  ok(diffMissing.status === 404, "نسخه ناموجود ⇒ ۴۰۴", `got ${diffMissing.status}`);
  const diffMissingAgainst = await call(owner, `/api/projects/${historyId}/versions/1/diff?against=99`);
  ok(diffMissingAgainst.status === 404, "نسخه مقایسه ناموجود ⇒ ۴۰۴", `got ${diffMissingAgainst.status}`);
  const diffStranger = await call(stranger, `/api/projects/${historyId}/versions/1/diff`);
  ok(diffStranger.status === 404, "غریبه نمی‌تواند نسخه‌ها را مقایسه کند ⇒ ۴۰۴", `got ${diffStranger.status}`);
  const diffAnon = await call(new Jar(), `/api/projects/${historyId}/versions/1/diff`);
  ok(diffAnon.status === 404, "بدون کوکی، مقایسه نسخه‌ها ⇒ ۴۰۴", `got ${diffAnon.status}`);

  /* ---- ۴-د. پارامترهای نامعتبر نباید ۲۰۰ یا ۵۰۰ بدهند ---- */
  console.log("\n▶ ۴-د. اعتبارسنجی سخت‌گیرانه پارامترهای تاریخچه");
  for (const [label, path] of [
    ["نسخه اعشاری", `/api/projects/${historyId}/versions/1.5`],
    ["نسخه با صفر ابتدایی", `/api/projects/${historyId}/versions/01`],
    ["نسخه سرریز عددی", `/api/projects/${historyId}/versions/999999999999999999999`],
    ["ضد مقایسه اعشاری", `/api/projects/${historyId}/versions/1/diff?against=1.5`],
    ["ضد مقایسه سرریز", `/api/projects/${historyId}/versions/1/diff?against=999999999999999999999`],
    ["limit صفر", `/api/projects/${historyId}/versions?limit=0`],
    ["limit غیرعددی", `/api/projects/${historyId}/versions?limit=abc`],
    ["limit بیش از سقف", `/api/projects/${historyId}/versions?limit=100000`],
  ] as const) {
    const response = await call(owner, path);
    ok(response.status === 400, `${label} ⇒ ۴۰۰ (نه ۲۰۰/۵۰۰)`, `got ${response.status}`);
  }
  const limitedList = JSON.parse((await call(owner, `/api/projects/${historyId}/versions?limit=2`)).body || "{}") as {
    versions?: unknown[];
  };
  ok((limitedList.versions?.length ?? 0) <= 2, "limit=۲ حداکثر دو نسخه برمی‌گرداند", String(limitedList.versions?.length));

  // Pruning: keep the newest HISTORY_LIMIT revisions and never lose the current one.
  const bulk = JSON.parse(JSON.stringify(historyProject));
  for (let step = 0; step < 22; step += 1) {
    bulk.meta.name = `پروژه تاریخچه — گام ${step}`;
    const response = await call(owner, `/api/projects/${historyId}`, {
      method: "PATCH",
      body: JSON.stringify({ project: bulk }),
      // A dedicated client identity: the write quota is per IP, and the rest of
      // the suite must not be starved by this loop.
      ip: `${CLIENT_IP}.31`,
    });
    if (response.status !== 200) {
      ok(false, `ذخیره پیاپی گام ${step} ناموفق بود`, response.body.slice(0, 120));
      break;
    }
  }
  const pruned = JSON.parse((await call(owner, `/api/projects/${historyId}/versions?limit=100`)).body || "{}") as {
    versions?: { version: number; isCurrent: boolean }[];
    limits?: { count: number };
  };
  const limit = pruned.limits?.count ?? 20;
  ok((pruned.versions?.length ?? 0) <= limit, `تعداد نسخه‌های نگه‌داری‌شده ≤ ${limit}`, String(pruned.versions?.length));
  ok(
    Boolean(pruned.versions?.some((item) => item.isCurrent)),
    "نسخه جاری هرگز هرس نمی‌شود",
  );
  const newestFirst = (pruned.versions ?? []).every((item, index, all) => index === 0 || all[index - 1].version > item.version);
  ok(newestFirst, "فهرست از جدید به قدیم مرتب است");

  // Two writers, one revision: the loser must be told, not overwritten.
  const raceProject = JSON.parse(projectJson);
  raceProject.meta.name = "پروژه مسابقه";
  raceProject.activities = raceProject.activities.slice(0, 3);
  const raceCreated = await call(owner, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ project: raceProject, reportOptions: {} }),
  });
  const raceId = (JSON.parse(raceCreated.body || "{}") as { id?: string }).id ?? "";
  const left = JSON.parse(JSON.stringify(raceProject));
  left.meta.name = "نسخه نویسنده راست";
  const right = JSON.parse(JSON.stringify(raceProject));
  right.meta.name = "نسخه نویسنده چپ";
  const [raceA, raceB] = await Promise.all([
    call(owner, `/api/projects/${raceId}`, {
      method: "PATCH",
      body: JSON.stringify({ project: left, expectedVersion: 1 }),
      ip: `${CLIENT_IP}.41`,
    }),
    call(owner, `/api/projects/${raceId}`, {
      method: "PATCH",
      body: JSON.stringify({ project: right, expectedVersion: 1 }),
      ip: `${CLIENT_IP}.42`,
    }),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  ok(
    raceStatuses[0] === 200 && raceStatuses[1] === 409,
    "دو ویرایش هم‌زمان روی یک نسخه: یکی موفق، دیگری ۴۰۹",
    raceStatuses.join("/"),
  );
  const raceWinner = raceA.status === 200 ? "نسخه نویسنده راست" : "نسخه نویسنده چپ";
  const raceFinal = await call(owner, `/api/projects/${raceId}`);
  ok(
    (JSON.parse(raceFinal.body || "{}") as { project?: { meta?: { name?: string } } }).project?.meta?.name === raceWinner,
    "داده نهایی همان نوشته برنده است (بدون بازنویسی مختلط)",
  );
  const raceVersions = JSON.parse((await call(owner, `/api/projects/${raceId}/versions`)).body || "{}") as {
    versions?: { version: number }[];
  };
  ok(raceVersions.versions?.length === 2, "مسابقه فقط یک نسخه تازه ساخت", String(raceVersions.versions?.length));

  // A project whose creation snapshot is missing (created before this feature
  // shipped, or an insert that failed) must still be undoable: the first edit
  // back-fills the *stored* state as revision 1 before writing the new one.
  const legacyProject = JSON.parse(projectJson);
  legacyProject.meta.name = "پروژه بدون تاریخچه";
  legacyProject.activities = legacyProject.activities.slice(0, 3);
  const legacyCreated = await call(owner, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ project: legacyProject, reportOptions: {} }),
  });
  const legacyId = (JSON.parse(legacyCreated.body || "{}") as { id?: string }).id ?? "";
  await dbRun("delete from project_versions where project_id = $1", [legacyId]);
  legacyProject.meta.name = "پروژه بدون تاریخچه — ویرایش";
  legacyProject.activities = legacyProject.activities.slice(0, 1);
  const legacyEdit = await call(owner, `/api/projects/${legacyId}`, {
    method: "PATCH",
    body: JSON.stringify({ project: legacyProject }),
    ip: `${CLIENT_IP}.51`,
  });
  ok(legacyEdit.status === 200, "ویرایش پروژه بی‌تاریخچه موفق است", legacyEdit.body.slice(0, 120));
  const backfilled = JSON.parse((await call(owner, `/api/projects/${legacyId}/versions`)).body || "{}") as {
    versions?: { version: number; reason: string }[];
  };
  ok(backfilled.versions?.length === 2, "ویرایش، نسخه قدیمی را هم بازسازی می‌کند", String(backfilled.versions?.length));
  ok(backfilled.versions?.[1]?.reason === "create", "نسخه بازسازی‌شده با علت «ایجاد» ثبت شد", backfilled.versions?.[1]?.reason);
  const legacyOld = JSON.parse((await call(owner, `/api/projects/${legacyId}/versions/1`)).body || "{}") as {
    project?: { meta?: { name?: string } };
  };
  ok(
    legacyOld.project?.meta?.name === "پروژه بدون تاریخچه",
    "نسخه ۱ محتوای پیش از ویرایش را دارد (قابل واگردانی)",
    legacyOld.project?.meta?.name,
  );

  /* ---- ۴-ه. فهرست پروژه‌ها: صفحه‌بندی، شمارش و خطای صریح ---- */
  console.log("\n▶ ۴-ه. فهرست پروژه‌ها، صفحه‌بندی و شمارش");
  {
    const listJar = new Jar();
    const listIp = `${CLIENT_IP}.81`;
    for (const index of [1, 2, 3]) {
      const project = JSON.parse(projectJson);
      project.meta.name = `پروژه فهرست ${index}`;
      const created = await call(listJar, "/api/projects", {
        method: "POST",
        body: JSON.stringify({ project, reportOptions: {} }),
        ip: listIp,
      });
      ok(created.status === 201, `پروژه ${index} برای آزمون فهرست ساخته شد`, `status ${created.status}`);
    }

    const firstPage = await call(listJar, "/api/projects?limit=2", { ip: listIp });
    const firstBody = JSON.parse(firstPage.body || "{}") as {
      projects?: { id: string; name: string }[];
      total?: number;
      hasMore?: boolean;
      nextOffset?: number | null;
    };
    ok(firstPage.status === 200, "فهرست با ۲۰۰ برگشت", firstPage.body.slice(0, 120));
    ok(firstBody.projects?.length === 2, "limit=۲ دقیقاً دو پروژه می‌دهد", String(firstBody.projects?.length));
    ok(firstBody.total === 3, "total تعداد کل پروژه‌ها را می‌گوید", String(firstBody.total));
    ok(firstBody.hasMore === true && firstBody.nextOffset === 2, "hasMore و nextOffset درست است", JSON.stringify([firstBody.hasMore, firstBody.nextOffset]));

    const secondPage = await call(listJar, "/api/projects?limit=2&offset=2", { ip: listIp });
    const secondBody = JSON.parse(secondPage.body || "{}") as { projects?: unknown[]; hasMore?: boolean; nextOffset?: number | null };
    ok(secondBody.projects?.length === 1, "صفحه دوم یک پروژه دارد", String(secondBody.projects?.length));
    ok(secondBody.hasMore === false && secondBody.nextOffset === null, "در صفحه آخر hasMore=false است");

    // A guest must only ever see its own projects, however they page through it.
    const all = await call(listJar, "/api/projects?limit=50", { ip: listIp });
    ok(
      !(JSON.parse(all.body || "{}") as { projects?: { id: string }[] }).projects?.some((item) => item.id === id),
      "فهرست پروژه‌های غریبه، پروژه دیگران را نشان نمی‌دهد",
    );

    for (const [label, path] of [
      ["limit صفر", "/api/projects?limit=0"],
      ["limit بیش از سقف", "/api/projects?limit=1000"],
      ["offset غیرعددی", "/api/projects?offset=abc"],
      ["offset منفی", "/api/projects?offset=-1"],
    ] as const) {
      const response = await call(listJar, path, { ip: listIp });
      ok(response.status === 400, `${label} ⇒ ۴۰۰`, `got ${response.status}`);
    }
  }

  /* ---- ۴-و. فهرست پروژه‌ها هم مثل بقیه خواندن‌ها سقف نرخ دارد ---- */
  console.log("\n▶ ۴-و. محدودیت نرخ فهرست پروژه‌ها");
  {
    const burstJar = new Jar();
    const burstIp = `${CLIENT_IP}.82`;
    let limitedAt = 0;
    let retryAfter = "";
    for (let i = 1; i <= 130; i += 1) {
      const response = await call(burstJar, "/api/projects?limit=1", { ip: burstIp });
      if (response.status === 429) {
        limitedAt = i;
        retryAfter = String(response.response.headers.get("retry-after") ?? "");
        break;
      }
    }
    ok(limitedAt > 0, "درخواست‌های پشت‌سرهم فهرست، در نهایت ۴۲۹ می‌گیرند", "هرگز محدود نشد");
    // The quota is configurable, so compare against the configured value rather
    // than hard-coding 120 — a mismatch would otherwise be a silent pass.
    const expectedQuota = Number(process.env.RATE_LIMIT_PROJECT_READ ?? 120);
    ok(
      limitedAt === expectedQuota + 1,
      `اولین ۴۲۹ دقیقاً بعد از سهمیه (${expectedQuota}) رخ می‌دهد`,
      `محدودسازی در درخواست ${limitedAt}`,
    );
    ok(retryAfter.length > 0, "پاسخ ۴۲۹ هدر Retry-After دارد", `retry-after="${retryAfter}"`);
  }

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

  if (request.status === 503) {
    // Production configuration: no SMS provider and demo OTP not explicitly
    // enabled. Login must be refused, no code may be leaked, and nothing may
    // be written to the database.
    skipped += 6;
    ok(request.status === 503, "بدون سرویس پیامک و بدون فعال‌سازی صریح دمو ⇒ ۵۰۳", `got ${request.status}`);
    ok(!requestBody.code, "هیچ کدی در پاسخ فاش نمی‌شود");
    const rows = await dbQuery("select count(*) from otp_codes where phone = $1", [phone]);
    ok(rows === "0", "هیچ ردیف OTP نوشته نمی‌شود", rows);
    console.log("  ⚠ مسیر ورود (۶ بررسی) در این پیکربندی نادیده گرفته شد — حالت دمو فعال نیست");
    console.log("    (برای آزمودن ورود: HERMIPLAN_ALLOW_DEMO_OTP=1 را تنظیم کنید)");
  } else {
    ok(
      request.status === 200 && requestBody.demoMode === true && typeof requestBody.code === "string",
      "کد نمایشی صادر شد (حالت دمو با فعال‌سازی صریح)",
      `${request.status} ${request.body.slice(0, 120)}`,
    );

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
    const ownerInDb = await dbQuery("select coalesce(owner_user::text, 'NULL') from projects where id = $1", [guestId]);
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
  const zipBytes = Buffer.from(await pkg.arrayBuffer());
  const entries = readZip(zipBytes);
  ok(entries.length === 6, "بسته شامل ۶ فایل است", entries.map((entry) => entry.name).join(","));
  ok(entries.every((entry) => entry.crcOk), "یکپارچگی ZIP (CRC) تأیید شد");
  ok(
    entries.some((entry) => entry.name.endsWith(".xlsx")) &&
      entries.some((entry) => entry.name.endsWith(".html")) &&
      entries.some((entry) => entry.name.endsWith(".json")),
    "بسته شامل XLSX، HTML و JSON است",
    entries.map((entry) => entry.name).join(","),
  );

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

  // The documented quota is 10 link creations per hour per client, shared across
  // every project that client owns. Prove the boundary exactly — 10 succeed, the
  // 11th is refused with a retry hint — and that it is not the per-project cap.
  const quotaIp = `${CLIENT_IP}.77`;
  const quotaProjectA = JSON.parse(projectJson);
  quotaProjectA.meta.name = "سهمیه الف";
  const quotaProjectB = JSON.parse(projectJson);
  quotaProjectB.meta.name = "سهمیه ب";
  const quotaA = (
    JSON.parse(
      (
        await call(owner, "/api/projects", {
          method: "POST",
          body: JSON.stringify({ project: quotaProjectA, reportOptions: {} }),
          ip: `${quotaIp}.1`,
        })
      ).body || "{}",
    ) as { id?: string }
  ).id;
  const quotaB = (
    JSON.parse(
      (
        await call(owner, "/api/projects", {
          method: "POST",
          body: JSON.stringify({ project: quotaProjectB, reportOptions: {} }),
          ip: `${quotaIp}.2`,
        })
      ).body || "{}",
    ) as { id?: string }
  ).id;
  const quotaStatuses: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    quotaStatuses.push(
      (await call(owner, `/api/projects/${quotaA}/share`, { method: "POST", body: "{}", ip: quotaIp })).status,
      (await call(owner, `/api/projects/${quotaB}/share`, { method: "POST", body: "{}", ip: quotaIp })).status,
    );
  }
  ok(
    quotaStatuses.length === 10 && quotaStatuses.every((status) => status === 201),
    "۱۰ ساخت لینک در ساعت برای هر کلاینت مجاز است (دو پروژه، پنج‌تا هرکدام)",
    quotaStatuses.join(","),
  );
  const quotaExceeded = await call(owner, `/api/projects/${quotaA}/share`, {
    method: "POST",
    body: "{}",
    ip: quotaIp,
  });
  const quotaHeaders = quotaExceeded.response.headers;
  ok(quotaExceeded.status === 429, "ساخت لینک یازدهم ⇒ ۴۲۹", `got ${quotaExceeded.status}`);
  ok(
    Number(quotaHeaders.get("retry-after") ?? 0) > 0,
    "پاسخ ۴۲۹ سرآیند Retry-After دارد",
    String(quotaHeaders.get("retry-after")),
  );

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
  await closeDb();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("خطای اجرای آزمون:", error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
