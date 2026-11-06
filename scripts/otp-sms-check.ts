/**
 * HERMIPLAN — OTP delivery over a *real* HTTP provider path, end to end.
 *
 *   DATABASE_URL=… npx tsx scripts/otp-sms-check.ts
 *   DATABASE_URL=… BASE_URL=http://127.0.0.1:3400 npx tsx scripts/otp-sms-check.ts
 *
 * Why this exists
 * ---------------
 * The API suite signs in through **demo mode**, which returns the code in the
 * response. That proves the session/claim logic but it never exercises the part
 * an operator actually depends on: `sendOtpSms()` → provider → "code was
 * delivered" → user types it back. An unreachable provider, a wrong body shape
 * or a swallowed error would all pass the demo suite.
 *
 * This suite runs the real adapter against a local stub that speaks the
 * configured HTTP provider contract. Nothing is simulated above the socket: the
 * application process is `next start`, and it dials the stub over TCP exactly as
 * it would dial Kavenegar.
 *
 * What is asserted
 *   1. configuration: every half-configured combination is refused with a reason
 *      (never silently "sent"), and demo mode is impossible in production;
 *   2. the adapter sends `POST` + `Authorization: Bearer …` + the phone/code
 *      body, and reports a provider error as a failure (no false success);
 *   3. the API returns **200 only after** the stub accepted the message, and 502
 *      when the stub refuses;
 *   4. only a SHA-256 hash of the code is stored — the plaintext that travelled
 *      over the wire cannot be found in the database;
 *   5. the code works exactly once, the wrong code is rejected, and a resend is
 *      throttled;
 *   6. no secret (API key, code) is written to the process logs, only a masked
 *      phone number.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { readSmsConfig, demoOtpAllowed, sendOtpSms } from "../src/lib/server/sms";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const BASE = process.env.BASE_URL ?? "";
const SERVER_PORT = Number(process.env.OTP_TEST_PORT ?? 3417);
const STUB_PORT = Number(process.env.OTP_STUB_PORT ?? 4599);
const SMS_KEY = "test-provider-key-not-a-real-secret";

let passed = 0;
const failures: string[] = [];
function ok(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

interface CapturedMessage {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: { phone?: string; code?: string; sender?: string } | null;
  raw: string;
}

/** A provider stub: records what the application sent and answers on command. */
function startStub(port = STUB_PORT): { server: Server; messages: CapturedMessage[]; reply: { status: number } } {
  const messages: CapturedMessage[] = [];
  const reply = { status: 200 };
  const server = createServer((request: IncomingMessage, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      let body: CapturedMessage["body"] = null;
      try {
        body = JSON.parse(raw) as NonNullable<CapturedMessage["body"]>;
      } catch {
        body = null;
      }
      messages.push({
        method: request.method ?? "",
        path: request.url ?? "",
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body,
        raw,
      });
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: reply.status === 200 }));
    });
  });
  server.listen(port, "127.0.0.1");
  return { server, messages, reply };
}

async function waitForServer(url: string, timeoutMs = 90_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 503) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

class Jar {
  private cookies = new Map<string, string>();
  headers(): Record<string, string> {
    return this.cookies.size === 0
      ? {}
      : { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") };
  }
  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
    }
  }
}

