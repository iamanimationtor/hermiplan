import { NextResponse } from "next/server";
import { createSession, destroySession, getCurrentUser, getGuestToken, normalizePhone, sha256 } from "@/lib/server/auth";
import { claimGuestProjects, findOrCreateUser, pruneAuthArtifacts, verifyOtp } from "@/lib/server/otp";
import { clientKey, rateLimit, RATE_RULES } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Throttles repeat code requests per phone number (independent of the IP limiter). */
const lastRequest = new Map<string, number>();
const THROTTLE_MS = 45_000;

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}

export async function POST(request: Request) {
  const limited = rateLimit(clientKey(request, "auth"), RATE_RULES.auth);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { action?: string; phone?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  }

  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "شماره موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)" }, { status: 422 });
  }

  if (body.action === "request") {
    const smsConfigured = Boolean(process.env.SMS_PROVIDER_KEY);
    // Demo mode must be opted into explicitly (HERMIPLAN_ALLOW_DEMO_OTP=1).
    // Returning the code merely because no SMS provider is configured would let
    // anyone sign in as any phone number on a public deployment.
    const demoAllowed = process.env.HERMIPLAN_ALLOW_DEMO_OTP === "1";

    if (!smsConfigured && !demoAllowed) {
      return NextResponse.json(
        {
          error:
            "ورود با موبایل در این نصب فعال نیست: سرویس پیامک پیکربندی نشده است. استفاده از امکانات اصلی نیازمند ورود نیست.",
          loginUnavailable: true,
        },
        { status: 503 },
      );
    }

    const now = Date.now();
    const previous = lastRequest.get(phone) ?? 0;
    if (now - previous < THROTTLE_MS) {
      return NextResponse.json(
        { error: "برای دریافت کد جدید کمی صبر کنید" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((THROTTLE_MS - (now - previous)) / 1000)) } },
      );
    }
    lastRequest.set(phone, now);
    void pruneAuthArtifacts();

    const code = String(Math.floor(10_000 + Math.random() * 90_000));
    await db_insertOtp(phone, code);

    const demoMode = !smsConfigured && demoAllowed;
    return NextResponse.json({
      ok: true,
      demoMode,
      code: demoMode ? code : undefined,
      message: demoMode
        ? "حالت نمایشی (با فعال‌سازی صریح HERMIPLAN_ALLOW_DEMO_OTP): کد در پاسخ نشان داده می‌شود."
        : "کد تأیید به شماره شما پیامک شد.",
    });
  }

  if (body.action === "verify") {
    const code = (body.code ?? "").replace(/\D/g, "");
    if (code.length !== 5) {
      return NextResponse.json({ error: "کد تأیید باید ۵ رقم باشد" }, { status: 422 });
    }

    const result = await verifyOtp(phone, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? "کد تأیید نامعتبر است" }, { status: 401 });
    }

    const user = await findOrCreateUser(phone);
    const guestToken = await getGuestToken();
    const claimed = await claimGuestProjects(user.id, guestToken);
    await createSession(user.id);

    return NextResponse.json({
      ok: true,
      claimedProjects: claimed,
      user: { id: user.id, phone: user.phone, displayName: user.displayName },
    });
  }

  return NextResponse.json({ error: "عملیات پشتیبانی نمی‌شود" }, { status: 400 });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}

async function db_insertOtp(phone: string, code: string): Promise<void> {
  const { db } = await import("@/db");
  const { otpCodes } = await import("@/db/schema");
  await db.insert(otpCodes).values({
    phone,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
}
