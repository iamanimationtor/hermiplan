/**
 * Unit checks for the security helpers that do not need a browser or a database.
 *
 * Run: npm run test:security
 */
import { parsePhone, normalizePhone, toAsciiDigits } from "../src/lib/server/phone";
import { demoOtpAllowed, readSmsConfig } from "../src/lib/server/sms";
import { generateOtp, hashOtp, MAX_OTP_ATTEMPTS, OTP_LENGTH } from "../src/lib/server/otp";
import { checkRateLimit, clientIp } from "../src/lib/server/rate-limit";
import { isSameOriginRequest, isUuid } from "../src/lib/server/http";

let failures = 0;
let checks = 0;
const check = (condition: boolean, message: string, detail?: string) => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
};
const eq = (actual: unknown, expected: unknown, message: string) =>
  check(actual === expected, message, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/* ================================================================== */
console.log("▶ ۱. نرمال‌سازی شماره موبایل");
{
  const canonical = "09123456789";
  const accepted = [
    "09123456789",
    "0912 345 6789",
    "0912-345-6789",
    "۰۹۱۲۳۴۵۶۷۸۹", // Persian digits
    "٠٩١٢٣٤٥٦٧٨٩", // Arabic-Indic digits
    "+989123456789",
    "+98 912 345 6789",
    "00989123456789",
    "0098-912-345-6789",
    "989123456789",
    "9123456789",
    " 09123456789 ",
    "(0912) 345-6789",
  ];
  for (const input of accepted) {
    eq(normalizePhone(input), canonical, `پذیرش قالب «${input}»`);
  }

  const rejected = [
    "",
    "۰۹۱۲۳", // too short
    "0912345678", // 10 digits
    "091234567890", // 12 digits
    "+1 202 555 0143", // foreign
    "0912abc6789",
    "++989123456789",
    "0091234567891",
  ];
  for (const input of rejected) {
    eq(normalizePhone(input), null, `رد قالب نامعتبر «${input}»`);
  }

  eq(toAsciiDigits("۱۲۳۴۵۶۷۸۹۰"), "1234567890", "تبدیل ارقام فارسی");
  eq(toAsciiDigits("١٢٣٤٥٦٧٨٩٠"), "1234567890", "تبدیل ارقام عربی");
  const parsed = parsePhone("+98 912 000 0000");
  check(parsed.ok, "parsePhone نتیجه ساختاری برمی‌گرداند");
}

/* ================================================================== */
console.log("▶ ۲. تولید و هش OTP");
{
  const codes = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const code = generateOtp();
    check(new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code), `کد ${OTP_LENGTH} رقمی است`, code);
    codes.add(code);
  }
  check(codes.size > 150, "کدها تصادفی‌اند (بدون تکرار انبوه)", `unique=${codes.size}/200`);
  eq(hashOtp("12345"), hashOtp("12345"), "هش OTP قطعی است");
  check(hashOtp("12345") !== hashOtp("12346"), "هش کدهای متفاوت، متفاوت است");
  check(!hashOtp("12345").includes("12345"), "کد خام در هش قابل مشاهده نیست");
  eq(MAX_OTP_ATTEMPTS, 5, "حداکثر تلاش مجاز = ۵");
}

