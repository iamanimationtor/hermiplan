/**
 * Share tokens for printable report links.
 *
 * Security model
 * --------------
 * • The token is 256 bits from `crypto.randomBytes` (CSPRNG), encoded as
 *   base64url — guessing one is not feasible and the identifiers are unrelated
 *   to the project UUID, so knowing a UUID authorises nothing.
 * • Only `sha256(token)` is stored. A leaked database dump therefore does not
 *   leak working links, and looking a token up is a single indexed equality on
 *   the digest (no secret-dependent comparison to time out).
 * • Links expire (`expires_at`) and are revocable (`revoked_at`); revocation is
 *   immediate because access is checked on every request.
 * • Every lifecycle step writes a `project_events` row, so the owner can see
 *   when a link was created, used and revoked.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projectShareTokens, projects } from "@/db/schema";
import { generateShareToken, hashShareToken, SHARE_TOKEN_BYTES, SHARE_TOKEN_RE } from "@/lib/server/share-token-core";

export { generateShareToken, hashShareToken, SHARE_TOKEN_BYTES, SHARE_TOKEN_RE };

export interface ShareTokenView {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  active: boolean;
}

function toView(row: typeof projectShareTokens.$inferSelect): ShareTokenView {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    useCount: row.useCount,
    active: row.revokedAt === null && !expired,
  };
}

export async function listShareTokens(projectId: string): Promise<ShareTokenView[]> {
  const rows = await db
    .select()
    .from(projectShareTokens)
    .where(eq(projectShareTokens.projectId, projectId))
    .orderBy(sql`${projectShareTokens.createdAt} DESC`)
    .limit(50);
  return rows.map(toView);
}

export interface CreatedShareToken {
  token: string;
  view: ShareTokenView;
}

/** Creates a link. The plaintext token is returned exactly once. */
export async function createShareToken(
  projectId: string,
  options: { expiresAt?: Date | null; label?: string | null } = {},
): Promise<CreatedShareToken> {
  const token = generateShareToken();
  const [row] = await db
    .insert(projectShareTokens)
    .values({
      projectId,
      tokenHash: hashShareToken(token),
      label: options.label ?? null,
      expiresAt: options.expiresAt ?? null,
    })
    .returning();

  // Publishing is implied by issuing a link, and it is recorded as an explicit
  // owner action rather than a silent side effect.
  await db
    .update(projects)
    .set({ isPublic: true, shareExpiresAt: options.expiresAt ?? null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  await db.insert(projectEvents).values({
    projectId,
    kind: "share-created",
    payload: { tokenId: row.id, expiresAt: options.expiresAt?.toISOString() ?? null },
  });

  return { token, view: toView(row) };
}

export async function revokeShareToken(projectId: string, tokenId: string): Promise<boolean> {
  const result = await db
    .update(projectShareTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(projectShareTokens.id, tokenId),
        eq(projectShareTokens.projectId, projectId),
        isNull(projectShareTokens.revokedAt),
      ),
    )
    .returning({ id: projectShareTokens.id });
  if (result.length === 0) return false;
  await db.insert(projectEvents).values({ projectId, kind: "share-revoked", payload: { tokenId } });
  return true;
}

/** Revokes every active link of a project and makes the project private again. */
export async function revokeAllShareTokens(projectId: string): Promise<number> {
  const rows = await db
    .update(projectShareTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(projectShareTokens.projectId, projectId), isNull(projectShareTokens.revokedAt)))
    .returning({ id: projectShareTokens.id });
  await db
    .update(projects)
    .set({ isPublic: false, shareExpiresAt: null, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  await db.insert(projectEvents).values({
    projectId,
    kind: "share-revoked-all",
    payload: { count: rows.length },
  });
  return rows.length;
}

export interface ResolvedShare {
  projectId: string;
  tokenId: string;
}

/**
 * Resolves a share token to a project. Returns `null` for unknown, revoked or
 * expired tokens — the caller must answer 404 in all three cases so the
 * response never distinguishes "wrong token" from "expired token".
 */
export async function resolveShareToken(token: string): Promise<ResolvedShare | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const hash = hashShareToken(token);
  const rows = await db
    .select({
      tokenId: projectShareTokens.id,
      projectId: projectShareTokens.projectId,
      expiresAt: projectShareTokens.expiresAt,
      revokedAt: projectShareTokens.revokedAt,
    })
    .from(projectShareTokens)
    .where(eq(projectShareTokens.tokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return null;

  // Usage telemetry is best effort: it must never block reading a report.
  try {
    await db
      .update(projectShareTokens)
      .set({ lastUsedAt: new Date(), useCount: sql`${projectShareTokens.useCount} + 1` })
      .where(eq(projectShareTokens.id, row.tokenId));
  } catch {
    /* ignored on purpose */
  }

  return { projectId: row.projectId, tokenId: row.tokenId };
}
