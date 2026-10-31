import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

export { normalizePhone, parsePhone, toAsciiDigits } from "./phone";

export const GUEST_COOKIE = "hermiplan_guest";
export const SESSION_COOKIE = "hermiplan_session";
const SESSION_DAYS = 60;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Session cookies: httpOnly (no script access), SameSite=Lax (blocks cross-site
 * POSTs — the CSRF boundary for this app) and Secure in production.
 */
const sessionCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: isProduction(),
  path: "/",
};

export async function getGuestToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value ?? null;
}

/** Reads or creates the guest identity cookie (idempotent within one request). */
export async function ensureGuestToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;
  if (existing) return existing;
  const token = `g_${randomUUID()}`;
  store.set(GUEST_COOKIE, token, {
    ...sessionCookieOptions,
    maxAge: 60 * 60 * 24 * 365,
  });
  return token;
}

export interface SessionUser {
  id: string;
  /** Primary identity since 0005 — null only for legacy phone-only accounts. */
  username: string | null;
  /** Null for password-only accounts. */
  phone: string | null;
  displayName: string | null;
}

/** The name to show in the UI: username first, then phone, then a generic label. */
export function userLabel(user: Pick<SessionUser, "username" | "phone" | "displayName">): string {
  return user.displayName?.trim() || user.username || user.phone || "کاربر";
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        phone: users.phone,
        displayName: users.displayName,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Creates a fresh session token (rotation on every successful login). */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ token, userId, expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...sessionCookieOptions, expires: expiresAt });
}

/** Revokes the current session server-side and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await db.delete(sessions).where(eq(sessions.token, token));
    } catch {
      /* the cookie must be cleared even if the database is unreachable */
    }
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Single owner check used by every project-scoped route and page.
 * Ownership = the logged-in account, or the guest token of the creating
 * browser. Nothing else grants access to private data.
 */
export function isProjectOwner(
  row: { guestToken: string | null; ownerUserId: string | null },
  context: { user: SessionUser | null; guestToken: string | null },
): boolean {
  if (context.user && row.ownerUserId === context.user.id) return true;
  if (context.guestToken && row.guestToken === context.guestToken) return true;
  return false;
}
