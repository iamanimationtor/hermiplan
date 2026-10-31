/**
 * Account lifecycle: register, authenticate, claim.
 *
 * The rules that matter here are not the happy path but the edges:
 *  • two people racing for the same username must end with exactly one account
 *    (the database decides, not a `SELECT` followed by an `INSERT`);
 *  • a wrong password and an unknown username must be indistinguishable in time
 *    and in wording, so the endpoint cannot be used to enumerate accounts;
 *  • signing in must never rewrite the account row in a way that loses data.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { canonicalUsername } from "./password";

export interface AccountRow {
  id: string;
  username: string | null;
  phone: string | null;
  displayName: string | null;
  passwordHash: string | null;
}

const COLUMNS = {
  id: users.id,
  username: users.username,
  phone: users.phone,
  displayName: users.displayName,
  passwordHash: users.passwordHash,
};

/** Case-insensitive lookup — the same rule the unique index enforces. */
export async function findUserByUsername(username: string): Promise<AccountRow | null> {
  const canonical = canonicalUsername(username);
  if (!canonical) return null;
  const rows = await db
    .select(COLUMNS)
    .from(users)
    .where(sql`lower(${users.username}) = ${canonical}`)
    .limit(1);
  return rows[0] ?? null;
}

export type CreateAccountResult =
  | { ok: true; user: AccountRow }
  | { ok: false; reason: "duplicate" };

/**
 * Inserts a new account. Uniqueness is enforced by the partial unique index, so
 * a concurrent duplicate insert raises `23505` and is reported as `duplicate`
 * instead of producing two accounts with the same name.
 */
export async function createAccount(input: {
  username: string;
  passwordHash: string;
  displayName?: string | null;
}): Promise<CreateAccountResult> {
  const username = canonicalUsername(input.username);
  try {
    const rows = await db
      .insert(users)
      .values({
        username,
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null,
        lastLoginAt: new Date(),
      })
      .returning(COLUMNS);
    return { ok: true, user: rows[0] as AccountRow };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "23505") return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/**
 * Records a successful sign-in. Best-effort: a failure here must not undo a
 * valid login, so the caller ignores the promise's rejection.
 */
export async function touchLastLogin(userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

/** Fills in a phone number for an account that signed up without one. */
export async function attachPhone(userId: string, phone: string): Promise<boolean> {
  try {
    await db
      .update(users)
      .set({ phone })
      .where(and(eq(users.id, userId), sql`${users.phone} is null`));
    return true;
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return false;
    throw error;
  }
}
