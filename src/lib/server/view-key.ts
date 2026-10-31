/**
 * Capability key for opening **one** project's report page without cookies.
 *
 * Why this exists: the report page is owner-only, and ownership is proven by a
 * cookie (the account session or the guest token). A cookie is not always
 * available — a browser that blocks third-party cookies, an embedded preview,
 * or a user who opens the link in another browser — and the result was a
 * correct-but-useless 404 on the owner's own project. Requiring a cookie was
 * "secure" and unusable at the same time.
 *
 * The key is an HMAC over the project id, so it cannot be guessed or forged and
 * cannot be reused for another project. It is handed out only in responses the
 * caller was already allowed to read (the create/save response and the owner's
 * project list), and it grants exactly one thing: rendering `/report/<id>`.
 * It does **not** unlock the history, share, delete or raw-data endpoints —
 * those keep their cookie check.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Derived from a server-side secret, never from anything the client can see.
 * `HERMIPLAN_VIEW_SECRET` is preferred; otherwise the database URL (which never
 * leaves the server and already contains the database password) is hashed into
 * one. Changing the credential therefore invalidates outstanding keys, which is
 * the behaviour we want when a deployment's secret leaks.
 */
function secret(): Buffer {
  const material =
    process.env.HERMIPLAN_VIEW_SECRET ??
    process.env.DATABASE_URL ??
    "hermiplan-development-view-secret";
  return createHash("sha256").update(`hermiplan:report-view:${material}`).digest();
}

export function projectViewKey(projectId: string): string {
  return createHmac("sha256", secret()).update(projectId).digest("base64url");
}

/** Constant-time comparison; any malformed input is simply `false`. */
export function verifyProjectViewKey(projectId: string, candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 128) return false;
  const expected = Buffer.from(projectViewKey(projectId), "utf8");
  const given = Buffer.from(candidate, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** `/report/<id>?k=<key>` — one helper so every caller builds the same URL. */
export function reportHref(projectId: string): string {
  return `/report/${projectId}?k=${encodeURIComponent(projectViewKey(projectId))}`;
}
