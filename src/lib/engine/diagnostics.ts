/**
 * Remedy text for every diagnostic code the engine can emit.
 *
 * The mission requires each warning to answer five questions: **what** happened,
 * **which** activity it affects, **why** (cause), **what it costs** (consequence)
 * and **how to fix it**. The first four live on the diagnostic itself
 * (`message`, `activityIds`, `kind`, `severity`); the remedy is a static,
 * per-code instruction collected here so no call site can forget it and so the
 * wording stays identical across the builder, the report and the exports.
 */
import type { Diagnostic } from "./types";

export const DIAGNOSTIC_REMEDIES: Record<string, string> = {
  /* data */
  "unknown-predecessor":
    "شناسه پیش‌نیاز را در فهرست فعالیت‌ها بررسی کنید؛ یا پیش‌نیاز را بسازید یا اتصال را حذف کنید.",
  "self-dependency": "وابستگی فعالیت به خودش را حذف کنید.",
  "duplicate-dependency": "یکی از دو وابستگی تکراری را حذف کنید.",
  "duplicate-activity-id": "برای هر فعالیت شناسه یکتا تعیین کنید.",
  "invalid-duration": "مدت را به عدد صحیح روز کاری (صفر یا بیشتر) تغییر دهید.",
  "negative-duration": "مدت منفی را به صفر یا بیشتر تغییر دهید.",
  "duration-too-large": "مدت فعالیت را به بازه واقعی اجرای آن کاهش دهید (سقف مجاز در پیام ذکر شده است).",
  "progress-out-of-range": "درصد پیشرفت را در بازه ۰ تا ۱۰۰ وارد کنید.",
  "invalid-constraint-date": "تاریخ محدودیت را به شکل یک تاریخ معتبر (میلادی/شمسی مطابق فرم) وارد کنید.",
  "fractional-duration":
    "مدت را به عدد صحیح روز کاری تغییر دهید؛ موتور روی روز کاری کامل محاسبه می‌کند و عدد اعشاری یک‌بار گرد شده است.",
  "fractional-lag": "تأخیر (Lag) را به عدد صحیح روز کاری تغییر دهید.",
  "duplicate-resource-assignment": "تخصیص تکراری همان منبع را در فهرست تخصیص‌های فعالیت ادغام کنید.",

  /* graph */
  "circular-dependency":
    "یکی از وابستگی‌های مسیر نشان‌داده‌شده را حذف یا جهت آن را اصلاح کنید تا حلقه باز شود.",
  "negative-early-start":
    "Lag منفی یا تاریخ شروع پروژه را بازبینی کنید؛ شروع محاسبه‌شده پیش از آغاز پروژه قرار می‌گرفت.",

  /* constraints */
  "fnlt-violated":
    "یا تاریخ «پایان نه دیرتر از» را واقعی‌تر کنید، یا مدت/منابع فعالیت را کاهش دهید، یا وابستگی‌های مسیر بحرانی را بازچینی کنید.",
  "mso-conflicts-with-logic":
    "تاریخ «باید در تاریخ شروع شود» را با پایان پیش‌نیازها هم‌راست کنید یا خود وابستگی را بازبینی کنید؛ در حال حاضر محدودیت اعمال نشده است.",
  "mso-before-project-start": "تاریخ اجباری شروع را به بعد از تاریخ شروع پروژه منتقل کنید.",
  "mso-later-than-successors":
    "تاریخ اجباری را جلوتر بیاورید یا جانشین‌ها/مدت آن‌ها را بازبینی کنید؛ در غیر این صورت شناوری منفی ایجاد می‌شود.",
  "constraint-without-date": "برای نوع محدودیت انتخاب‌شده تاریخ آن را وارد کنید یا نوع را به ASAP برگردانید.",
  "constraint-non-working-day":
    "تاریخ محدودیت را روی یک روز کاری بگذارید، یا تعطیلی/تقویم را به‌روزرسانی کنید؛ تاریخ مؤثر در پیام آمده است.",

  /* calendar / time position */
  "status-date-before-start": "تاریخ وضعیت را به تاریخ شروع پروژه یا بعد از آن اصلاح کنید.",
  "status-date-after-finish":
    "تاریخ وضعیت را داخل بازه برنامه قرار دهید یا برنامه را تمدید کنید؛ در حال حاضر همه فعالیت‌ها گذشته فرض شده‌اند.",
  "status-date-non-working":
    "اگر گزارش باید همان روز تعطیل بسته شود، تعطیلی را از تقویم بردارید؛ در غیر این صورت تاریخ وضعیت را به روز کاری منتقل کنید.",

  /* milestones */
  "milestone-without-date":
    "برای نقطه کنترل تاریخ تعیین کنید یا آن را به یک فعالیت پیوند بدهید تا تاریخش از برنامه گرفته شود.",

  /* capacity */
  "resource-overallocated":
    "ظرفیت منبع را افزایش دهید، فعالیت را در محدوده شناوری جابه‌جا کنید یا منبع دیگری تخصیص دهید (تسطیح خودکار انجام نمی‌شود).",

  /* engine */
  "internal-error": "داده پروژه را ذخیره کنید و صفحه را دوباره بارگذاری کنید؛ اگر تکرار شد، شناسه پروژه را برای پشتیبانی ارسال کنید.",
};

/** Attaches the static remedy of a code when the emitter did not set one. */
export function withRemedy(diagnostic: Diagnostic): Diagnostic {
  const remedy = diagnostic.remedy ?? DIAGNOSTIC_REMEDIES[diagnostic.code];
  return remedy ? { ...diagnostic, remedy } : diagnostic;
}
