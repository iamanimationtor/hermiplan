/**
 * خواندن حالت دسترسی از `config/access.json` (و بازنویسی با محیط اجرا).
 *
 * چرا import و نه `readFileSync`: فایل باید در بستهٔ سرور باشد. اگر با fs
 * خوانده شود، روی میزبان‌های serverless فایل ممکن است اصلاً کپی نشود و آن‌وقت
 * برنامه بی‌صدا به حالت پیش‌فرض می‌افتد. import یعنی «یا فایل هست، یا build
 * شکست می‌خورد» — که همان چیزی است که می‌خواهیم.
 *
 * بازنویسی با محیط: `HERMIPLAN_ACCESS_MODE=open|locked`. برای تغییر بدون
 * build (مثلاً متغیر محیطی روی میزبان) یا برای تست هر دو حالت در یک ماشین.
 */
import accessConfig from "../../../config/access.json";
import {
  accessProfile,
  normalizeAccessMode,
  type AccessMode,
  type AccessProfile,
} from "@/lib/access-mode";

export type AccessModeSource = "env" | "config" | "default";

const fromEnv = process.env.HERMIPLAN_ACCESS_MODE?.trim();
const fromConfig = (accessConfig as { mode?: unknown }).mode;

export const ACCESS_MODE_SOURCE: AccessModeSource = fromEnv ? "env" : fromConfig ? "config" : "default";

/** حالت فعال این فرآیند (یک‌بار در بارگذاری ماژول قطعی می‌شود). */
export const ACCESS_MODE: AccessMode = normalizeAccessMode(fromEnv || fromConfig);

/** پروفایل کامل: سهمیه‌ها، سقف لینک، تاریخچه و متن نشان. */
export const ACCESS: AccessProfile = accessProfile(ACCESS_MODE);

export const isOpenAccess = (): boolean => ACCESS.mode === "open";

/** توضیح خوانا برای `/api/health` و لاگ‌ها. */
export function describeAccessMode(): {
  mode: AccessMode;
  source: AccessModeSource;
  shareLinkCap: number;
  history: { count: number; bytes: number };
} {
  return {
    mode: ACCESS.mode,
    source: ACCESS_MODE_SOURCE,
    shareLinkCap: ACCESS.shareLinkCap,
    history: ACCESS.history,
  };
}
