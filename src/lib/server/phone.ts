/**
 * Canonical Iranian mobile number normalisation.
 *
 * Every accepted spelling of the same number must collapse to one canonical
 * form (`09XXXXXXXXX`), because phone numbers are primary keys for rate limits,
 * OTP throttling and user lookup. The previous implementation stripped
 * non-ASCII characters, which silently destroyed Persian/Arabic digits and
 * accepted strings with embedded `+` signs.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Persian and Arabic-Indic digits to ASCII digits. */
export function toAsciiDigits(value: string): string {
  let out = "";
  for (const char of value) {
    const persian = PERSIAN_DIGITS.indexOf(char);
    if (persian >= 0) {
      out += String(persian);
      continue;
    }
    const arabic = ARABIC_DIGITS.indexOf(char);
    if (arabic >= 0) {
      out += String(arabic);
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Characters that may legally appear inside a phone number typed by a user:
 * whitespace, dashes, dots, parentheses, slashes and bidi control marks.
 * Everything else is rejected rather than silently ignored.
 */
const SEPARATORS = /[\s\u00A0\u200B-\u200F\u202A-\u202E().\-/]/g;

export type PhoneParseResult =
  | { ok: true; phone: string }
  | { ok: false; reason: "empty" | "invalid-characters" | "invalid-length" | "invalid-prefix" };

/**
 * Parses a user supplied phone number into the canonical `09XXXXXXXXX` form.
 *
 * Accepted inputs (all resolve to `09123456789`):
 *   09123456789 · ۰۹۱۲۳۴۵۶۷۸۹ · ٠٩١٢٣٤٥٦٧٨٩ · 912 345 6789 · +98 912 345 6789
 *   00989123456789 · 0098-912-345-6789 · 989123456789
 */
export function parsePhone(input: string): PhoneParseResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };

  const ascii = toAsciiDigits(input).trim();
  if (!ascii) return { ok: false, reason: "empty" };

  const compact = ascii.replace(SEPARATORS, "");
  if (!/^\+?\d+$/.test(compact)) return { ok: false, reason: "invalid-characters" };

  const hasPlus = compact.startsWith("+");
  const digits = hasPlus ? compact.slice(1) : compact;

  // International → national
  let national: string;
  if (hasPlus) {
    if (!digits.startsWith("98")) return { ok: false, reason: "invalid-prefix" };
    national = digits.slice(2);
  } else if (digits.startsWith("0098")) {
    national = digits.slice(4);
  } else if (digits.startsWith("98") && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits;
  } else if (digits.startsWith("9")) {
    national = `0${digits}`;
  } else {
    return { ok: false, reason: "invalid-prefix" };
  }

  // Iranian mobile numbers are 09 + 9 digits (11 digits total).
  if (national.length !== 11) return { ok: false, reason: "invalid-length" };
  if (!/^09\d{9}$/.test(national)) return { ok: false, reason: "invalid-prefix" };

  return { ok: true, phone: national };
}

/** Convenience wrapper returning `null` for invalid input. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhone(input);
  return parsed.ok ? parsed.phone : null;
}
