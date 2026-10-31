import { NextResponse } from "next/server";
import { createSession, destroySession, getCurrentUser, getGuestToken, parsePhone } from "@/lib/server/auth";
import {
  claimGuestProjects,
  discardOtp,
  findOrCreateUser,
  issueOtp,
  pruneAuthArtifacts,
  verifyOtp,
} from "@/lib/server/otp";
import { checkRateLimit, RATE_RULES, clientIp, retryAfterHeaders } from "@/lib/server/rate-limit";
import { demoOtpAllowed, readSmsConfig, sendOtpSms } from "@/lib/server/sms";
import {
  csrfRejection,
  isSameOriginRequest,
  jsonError,
  jsonOk,
  readJson,
  schemaRejection,
} from "@/lib/server/http";
import {
  canonicalUsername,
  hashPassword,
  isReservedUsername,
  passwordProblem,
  usernameProblem,
  verifyPassword,
} from "@/lib/server/password";
import { createAccount, findUserByUsername, touchLastLogin } from "@/lib/server/accounts";

export const dynamic = "force-dynamic";

/** Minimum delay between two codes for the same phone number. */
const OTP_RESEND_SECONDS = 45;

/** Password guessing budget per username, independent of the per-IP budget. */
const USER_LOGIN_RULE = { limit: 10, windowMs: 15 * 60_000 };

/**
 * A digest of a random password, verified when the username does not exist.
 *
 * Without it, "no such user" returns in microseconds while a wrong password
 * costs a full scrypt (~100 ms) — a timing oracle for which usernames exist.
 * Computed once per process, on first use.
 */
let decoyHash: Promise<string> | null = null;
const decoy = () => (decoyHash ??= hashPassword("decoy-password-1"));

export async function GET() {
  const user = await getCurrentUser();
  return jsonOk({ user });
}

export async function POST(request: Request) {
  // A database that is missing `users.username`/`users.password_hash` (a deploy
  // that skipped `npm run db:migrate`) must say so — 503 with the migration
  // instruction — instead of a bare 500 from the first query.
  try {
    return await handlePost(request);
  } catch (error) {
    const rejection = schemaRejection(error);
    if (rejection) return rejection;
    throw error;
  }
}

async function handlePost(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const ip = clientIp(request);
  const limited = await checkRateLimit(`auth:ip:${ip}`, RATE_RULES.auth);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید.", {}, retryAfterHeaders(limited));
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonError(400, "درخواست نامعتبر است");
  const body = parsed.body as { action?: string; phone?: string; code?: string; username?: string; password?: string };

  // Username + password first: those actions carry no phone at all, so parsing
  // the phone before dispatching would reject every sign-in with a 422.
  if (body.action === "register") return handleRegister(body.username, body.password);
  if (body.action === "login") return handleLogin(body.username, body.password);

  const phoneResult = parsePhone(body.phone ?? "");
  if (!phoneResult.ok) {
    return jsonError(422, "شماره موبایل معتبر نیست (نمونه: ۰۹۱۲۳۴۵۶۷۸۹)");
  }
  const phone = phoneResult.phone;

  if (body.action === "request") return handleRequestCode(phone);
  if (body.action === "verify") return handleVerify(request, phone, body.code);
  return jsonError(400, "عملیات پشتیبانی نمی‌شود");
}

/**
 * Registration.
 *
 * Order matters: validate the shape *before* touching the database, then let
 * PostgreSQL decide uniqueness. A pre-flight `SELECT` alone would leave a race
 * in which two simultaneous registrations both pass the check.
 */
async function handleRegister(rawUsername: unknown, rawPassword: unknown) {
  const usernameIssue = usernameProblem(rawUsername);
  if (usernameIssue) return jsonError(422, usernameIssue);
  const passwordIssue = passwordProblem(rawPassword);
  if (passwordIssue) return jsonError(422, passwordIssue);

  const username = canonicalUsername(rawUsername);
  if (isReservedUsername(username)) {
    return jsonError(409, "این نام کاربری رزرو شده است؛ نام دیگری انتخاب کنید");
  }

  // Fast path only (a friendly message instead of a 500); the index is the
  // authority and the INSERT below handles the losing racer.
  if (await findUserByUsername(username)) {
    return jsonError(409, "این نام کاربری قبلاً گرفته شده است");
  }

  const passwordHash = await hashPassword(String(rawPassword));
  const created = await createAccount({ username, passwordHash });
  if (!created.ok) {
    return jsonError(409, "این نام کاربری قبلاً گرفته شده است");
  }

  const guestToken = await getGuestToken();
  const claimed = await claimGuestProjects(created.user.id, guestToken);
  await createSession(created.user.id);

  return jsonOk(
    {
      ok: true,
      claimedProjects: claimed,
      user: {
        id: created.user.id,
        username: created.user.username,
        phone: created.user.phone,
        displayName: created.user.displayName,
      },
    },
    201,
  );
}

/**
 * Sign-in.
 *
 * A wrong password, an unknown username and a malformed digest all answer with
 * the same 401 body, and the unknown-username path still pays for a full
 * scrypt verification so the response time does not reveal which usernames
 * exist. Failures are counted per username and per IP.
 */
