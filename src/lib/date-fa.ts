/**
 * Pure Jalali (Solar Hijri) date conversion + Persian formatting helpers.
 * Implemented manually (instead of Intl) so that server rendering and client
 * hydration always produce identical output.
 */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toLatinDigits(input: string): string {
  // Persian (۰-۹) AND Arabic-Indic (٠-٩) digits both appear when users paste
  // from different sources — normalise both so parsing never silently fails.
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/* ------------------------- Jalali conversion ------------------------ */

function div(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Gregorian (ISO yyyy-mm-dd) → Jalali [jy, jm, jd] */
export function toJalali(iso: string): [number, number, number] {
  const [gy, gm, gd] = iso.split("-").map((n) => Number(n));
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/** Jalali [jy, jm, jd] → Gregorian ISO yyyy-mm-dd */
export function fromJalali(jy: number, jm: number, jd: number): string {
  jy += 1595;
  let days =
    -355668 +
    365 * jy +
    div(jy, 33) * 8 +
    div((jy % 33) + 3, 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let gm = 0;
  for (gm = 1; gm <= 12; gm += 1) {
    if (gd <= sal_a[gm]) break;
    gd -= sal_a[gm];
  }
  const mm = String(gm).padStart(2, "0");
  const dd = String(gd).padStart(2, "0");
  return `${gy}-${mm}-${dd}`;
}

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

/** e.g. ۱۴ مرداد ۱۴۰۳ */
export function formatJalali(iso: string, opts: { withMonthName?: boolean; persian?: boolean } = {}): string {
  const [jy, jm, jd] = toJalali(iso);
  const withMonthName = opts.withMonthName ?? true;
  const persian = opts.persian ?? true;
  const text = withMonthName
    ? `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`
    : `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
  return persian ? toPersianDigits(text) : text;
}

export function jalaliMonthLabel(iso: string): string {
  const [, jm, ] = toJalali(iso);
  return JALALI_MONTHS[jm - 1];
}

export function jalaliYear(iso: string): number {
  return toJalali(iso)[0];
}

/** Jalali yyyy/mm/dd string (numeric, latin) — used inside inputs. */
export function isoToJalaliInput(iso: string): string {
  const [jy, jm, jd] = toJalali(iso);
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

/** Accepts yyyy/mm/dd or yyyy-mm-dd Jalali input, returns Gregorian ISO or null. */
export function jalaliInputToIso(value: string): string | null {
  const clean = toLatinDigits(value).replace(/[.\-\\]/g, "/").trim();
  const parts = clean.split("/").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [jy, jm, jd] = parts;
  if (jy < 1200 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  return fromJalali(jy, jm, jd);
}

/* ---------------------------- formatting --------------------------- */

export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "۰";
  return toPersianDigits(
    value.toLocaleString("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }),
  );
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${formatNumber(clamp(value, 0, 1000), fractionDigits)}٪`;
}

export function formatCurrency(value: number, currency: "IRR" | "USD" | "EUR"): string {
  const symbol = currency === "IRR" ? "ریال" : currency === "USD" ? "$" : "€";
  if (currency === "IRR") {
    const millions = value / 1_000_000;
    if (Math.abs(millions) >= 1) {
      return `${formatNumber(millions, Math.abs(millions) >= 100 ? 0 : 1)} میلیون ریال`;
    }
    return `${formatNumber(value)} ${symbol}`;
  }
  return `${symbol}${formatNumber(value)}`;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, 1)} میلیارد`;
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)} میلیون`;
  if (abs >= 1_000) return `${formatNumber(value / 1_000, 1)} هزار`;
  return formatNumber(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const WEEKDAY_LABELS: Record<number, string> = {
  6: "شنبه",
  0: "یکشنبه",
  1: "دوشنبه",
  2: "سه‌شنبه",
  3: "چهارشنبه",
  4: "پنجشنبه",
  5: "جمعه",
};

export function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return WEEKDAY_LABELS[d] ?? "";
}
