/**
 * Password credentials — hashing and policy, with no database and no request
 * in sight, so every rule below can be tested on its own.
 *
 * Why scrypt and not bcrypt/argon2: Node ships scrypt in `node:crypto`, so the
 * hardening does not depend on a native module surviving a serverless build.
 * The parameters travel *inside* the stored string, which means they can be
 * raised later without invalidating existing accounts.
 *
 * What is stored: `scrypt$N$r$p$salt$hash` — never the password, and never
 * anything that can be replayed without the password itself.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/** Cost parameters. N=2^15 keeps a login around ~60–100 ms on a small VM. */
export const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 32, saltBytes: 16 } as const;

/** scrypt needs 128·N·r bytes; Node's default maxmem (32 MB) would refuse N=2^15. */
const MAX_MEM = 128 * SCRYPT.N * SCRYPT.r * 2;

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, keyLength, { N, r, p, maxmem: MAX_MEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

/** `scrypt$N$r$p$salt$hash` (base64url parts, no padding surprises). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltBytes);
  const hash = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

/**
 * Verifies a password against a stored digest.
 *
 * A malformed or unknown digest returns `false` instead of throwing: a broken
 * row must deny access, not crash the sign-in route and leak a stack trace.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(rawSalt, "base64url");
    expected = Buffer.from(rawHash, "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await scrypt(password, salt, N, r, p, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Rules — the same messages are shown to the user and asserted in tests */
/* ------------------------------------------------------------------ */

/** Persian digits, so validation messages read like the rest of the UI. */
const fa = (value: number | string): string =>
  String(value).replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] as string);

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/**
 * Usernames are stored lower-case and compared lower-case, so `Ali` and `ali`
 * are the same account. Only characters that survive a URL, a log line and a
 * spreadsheet cell without escaping are allowed.
 */
export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .replace(/[\u200c\u200f\u200e]/g, "")
    .trim()
    .toLowerCase();
}

/** Persian/Arabic digits → ASCII, so a name typed on a Persian keyboard still matches. */
const ASCII_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function usernameProblem(raw: unknown): string | null {
  const value = normalizeUsername(raw).replace(/[۰-۹٠-٩]/g, (digit) => ASCII_DIGITS[digit] ?? digit);
  if (value.length === 0) return "نام کاربری را وارد کنید";
  if (value.length < USERNAME_MIN) return `نام کاربری باید حداقل ${fa(USERNAME_MIN)} نویسه باشد`;
  if (value.length > USERNAME_MAX) return `نام کاربری نمی‌تواند بیش از ${fa(USERNAME_MAX)} نویسه باشد`;
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) {
    return "نام کاربری فقط می‌تواند شامل حروف انگلیسی، رقم، نقطه، خط تیره و زیرخط باشد و باید با حرف یا رقم شروع و تمام شود";
  }
  return null;
}

/** The canonical form to store after `usernameProblem` passed. */
export function canonicalUsername(raw: unknown): string {
  return normalizeUsername(raw).replace(/[۰-۹٠-٩]/g, (digit) => ASCII_DIGITS[digit] ?? digit);
}

/**
 * Password policy: length is the property that actually matters, so the rule is
 * "long enough, not absurdly long" plus a light diversity requirement. There is
 * no forced symbol class and no maximum-complexity theatre.
 */
export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "رمز عبور را وارد کنید";
  if (raw.length < PASSWORD_MIN) return `رمز عبور باید حداقل ${fa(PASSWORD_MIN)} نویسه باشد`;
  if (raw.length > PASSWORD_MAX) return `رمز عبور نمی‌تواند بیش از ${fa(PASSWORD_MAX)} نویسه باشد`;
  if (!/\p{L}/u.test(raw)) return "رمز عبور باید حداقل یک حرف داشته باشد";
  if (!/[0-9۰-۹٠-٩]/.test(raw)) return "رمز عبور باید حداقل یک رقم داشته باشد";
  return null;
}

/** Usernames that would be confusing in a URL, a log or a support request. */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "hermiplan",
  "support",
  "api",
  "login",
  "logout",
  "register",
  "signup",
  "me",
  "user",
  "test",
]);

export const isReservedUsername = (username: string): boolean => RESERVED_USERNAMES.has(username);
