import { NextResponse } from "next/server";
import { createSession, destroySession, getCurrentUser, getGuestToken, parsePhone } from "@/lib/server/auth";
import { claimGuestProjects, findOrCreateUser, issueOtp, pruneAuthArtifacts, verifyOtp } from "@/lib/server/otp";
import { checkRateLimit, RATE_RULES, clientIp, retryAfterHeaders } from "@/lib/server/rate-limit";
import { demoOtpAllowed, readSmsConfig, sendOtpSms } from "@/lib/server/sms";
import { csrfRejection, isSameOriginRequest, jsonError, jsonOk, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Minimum delay between two codes for the same phone number. */
const OTP_RESEND_SECONDS = 45;

export async function GET() {
  const user = await getCurrentUser();
  return jsonOk({ user });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const ip = clientIp(request);
  const limited = await checkRateLimit(`auth:ip:${ip}`, RATE_RULES.auth);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید.", {}, retryAfterHeaders(limited));
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonError(400, "درخواست نامعتبر است");
  const body = parsed.body as { action?: string; phone?: string; code?: string };

  const phoneResult = parsePhone(body.phone ?? "");
  if (!phoneResult.ok) {
    return jsonError(422, "شماره موبایل معتبر نیست (نمونه: ۰۹۱۲۳۴۵۶۷۸۹)");
  }
  const phone = phoneResult.phone;

  if (body.action === "request") {
    return handleRequestCode(request, phone);
  }
  if (body.action === "verify") {
    return handleVerify(request, phone, body.code);
  }
  return jsonError(400, "عملیات پشتیبانی نمی‌شود");
}

async function handleRequestCode(request: Request, phone: string) {
  const sms = readSmsConfig();
  const demo = demoOtpAllowed();

  if (!sms.configured && !demo) {
    // No provider and no explicit demo opt-in: refuse with a clear message.
    // Returning a code here would let anyone sign in as any phone number.
    console.error(`[auth] OTP request rejected — ${sms.reason}`);
    return jsonError(
      503,
      "ورود با موبایل در این نصب فعال نیست: سرویس پیامک پیکربندی نشده است. استفاده از امکانات اصلی نیازمند ورود نیست.",
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
    // Never report a failed delivery as success.
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
  const [byIp, byPhone] = await Promise.all([
    checkRateLimit(`otp:verify:ip:${clientIp(request)}`, RATE_RULES.otpVerify),
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
    user: { id: user.id, phone: user.phone, displayName: user.displayName },
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