async function call(
  jar: Jar,
  path: string,
  init: { method?: string; body?: unknown; ip?: string } = {},
): Promise<{ status: number; body: string; retryAfter: string | null }> {
  const headers: Record<string, string> = { ...jar.headers() };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.ip) headers["x-forwarded-for"] = init.ip;
  const target = process.env.OTP_BASE_INTERNAL ?? BASE;
  const response = await fetch(`${target}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
  });
  jar.absorb(response);
  return { status: response.status, body: await response.text(), retryAfter: response.headers.get("retry-after") };
}

/* ---------------------------------------------------------------- part A --- */

const apiStub = startStub(STUB_PORT + 1);
const holder: { server: ChildProcess | null } = { server: null };

async function run(): Promise<void> {

console.log("▶ ۱. پیکربندی: هیچ ترکیب ناقصی «ارسال‌شده» گزارش نمی‌شود");

const emptyEnv = {} as NodeJS.ProcessEnv;
const missingKey = readSmsConfig(emptyEnv);
ok(!missingKey.configured && /SMS_PROVIDER_KEY/.test(missingKey.reason), "بدون کلید ⇒ پیکربندی نشده");

const httpNoUrl = readSmsConfig({ SMS_PROVIDER_KEY: "k", SMS_PROVIDER: "http" } as unknown as NodeJS.ProcessEnv);
ok(!httpNoUrl.configured && /SMS_PROVIDER_URL/.test(httpNoUrl.reason), "provider=http بدون URL ⇒ پیکربندی نشده");

const unknownProvider = readSmsConfig({ SMS_PROVIDER_KEY: "k", SMS_PROVIDER: "carrier-pigeon" } as unknown as NodeJS.ProcessEnv);
ok(!unknownProvider.configured, "ارائه‌دهنده ناشناس ⇒ پیکربندی نشده");

const kaveNoTemplate = readSmsConfig({ SMS_PROVIDER_KEY: "k", SMS_PROVIDER: "kavenegar" } as unknown as NodeJS.ProcessEnv);
ok(!kaveNoTemplate.configured && /SMS_OTP_TEMPLATE/.test(kaveNoTemplate.reason), "کاوه‌نگار بدون قالب ⇒ پیکربندی نشده");

const goodHttp = readSmsConfig({
  SMS_PROVIDER_KEY: SMS_KEY,
  SMS_PROVIDER: "http",
  SMS_PROVIDER_URL: `http://127.0.0.1:${STUB_PORT}/send`,
  SMS_PROVIDER_SENDER: "10004346",
} as unknown as NodeJS.ProcessEnv);
ok(goodHttp.configured && goodHttp.provider === "http", "ترکیب کامل ⇒ پیکربندی‌شده");

ok(
  demoOtpAllowed({ NODE_ENV: "production", HERMIPLAN_ALLOW_DEMO_OTP: "1" } as unknown as NodeJS.ProcessEnv) === false,
  "حالت نمایشی در production حتی با فلگ هم ممکن نیست",
);
ok(
  demoOtpAllowed({ NODE_ENV: "development", HERMIPLAN_ALLOW_DEMO_OTP: "0" } as unknown as NodeJS.ProcessEnv) === false,
  "بدون فلگ صریح، حالت نمایشی در dev هم خاموش است",
);

console.log("\n▶ ۲. آداپتور: قرارداد HTTP با ارائه‌دهنده");

const stub = startStub();
const goodEnv = {
  SMS_PROVIDER_KEY: SMS_KEY,
  SMS_PROVIDER: "http",
  SMS_PROVIDER_URL: `http://127.0.0.1:${STUB_PORT}/send`,
  SMS_PROVIDER_SENDER: "10004346",
} as unknown as NodeJS.ProcessEnv;

const delivered = await sendOtpSms("09120000001", "12345", { env: goodEnv });
ok(delivered.ok, "ارسال موفق گزارش می‌شود", delivered.reason ?? "");
const sent = stub.messages.at(-1);
ok(sent?.method === "POST", "متد POST است", sent?.method);
ok(sent?.path === "/send", "مسیر پیکربندی‌شده فراخوانی می‌شود", sent?.path);
ok(sent?.authorization === `Bearer ${SMS_KEY}`, "کلید در هدر Authorization (نه در URL) فرستاده می‌شود");
ok(sent?.body?.phone === "09120000001" && sent?.body?.code === "12345", "شماره و کد در بدنه هستند");
ok(sent?.body?.sender === "10004346", "شماره فرستنده منتقل می‌شود");

const errorLogs: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => void errorLogs.push(args.map(String).join(" "));
const failedDelivery = await sendOtpSms("09120000002", "99999", {
  env: { ...goodEnv, SMS_PROVIDER_URL: `http://127.0.0.1:${STUB_PORT + 9}/send` } as NodeJS.ProcessEnv,
});
stub.reply.status = 500;
const rejected = await sendOtpSms("09120000003", "11111", { env: goodEnv });
stub.reply.status = 200;
const timedOut = await sendOtpSms("09120000004", "22222", {
  env: goodEnv,
  fetchImpl: (() => {
    const error = new Error("aborted");
    error.name = "AbortError";
    return Promise.reject(error);
  }) as typeof fetch,
});
const unconfigured = await sendOtpSms("09120000005", "33333", { env: {} as unknown as NodeJS.ProcessEnv });
console.error = originalError;

