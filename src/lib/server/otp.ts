/**
 * One-time password lifecycle.
 *
 * Security properties enforced here:
 *  • codes are generated with a CSPRNG (`crypto.randomInt`), never `Math.random`
 *  • only a hash of the code is stored
 *  • codes expire, allow a bounded number of attempts and are single use
 *  • verification is a single atomic UPDATE, so two concurrent requests cannot
 *    both consume the same code
 *  • issuing a new code invalidates the previous one
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpCodes, projects, sessions, users } from "@/db/schema";

export const OTP_LENGTH = 5;
export const OTP_TTL_MS = 5 * 60_000;
export const MAX_OTP_ATTEMPTS = 5;

export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Compares two hexadecimal digests without leaking timing information. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Cryptographically secure numeric code, zero-padded to OTP_LENGTH. */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

/**
 * Creates a new code for `phone`, invalidating any outstanding one.
 * Returns the plain code so the caller can hand it to the SMS adapter — it is
 * never persisted and never returned to the client (except in explicit demo
 * mode outside production).
 */
export async function issueOtp(phone: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)));

  await db.insert(otpCodes).values({ phone, codeHash: hashOtp(code), expiresAt });
  return { code, expiresAt };
}

export type OtpVerifyOutcome =
  | { ok: true }
  | { ok: false; reason: string; code: "not-found" | "expired" | "too-many-attempts" | "mismatch" };

/**
 * Verifies and simultaneously consumes a code.
 *
 * The happy path is one statement (`UPDATE … WHERE … RETURNING`), which makes
 * double-spend impossible. Failures are classified with a follow-up read so the
 * user gets an actionable message without leaking the stored hash.
 */
export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyOutcome> {
  const digest = hashOtp(code);

  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(otpCodes.phone, phone),
        isNull(otpCodes.consumedAt),
        sql`${otpCodes.expiresAt} > now()`,
        sql`${otpCodes.attempts} < ${MAX_OTP_ATTEMPTS}`,
        eq(otpCodes.codeHash, digest),
      ),
    )
    .returning({ id: otpCodes.id });

  if (consumed.length > 0) return { ok: true };

  // Classify the failure for an actionable message.
  const rows = await db
    .select({
      id: otpCodes.id,
      codeHash: otpCodes.codeHash,
      expiresAt: otpCodes.expiresAt,
      attempts: otpCodes.attempts,
      consumedAt: otpCodes.consumedAt,
    })
    .from(otpCodes)
    .where(eq(otpCodes.phone, phone))
    .orderBy(sql`${otpCodes.createdAt} desc`)
    .limit(1);

  const record = rows[0];
  if (!record) return { ok: false, reason: "کدی برای این شماره صادر نشده است.", code: "not-found" };
  if (record.consumedAt) {
    return { ok: false, reason: "این کد قبلاً استفاده شده است. کد جدید بگیرید.", code: "expired" };
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "کد تأیید منقضی شده است. کد جدید بگیرید.", code: "expired" };
  }
  if (Number(record.attempts) >= MAX_OTP_ATTEMPTS) {
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, record.id));
    return {
      ok: false,
      reason: "تعداد تلاش‌های نامعتبر بیش از حد مجاز بود. کد جدید بگیرید.",
      code: "too-many-attempts",
    };
  }

  if (!sameHash(record.codeHash, digest)) {
    const updated = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(eq(otpCodes.id, record.id), isNull(otpCodes.consumedAt)))
      .returning({ attempts: otpCodes.attempts });
    const attempts = Number(updated[0]?.attempts ?? Number(record.attempts) + 1);
    return {
      ok: false,
      reason: `کد تأیید نادرست است (${Math.max(0, MAX_OTP_ATTEMPTS - attempts)} تلاش باقی مانده).`,
      code: "mismatch",
    };
  }

  // Correct code but the row was not consumable (state changed concurrently).
  return { ok: false, reason: "کد تأیید قابل استفاده نیست. کد جدید بگیرید.", code: "expired" };
}

/** Removes consumed/expired codes and expired sessions (housekeeping on auth traffic). */
export async function pruneAuthArtifacts(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60_000);
  try {
    await db.delete(otpCodes).where(lt(otpCodes.expiresAt, cutoff));
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch {
    /* housekeeping is best-effort and must never block authentication */
  }
}

/**
 * Links the projects created in the current browser (guest token) to the
 * authenticated account, so they become available on other devices.
 */
export async function claimGuestProjects(userId: string, guestToken: string | null): Promise<number> {
  if (!guestToken) return 0;
  try {
    const result = await db
      .update(projects)
      .set({ ownerUserId: userId })
      .where(and(eq(projects.guestToken, guestToken), isNull(projects.ownerUserId)))
      .returning({ id: projects.id });
    return result.length;
  } catch {
    return 0;
  }
}

export async function findOrCreateUser(phone: string): Promise<{ id: string; phone: string; displayName: string | null }> {
  const existing = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (existing[0]) {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, existing[0].id));
    return existing[0];
  }
  const inserted = await db.insert(users).values({ phone, lastLoginAt: new Date() }).returning();
  return inserted[0];
}
