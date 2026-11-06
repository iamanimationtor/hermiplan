/**
 * یکی‌کردن «حالت دسترسی» در یک نقطه.
 *
 * سوئیچ در `config/access.json` است و همین یک فایل، تنها جایی است که برای
 * بازگرداندن محدودیت‌ها تغییر می‌کند (`npm run access:locked`). مقدار
 * `HERMIPLAN_ACCESS_MODE` می‌تواند آن را در محیط اجرا بازنویسی کند (مثلاً روی
 * Netlify بدون تغییر فایل).
 *
 * دو حالت:
 *
 *   open   — نسخهٔ پیش از انتشار: همهٔ امکانات برای همه، بدون سهمیهٔ محصول،
 *            بدون سقف لینک اشتراک، تاریخچهٔ بلندتر. محدودیت‌های **امنیتی**
 *            (ورود/OTP) دست‌نخورده می‌مانند، چون محافظت در برابر حمله‌اند نه
 *            محدودیت محصول.
 *   locked — تحویل واقعی: همان رفتار محافظه‌کارانهٔ قبلی.
 *
 * این ماژول عمداً «خالص» است (بدون fs و بدون process) تا هم در سرور و هم در
 * تست‌ها یکسان رفتار کند؛ خواندن فایل/محیط در `server/access-mode.ts` است.
 */

export type AccessMode = "open" | "locked";

export const ACCESS_MODES: AccessMode[] = ["open", "locked"];

/**
 * قواعد سهمیه‌ای که در حالت open برداشته می‌شوند.
 *
 * `auth`, `otpRequest` و `otpVerify` عمداً در این فهرست نیستند: آن‌ها سد
 * امنیتی‌اند (حدس زدن کد یک‌بارمصرف و انبوه‌سازی ورود)، نه محدودیت محصول.
 */
export const PRODUCT_QUOTA_KEYS = [
  "analyze",
  "export",
  "projects",
  "projectRead",
  "projectsList",
  "shareCreate",
  "shareRevoke",
  "shareRead",
  "versionRead",
  "versionRestore",
] as const;

export type ProductQuotaKey = (typeof PRODUCT_QUOTA_KEYS)[number];

/** سقف لینک فعال هر پروژه در حالت locked (در open برداشته می‌شود). */
export const LOCKED_SHARE_LINK_CAP = 10;

/**
 * سقف فنیِ سرور برای تعداد لینک در حالت open.
 *
 * این عدد «محدودیت محصول» نیست: هیچ کاربری به آن نمی‌رسد، اما بدون آن یک
 * اسکریپت می‌تواند صدها هزار ردیف در یک پروژه بسازد و پایگاه داده را پر کند.
 * عدد را بالا گذاشته‌ایم به‌قدری که در عمل بی‌نهایت باشد.
 */
export const OPEN_SHARE_LINK_CEILING = 100_000;

/** نگهداری تاریخچهٔ نسخه‌ها: تعداد نسخه و حجم کل هر پروژه. */
export interface HistoryLimits {
  count: number;
  bytes: number;
}

export interface AccessProfile {
  mode: AccessMode;
  /** آیا این قاعدهٔ سهمیه در این حالت اعمال می‌شود؟ */
  enforcesQuota: (key: string) => boolean;
  /** سقف لینک فعال هر پروژه */
  shareLinkCap: number;
  history: HistoryLimits;
  /** متن کوتاه برای نمایش در رابط کاربری (خالی یعنی چیزی نشان نده) */
  badge: string;
}

const LOCKED_HISTORY: HistoryLimits = { count: 20, bytes: 8 * 1024 * 1024 };
const OPEN_HISTORY: HistoryLimits = { count: 100, bytes: 32 * 1024 * 1024 };

export function accessProfile(mode: AccessMode): AccessProfile {
  if (mode === "open") {
    return {
      mode,
      enforcesQuota: (key) => !(PRODUCT_QUOTA_KEYS as readonly string[]).includes(key),
      shareLinkCap: OPEN_SHARE_LINK_CEILING,
      history: OPEN_HISTORY,
      badge: "نسخهٔ عمومی — همهٔ امکانات رایگان و بدون سهمیه",
    };
  }
  return {
    mode,
    enforcesQuota: () => true,
    shareLinkCap: LOCKED_SHARE_LINK_CAP,
    history: LOCKED_HISTORY,
    badge: "",
  };
}

/** هر مقدار ناشناخته به حالت محافظه‌کارانه (locked) برمی‌گردد. */
export function normalizeAccessMode(raw: unknown): AccessMode {
  return raw === "open" ? "open" : "locked";
}
