/**
 * سوئیچ حالت دسترسی — همان «یک فایل» که برای تحویل واقعی تغییر می‌کند.
 *
 *   npm run access:status      # وضعیت فعلی و فهرست چیزهایی که برداشته/مانده‌اند
 *   npm run access:open        # نسخهٔ پیش از انتشار: بدون سهمیهٔ محصول
 *   npm run access:locked      # تحویل واقعی: محدودیت‌های محافظه‌کارانه
 *
 * فقط `config/access.json` نوشته می‌شود؛ هیچ کد و هیچ مهاجرتی تغییر نمی‌کند.
 * چون Next فایل را در build می‌بندد، پس از تغییر باید دوباره build شود
 * (یا `HERMIPLAN_ACCESS_MODE` روی میزبان تنظیم شود، که بدون build اثر دارد).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_MODES, accessProfile, normalizeAccessMode, PRODUCT_QUOTA_KEYS } from "../src/lib/access-mode";

const CONFIG = join(process.cwd(), "config", "access.json");
const SECURITY_QUOTAS = ["auth (ورود)", "otpRequest (درخواست کد)", "otpVerify (بررسی کد)"] as const;

interface ConfigFile {
  mode?: unknown;
  updatedAt?: string;
  note?: string;
}

function readConfig(): ConfigFile {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8")) as ConfigFile;
  } catch (error) {
    console.error(`✗ config/access.json خوانده نشد: ${(error as Error).message}`);
    process.exit(1);
  }
}

function report(): void {
  const config = readConfig();
  const env = process.env.HERMIPLAN_ACCESS_MODE?.trim();
  const mode = normalizeAccessMode(env || config.mode);
  const source = env ? "HERMIPLAN_ACCESS_MODE" : "config/access.json";
  const profile = accessProfile(mode);

  console.log(`حالت فعال: ${mode}  (منبع: ${source})`);
  console.log(`سقف لینک فعال هر پروژه: ${profile.shareLinkCap.toLocaleString("fa-IR")}`);
  console.log(
    `تاریخچهٔ هر پروژه: ${profile.history.count} نسخه / ${Math.round(profile.history.bytes / (1024 * 1024))} مگابایت`,
  );
  if (mode === "open") {
    console.log(`\nسهمیه‌های محصول برداشته شده‌اند: ${PRODUCT_QUOTA_KEYS.join(", ")}`);
    console.log(`سهمیه‌های امنیتی همچنان فعال‌اند: ${SECURITY_QUOTAS.join(" · ")}`);
    console.log("یادآوری: این حالت هیچ سهمیه‌ای برای ساخت پروژه، خروجی و لینک اشتراک اعمال نمی‌کند.");
  } else {
    console.log("\nهمهٔ سهمیه‌های مستندشده (README → محدودیت نرخ) فعال هستند.");
  }
  if (config.updatedAt) console.log(`\nآخرین تغییر فایل: ${config.updatedAt}`);
  if (config.note) console.log(`یادداشت: ${config.note}`);
}

function setMode(raw: string): void {
  const mode = raw === "open" || raw === "locked" ? raw : null;
  if (!mode) {
    console.error(`✗ حالت «${raw}» شناخته نشد. مقادیر مجاز: ${ACCESS_MODES.join(", ")}`);
    process.exit(2);
  }
  const config = readConfig();
  const next: ConfigFile = {
    mode,
    updatedAt: new Date().toISOString().slice(0, 10),
    note:
      mode === "open"
        ? "پیش از انتشار عمومی: همهٔ امکانات برای همه، بدون سهمیهٔ محصول و بدون سقف لینک اشتراک. برای تحویل واقعی: npm run access:locked و پس از آن build."
        : "تحویل واقعی: محدودیت‌های مستندشده فعال است (سهمیهٔ هر endpoint و سقف ۱۰ لینک اشتراک).",
  };
  writeFileSync(CONFIG, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`✓ config/access.json روی «${mode}» تنظیم شد.`);
  console.log("  برای اعمال در build فعلی: npm run build (یا HERMIPLAN_ACCESS_MODE=" + mode + " روی میزبان).");
}

const command = process.argv[2] ?? "status";
if (command === "status") report();
else if (command === "open" || command === "locked") setMode(command);
else {
  console.error(`✗ دستور «${command}» شناخته نشد. استفاده: status | open | locked`);
  process.exit(2);
}
