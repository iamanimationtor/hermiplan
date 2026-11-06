/**
 * حالت دسترسی — آزمون قواعد، بدون سرور.
 *
 *   npx tsx scripts/access-mode-check.ts
 *
 * مهم‌ترین خصلتی که اینجا قفل می‌شود: حالت `open` حق ندارد هیچ سد امنیتی را
 * بردارد. اگر روزی کسی `auth` یا `otpVerify` را به فهرست سهمیه‌های محصول اضافه
 * کند، این آزمون شکست می‌خورد — نه اینکه بی‌صدا در تولید باز شود.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_MODES,
  LOCKED_SHARE_LINK_CAP,
  OPEN_SHARE_LINK_CEILING,
  PRODUCT_QUOTA_KEYS,
  accessProfile,
  normalizeAccessMode,
} from "../src/lib/access-mode";

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("▶ ۱. فایل سوئیچ");
const raw = readFileSync(join(process.cwd(), "config", "access.json"), "utf8");
let config: { mode?: unknown } = {};
let parsed = true;
try {
  config = JSON.parse(raw) as { mode?: unknown };
} catch {
  parsed = false;
}
check(parsed, "config/access.json یک JSON معتبر است");
check(
  parsed && ACCESS_MODES.includes(config.mode as never),
  "مقدار mode یکی از حالت‌های شناخته‌شده است",
  String(config.mode),
);

console.log("\n▶ ۲. حالت locked (تحویل واقعی)");
const locked = accessProfile("locked");
check(locked.mode === "locked", "پروفایل locked");
check(locked.shareLinkCap === LOCKED_SHARE_LINK_CAP, "سقف لینک اشتراک ۱۰ است", String(locked.shareLinkCap));
check(locked.history.count === 20 && locked.history.bytes === 8 * 1024 * 1024, "تاریخچه ۲۰ نسخه / ۸MB");
for (const key of [...PRODUCT_QUOTA_KEYS, "auth", "otpRequest", "otpVerify"]) {
  check(locked.enforcesQuota(key), `locked: سهمیهٔ «${key}» اعمال می‌شود`);
}

console.log("\n▶ ۳. حالت open (پیش از انتشار)");
const open = accessProfile("open");
check(open.mode === "open", "پروفایل open");
check(open.shareLinkCap === OPEN_SHARE_LINK_CEILING, "سقف محصول برداشته شده (فقط سقف فنی بالاست)");
check(open.history.count > locked.history.count, "تاریخچهٔ بلندتر می‌شود", `${open.history.count} در برابر ${locked.history.count}`);
for (const key of PRODUCT_QUOTA_KEYS) {
  check(!open.enforcesQuota(key), `open: سهمیهٔ محصول «${key}» برداشته می‌شود`);
}

console.log("\n▶ ۴. سدهای امنیتی در حالت open دست‌نخورده");
for (const key of ["auth", "otpRequest", "otpVerify"]) {
  check(open.enforcesQuota(key), `open: سهمیهٔ امنیتی «${key}» همچنان اعمال می‌شود`);
}
check(
  !(PRODUCT_QUOTA_KEYS as readonly string[]).includes("otpVerify"),
  "otpVerify هرگز در فهرست سهمیه‌های محصول نیست",
);
check(
  !(PRODUCT_QUOTA_KEYS as readonly string[]).includes("auth"),
  "auth هرگز در فهرست سهمیه‌های محصول نیست",
);

console.log("\n▶ ۵. هر کلید واقعی سهمیه با فهرست محصول/امنیت هم‌خوان است");
{
  /*
   * این بخش یک باگ واقعی را قفل می‌کند: معافیت در `checkRateLimit` بر اساس
   * پیشوند کلید است (`export:ip:…` ⇒ `export`). اگر مسیری کلیدی با نام دیگر
   * بسازد (مثلاً `share:ip:` برای سهمیهٔ `shareRead`)، حالت `open` آن سهمیه را
   * بی‌آنکه کسی متوجه شود نگه می‌دارد. پس پیشوندها از خودِ کد مسیرها خوانده و با
   * دو فهرست مقایسه می‌شوند: محصول (برداشته می‌شود) و امنیت/بیرونی (می‌ماند).
   */
  const security = ["auth", "otp"];
  const alwaysLimited = ["market"];
  const scopes = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/clientKey\(\s*request\s*,\s*"([A-Za-z0-9_]+)"/g)) {
          scopes.set(match[1], [...(scopes.get(match[1]) ?? []), full]);
        }
        for (const match of source.matchAll(/checkRateLimit\(\s*`([A-Za-z0-9_]+):/g)) {
          scopes.set(match[1], [...(scopes.get(match[1]) ?? []), full]);
        }
      }
    }
  };
  walk(join(process.cwd(), "src", "app"));

  const known = new Set<string>([...PRODUCT_QUOTA_KEYS, ...security, ...alwaysLimited]);
  const unknown = [...scopes.keys()].filter((scope) => !known.has(scope));
  check(
    scopes.size >= 8,
    "کلیدهای سهمیه از کد مسیرها خوانده شدند",
    `${scopes.size} پیشوند: ${[...scopes.keys()].sort().join(", ")}`,
  );
  check(
    unknown.length === 0,
    "هیچ کلید سهمیه‌ای بیرون از فهرست محصول/امنیت نیست (وگرنه در open بی‌صدا می‌ماند)",
    unknown.map((scope) => `${scope} در ${scopes.get(scope)?.join(", ")}`).join(" · "),
  );
  for (const scope of security) {
    check(
      scopes.has(scope) && !(PRODUCT_QUOTA_KEYS as readonly string[]).includes(scope),
      `سد امنیتی «${scope}» واقعاً استفاده شده و در فهرست محصول نیست`,
    );
  }
  check(
    ![...alwaysLimited].some((scope) => (PRODUCT_QUOTA_KEYS as readonly string[]).includes(scope)),
    "سهمیه‌های بیرونی (market) در فهرست محصول نیستند",
  );
  /*
   * A key built from a *call* (`${clientIpFromHeaders()}`) silently becomes
   * "[object Promise]" when the call is async and the await is forgotten. One
   * forgotten await then turns every request into the same bucket — a global
   * limiter that locks the first user out of sign-in. The rule below is cheap
   * and catches the whole class: only plain identifiers may be interpolated.
   */
  const callInKey: string[] = [];
  const walkKeys = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkKeys(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/checkRateLimit\(\s*`([^`]*)`/g)) {
          const key = match[1];
          if (/\$\{[^}]*\(/.test(key)) callInKey.push(`${full}: ${key}`);
        }
      }
    }
  };
  walkKeys(join(process.cwd(), "src", "app"));
  check(
    callInKey.length === 0,
    "کلید سهمیه هیچ فراخوانی‌ای را درون خود جای نمی‌دهد (await فراموش‌شده ⇒ باکت مشترک)",
    callInKey.join(" · "),
  );
}

console.log("\n▶ ۶. مقدار نامعتبر نباید بی‌صدا «باز» شود");
check(normalizeAccessMode("open") === "open", "«open» پذیرفته می‌شود");
check(normalizeAccessMode("locked") === "locked", "«locked» پذیرفته می‌شود");
for (const bogus of ["OPEN", "true", "", undefined, null, 1, {}, "unlimited"]) {
  check(normalizeAccessMode(bogus) === "locked", `مقدار نامعتبر ${JSON.stringify(bogus)} ⇒ locked`);
}

console.log(
  failures.length === 0
    ? `\n✔ ${passed} بررسی حالت دسترسی — همه موفق`
    : `\n✘ ${passed} موفق / ${failures.length} ناموفق`,
);
if (failures.length) {
  for (const failure of failures) console.log(`   - ${failure}`);
  process.exit(1);
}