async function handleLogin(rawUsername: unknown, rawPassword: unknown) {
  const usernameIssue = usernameProblem(rawUsername);
  if (usernameIssue) return jsonError(422, usernameIssue);
  if (typeof rawPassword !== "string" || rawPassword.length === 0) {
    return jsonError(422, "رمز عبور را وارد کنید");
  }
  if (rawPassword.length > 200) return jsonError(422, "رمز عبور نمی‌تواند بیش از ۲۰۰ نویسه باشد");

  const username = canonicalUsername(rawUsername);
  const byUser = await checkRateLimit(`auth:user:${username}`, USER_LOGIN_RULE);
  if (!byUser.allowed) {
    return jsonError(
      429,
      "تعداد تلاش‌های ورود برای این نام کاربری بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.",
      {},
      retryAfterHeaders(byUser),
    );
  }

  const user = await findUserByUsername(username);
  const matches = await verifyPassword(rawPassword, user?.passwordHash ?? (await decoy()));
  if (!user || !matches) {
    return jsonError(401, "نام کاربری یا رمز عبور نادرست است");
  }

  void touchLastLogin(user.id).catch(() => undefined);
  const guestToken = await getGuestToken();
  const claimed = await claimGuestProjects(user.id, guestToken);
  await createSession(user.id);

  return jsonOk({
    ok: true,
    claimedProjects: claimed,
    user: { id: user.id, username: user.username, phone: user.phone, displayName: user.displayName },
  });
}

async function handleRequestCode(phone: string) {
  const sms = readSmsConfig();
  const demo = demoOtpAllowed();

  if (!sms.configured && !demo) {
    // No provider and no explicit demo opt-in: refuse with a clear message.
    // Returning a code here would let anyone sign in as any phone number.
    console.error(`[auth] OTP request rejected — ${sms.reason}`);
    return jsonError(
      503,
      "ورود با پیامک در این نصب فعال نیست (سرویس پیامک پیکربندی نشده است). با نام کاربری و رمز عبور وارد شوید یا حساب بسازید.",
      {},
    );
  }

  // Per-phone throttle (independent of the per-IP limit) and the OTP quota,
  // both stored in PostgreSQL so they hold across serverless instances.
  const resend = await checkRateLimit(`otp:send:${phone}`, {
    limit: 1,
    windowMs: OTP_RESEND_SECONDS * 1000,
  });
  if (!resend.allowed) {
    return jsonError(429, "برای دریافت کد جدید کمی صبر کنید", {
      retryAfterSeconds: resend.retryAfterSeconds,
    }, retryAfterHeaders(resend));
  }
  const quota = await checkRateLimit(`otp:request:${phone}`, RATE_RULES.otpRequest);
  if (!quota.allowed) {
    return jsonError(429, "تعداد درخواست کد برای این شماره بیش از حد مجاز است.", {}, retryAfterHeaders(quota));
  }

  void pruneAuthArtifacts();

  const { code } = await issueOtp(phone);

  if (demo) {
    return jsonOk({
      ok: true,
      demoMode: true,
      code,
      message:
        "حالت نمایشی (فقط خارج از محیط تولید و با فعال‌سازی صریح HERMIPLAN_ALLOW_DEMO_OTP): کد در پاسخ نمایش داده می‌شود.",
    });
  }

  const delivery = await sendOtpSms(phone, code);
  if (!delivery.ok) {
    // Never report a failed delivery as success — and never keep a usable code
    // for a message that did not arrive.
    await discardOtp(phone, code).catch(() => undefined);
    return jsonError(
      502,
      "ارسال پیامک ناموفق بود. لطفاً چند لحظه بعد دوباره تلاش کنید؛ اگر ادامه داشت با پشتیبانی تماس بگیرید.",
    );
  }

  return jsonOk({ ok: true, demoMode: false, message: "کد تأیید به شماره شما پیامک شد." });
}

async function handleVerify(request: Request, phone: string, rawCode: string | undefined) {
  // Two independent limits: a client IP cannot cycle phone numbers, and a
  // phone number cannot be attacked from many IPs.
  // Hoisted on purpose: a call inside the key template is how a forgotten
  // `await` once turned every client into the same bucket.
  const verifyIp = clientIp(request);
  const [byIp, byPhone] = await Promise.all([
    checkRateLimit(`otp:verify:ip:${verifyIp}`, RATE_RULES.otpVerify),
    checkRateLimit(`otp:verify:phone:${phone}`, RATE_RULES.otpVerify),
  ]);
  if (!byIp.allowed || !byPhone.allowed) {
    const blocked = byIp.allowed ? byPhone : byIp;
    return jsonError(429, "تعداد تلاش‌های تأیید بیش از حد مجاز است.", {}, retryAfterHeaders(blocked));
  }

  const code = (rawCode ?? "").replace(/\D/g, "");
  if (code.length !== 5) {
    return jsonError(422, "کد تأیید باید ۵ رقم باشد");
  }

  const result = await verifyOtp(phone, code);
  if (!result.ok) {
    return jsonError(401, result.reason);
  }

  const user = await findOrCreateUser(phone);
  const guestToken = await getGuestToken();
  const claimed = await claimGuestProjects(user.id, guestToken);
  await createSession(user.id);

  return jsonOk({
    ok: true,
    claimedProjects: claimed,
    user: { id: user.id, username: user.username, phone: user.phone, displayName: user.displayName },
  });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejection();
  await destroySession();
  return jsonOk({ ok: true });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,POST,DELETE" } });
}