/* ================================================================== */
console.log("▶ ۳. پیکربندی پیامک و حالت نمایشی");
{
  const noConfig = readSmsConfig({} as NodeJS.ProcessEnv);
  eq(noConfig.configured, false, "بدون SMS_PROVIDER_KEY: پیکربندی ناقص است");

  const kavenegar = readSmsConfig({
    SMS_PROVIDER_KEY: "k",
    SMS_PROVIDER: "kavenegar",
    SMS_OTP_TEMPLATE: "hermiplan",
  } as unknown as NodeJS.ProcessEnv);
  eq(kavenegar.configured, true, "کاوه‌نگار با کلید و قالب، پیکربندی‌شده است");

  const missingTemplate = readSmsConfig({
    SMS_PROVIDER_KEY: "k",
    SMS_PROVIDER: "kavenegar",
  } as unknown as NodeJS.ProcessEnv);
  eq(missingTemplate.configured, false, "قالب پیامک اجباری است (ارسال verify بدون قالب ممکن نیست)");

  eq(
    demoOtpAllowed({ NODE_ENV: "production", HERMIPLAN_ALLOW_DEMO_OTP: "1" } as unknown as NodeJS.ProcessEnv),
    false,
    "حالت نمایشی در محیط production هرگز فعال نمی‌شود",
  );
  eq(
    demoOtpAllowed({ NODE_ENV: "development", HERMIPLAN_ALLOW_DEMO_OTP: "1" } as unknown as NodeJS.ProcessEnv),
    true,
    "حالت نمایشی در توسعه با فعال‌سازی صریح مجاز است",
  );
  eq(
    demoOtpAllowed({ NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv),
    false,
    "حالت نمایشی بدون فعال‌سازی صریح غیرفعال است",
  );
}

/* ================================================================== */
console.log("▶ ۴. محافظت CSRF (هم‌مبدأ بودن درخواست)");
{
  const makeRequest = (headers: Record<string, string>) =>
    new Request("https://hermiplan.example/api/projects", { method: "POST", headers });

  check(isSameOriginRequest(makeRequest({ host: "hermiplan.example" })), "درخواست بدون Origin مجاز است");
  check(
    isSameOriginRequest(makeRequest({ host: "hermiplan.example", origin: "https://hermiplan.example" })),
    "Origin هم‌مبدأ مجاز است",
  );
  check(
    !isSameOriginRequest(makeRequest({ host: "hermiplan.example", origin: "https://evil.example" })),
    "Origin متفاوت رد می‌شود",
  );
  check(
    !isSameOriginRequest(makeRequest({ host: "hermiplan.example", "sec-fetch-site": "cross-site" })),
    "Sec-Fetch-Site=cross-site رد می‌شود",
  );
  check(
    isSameOriginRequest(makeRequest({ host: "hermiplan.example", "sec-fetch-site": "same-origin" })),
    "Sec-Fetch-Site=same-origin مجاز است",
  );
  check(!isSameOriginRequest(makeRequest({ host: "a.example", origin: "not-a-url" })), "Origin نامعتبر رد می‌شود");
}

/* ================================================================== */
console.log("▶ ۵. اعتبارسنجی شناسه و استخراج IP");
{
  check(isUuid("3f0c1a9e-6b1c-4a43-9f0e-0f0d3a1b2c3d"), "UUID معتبر پذیرفته می‌شود");
  check(!isUuid("../etc/passwd"), "ورودی غیر UUID رد می‌شود");
  check(!isUuid("3f0c1a9e6b1c4a439f0e0f0d3a1b2c3d"), "UUID بدون خط تیره رد می‌شود");

  const request = new Request("https://x.example/api", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  eq(clientIp(request), "203.0.113.9", "اولین IP زنجیره X-Forwarded-For استفاده می‌شود");
}

/* ================================================================== */
async function main() {
  console.log("▶ ۶. محدودکننده نرخ (حالت جایگزین حافظه‌ای)");
  {
    // No DATABASE_URL in the test environment ⇒ the documented in-memory fallback
    // is used. The result must still be a hard deny once the quota is exhausted.
    const key = `test:${Date.now()}`;
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await checkRateLimit(key, rule));
    check(results[0].allowed && results[1].allowed && results[2].allowed, "سه درخواست اول مجاز است");
    check(!results[3].allowed, "درخواست چهارم رد می‌شود");
    check(results[3].retryAfterSeconds > 0, "زمان تلاش مجدد گزارش می‌شود");
    check(results[3].degraded === true, "نبود دیتابیس به‌صورت degraded اعلام می‌شود");
  }

}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✔ ${checks} بررسی امنیتی — همه موفق`
        : `\n✘ ${failures} خطا از ${checks} بررسی امنیتی`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
