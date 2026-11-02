import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpCodes, projects, sessions, users } from "@/db/schema";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Constant-time comparison so verification time does not leak match information. */
function safeEqualHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * OTP verification with brute-force protection.
 * The `attempts` column is a legacy text column, so it is parsed numerically
 * here instead of being migrated (keeps existing data untouched).
 */
const MAX_OTP_ATTEMPTS = 5;

export async function verifyOtp(phone: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const rows = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(sql`${otpCodes.createdAt} desc`)
    .limit(1);

  const record = rows[0];
  if (!record) return { ok: false, reason: "کدی برای این شماره صادر نشده است." };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "کد تأیید منقضی شده است." };

  const attempts = Number.parseInt(record.attempts ?? "0", 10) || 0;
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, record.id));
    return { ok: false, reason: "تعداد تلاش‌های نامعتبر بیش از حد مجاز بود. کد جدید بگیرید." };
  }

  if (!safeEqualHash(record.codeHash, sha256(code))) {
    await db
      .update(otpCodes)
      .set({ attempts: String(attempts + 1) })
      .where(eq(otpCodes.id, record.id));
    return {
      ok: false,
      reason: `کد تأیید نادرست است (${MAX_OTP_ATTEMPTS - attempts - 1} تلاش باقی مانده).`,
    };
  }

  await db
    .update(otpCodes)
    .set({ consumedAt: new Date(), attempts: String(attempts + 1) })
    .where(eq(otpCodes.id, record.id));
  return { ok: true };
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