ok(!rejected.ok && /HTTP 500/.test(rejected.reason ?? ""), "خطای ارائه‌دهنده شکست گزارش می‌شود", rejected.reason);
ok(!timedOut.ok && timedOut.reason === "timeout", "بی‌پاسخی ⇒ timeout", timedOut.reason);
ok(!unconfigured.ok, "پیکربندی ناقص ⇒ شکست، نه «ارسال شد»");
ok(!failedDelivery.ok, "آدرس اشتباه ⇒ شکست");
ok(
  errorLogs.every((line) => !line.includes(SMS_KEY) && !line.includes("11111")),
  "لاگ خطا نه کلید را افشا می‌کند نه کد را",
  errorLogs.slice(0, 2).join(" | "),
);
ok(errorLogs.some((line) => /0912\*\*\*\d\d/.test(line)), "شماره در لاگ پوشانده می‌شود", errorLogs[0] ?? "");

stub.server.close();

if (!DATABASE_URL) {
  console.log(
    "\nℹ بخش سرور اجرا نشد (DATABASE_URL تنظیم نشده) — بخش آداپتور بالا معتبر است.",
  );
  return;
}

await main();
}

/* ---------------------------------------------------------------- part B --- */
async function main(): Promise<void> {
  console.log("\n▶ ۳. زنجیره واقعی: next start → ارائه‌دهنده → تأیید کد");

  holder.server = spawn(
    "npx",
    ["next", "start", "-p", String(SERVER_PORT), "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL,
        SMS_PROVIDER: "http",
        SMS_PROVIDER_KEY: SMS_KEY,
        SMS_PROVIDER_URL: `http://127.0.0.1:${STUB_PORT + 1}/send`,
        SMS_PROVIDER_SENDER: "10004346",
        HERMIPLAN_ALLOW_DEMO_OTP: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  const logs: string[] = [];
  holder.server.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  holder.server.stderr?.on("data", (chunk) => logs.push(String(chunk)));

  const base = `http://127.0.0.1:${SERVER_PORT}`;
  const ready = await waitForServer(`${base}/api/health`);
  if (!ready) {
    console.error(logs.join("").slice(-2000));
    throw new Error("server did not start");
  }
  // Keep the module-level BASE used by `call()` in sync with the spawned port.
  process.env.OTP_BASE_INTERNAL = base;

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const phone = `0912${String(Date.now()).slice(-7)}`;
  const ip = `10.${(Date.now() % 200) + 1}.0.9`;

  const requestCode = await post("/api/auth", { action: "request", phone }, ip);
  ok(requestCode.status === 200, "درخواست کد ⇒ ۲۰۰", `got ${requestCode.status} ${requestCode.body.slice(0, 120)}`);
  ok(!requestCode.body.includes("code") || !/"code"\s*:/.test(requestCode.body), "کد در پاسخ API برنمی‌گردد (بدون حالت نمایشی)");

  const message = apiStub.messages.at(-1);
  const deliveredCode = message?.body?.code ?? "";
  ok(/^\d{5}$/.test(deliveredCode), "ارائه‌دهنده یک کد ۵ رقمی دریافت کرد", deliveredCode);
  ok(message?.body?.phone === phone, "همان شماره‌ای که درخواست شد پیامک شد", message?.body?.phone);

  const stored = await client.query<{ code_hash: string; attempts: number; consumed_at: Date | null }>(
    "select code_hash, attempts, consumed_at from otp_codes where phone = $1 order by created_at desc limit 1",
    [phone],
  );
  ok(stored.rowCount === 1, "ردیف کد در پایگاه ثبت شد");
  ok(stored.rows[0]?.code_hash === createHash("sha256").update(deliveredCode).digest("hex"), "فقط هش SHA-256 ذخیره شده است");
  ok(!JSON.stringify(stored.rows[0]).includes(deliveredCode), "کد خام در پایگاه داده نیست");
  ok(stored.rows[0]?.consumed_at === null, "کد تازه مصرف‌نشده است");

  const wrong = await post("/api/auth", { action: "verify", phone, code: "00000" }, ip);
  ok(wrong.status === 401, "کد اشتباه ⇒ ۴۰۱", `got ${wrong.status}`);
  const afterWrong = await client.query<{ attempts: number }>(
    "select attempts from otp_codes where phone = $1 order by created_at desc limit 1",
    [phone],
  );
  ok(Number(afterWrong.rows[0]?.attempts) === 1, "شمارنده تلاش افزایش یافت", String(afterWrong.rows[0]?.attempts));

  const session = new Jar();
  const verify = await post("/api/auth", { action: "verify", phone, code: deliveredCode }, ip, session);
  ok(verify.status === 200, "کد صحیح ⇒ ۲۰۰ و نشست", `got ${verify.status} ${verify.body.slice(0, 120)}`);
  const me = await call(session, "/api/auth", { ip });
  ok(/"user"\s*:\s*\{/.test(me.body), "نشست واقعاً برقرار است", me.body.slice(0, 120));

  const reuse = await post("/api/auth", { action: "verify", phone, code: deliveredCode }, ip);
  ok(reuse.status === 401, "همان کد بار دوم کار نمی‌کند", `got ${reuse.status}`);

  const resend = await post("/api/auth", { action: "request", phone }, ip);
  ok(resend.status === 429, "درخواست فوری کد جدید ⇒ ۴۲۹", `got ${resend.status}`);
  ok(Number(resend.retryAfter ?? 0) > 0, "پاسخ ۴۲۹ هدر Retry-After دارد", resend.retryAfter ?? "");

  // A provider outage must surface as 502, and must not create a code the user
  // can never receive.
  apiStub.reply.status = 503;
  const otherPhone = `0935${String(Date.now()).slice(-7)}`;
  const outage = await post("/api/auth", { action: "request", phone: otherPhone }, `${ip}.7`);
  ok(outage.status === 502, "قطع ارائه‌دهنده ⇒ ۵۰۲ (نه ۲۰۰)", `got ${outage.status}`);
  const orphan = await client.query<{ count: string }>("select count(*) from otp_codes where phone = $1", [otherPhone]);
  ok(Number(orphan.rows[0]?.count) === 0, "در قطع ارائه‌دهنده، کد بی‌مصرف در پایگاه نمی‌ماند", orphan.rows[0]?.count);
  apiStub.reply.status = 200;

  const logout = await call(session, "/api/auth", { method: "DELETE", ip });
  ok(logout.status === 200, "خروج ⇒ ۲۰۰", `got ${logout.status}`);
  const afterLogout = await call(session, "/api/auth", { ip });
  ok(/"user"\s*:\s*null/.test(afterLogout.body), "پس از خروج، نشست باطل است", afterLogout.body.slice(0, 80));

  ok(
    logs.every((line) => !line.includes(SMS_KEY) && !line.includes(deliveredCode)),
    "لاگ سرور نه کلید را افشا می‌کند نه کد را",
  );

  await client.end();
}

async function post(path: string, body: unknown, ip: string, jar?: Jar): Promise<{
  status: number;
  body: string;
  retryAfter: string | null;
}> {
  // `call` targets the module-level BASE, which is the externally addressed
  // server when BASE_URL was given; when this script spawns its own server it
  // talks to that port directly.
  const target = process.env.OTP_BASE_INTERNAL ?? BASE;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (jar) Object.assign(headers, jar.headers());
  const response = await fetch(`${target}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (jar) jar.absorb(response);
  return { status: response.status, body: await response.text(), retryAfter: response.headers.get("retry-after") };
}

function report(): void {
  console.log(
    failures.length === 0
      ? `\n✔ ${passed} بررسی OTP/SMS — همه موفق`
      : `\n✘ ${failures.length} ناموفق از ${passed + failures.length}`,
  );
}



run()
  .catch((error) => {
    failures.push(error instanceof Error ? error.message : String(error));
    console.error(`✘ ${failures[failures.length - 1]}`);
  })
  .finally(() => {
    apiStub.server.close();
    if (holder.server?.pid) {
      try {
        process.kill(-holder.server.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    report();
    process.exit(failures.length === 0 ? 0 : 1);
  });
