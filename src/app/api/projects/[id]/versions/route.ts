import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { listProjectVersions, HISTORY_LIMIT, HISTORY_BYTES_LIMIT } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import { internalErrorResponse, isUuid, jsonError, jsonOk } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Owner-only revision list.
 *
 * Metadata only (never the payloads): a project can hold up to
 * `HISTORY_LIMIT` snapshots of a multi-megabyte input, and the sidebar does not
 * need them. `GET …/versions/<n>` returns one payload when the owner asks.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(clientKey(request, "versionRead"), RATE_RULES.versionRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  let row;
  try {
    const rows = await db
      .select({
        ownerUserId: projects.ownerUserId,
        guestToken: projects.guestToken,
        version: projects.version,
      })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    row = rows[0] ?? null;
  } catch (error) {
    return internalErrorResponse(error, "versions", "خواندن تاریخچه ناموفق بود");
  }
  if (!row) return jsonError(404, "پروژه یافت نشد");

  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  if (!isProjectOwner(row, { user, guestToken })) {
    // Same 404 as an unknown id: sharing a report must not expose the history.
    return jsonError(404, "پروژه یافت نشد");
  }

  try {
    const versions = await listProjectVersions(id);
    return jsonOk({
      id,
      currentVersion: row.version,
      versions,
      limits: { count: HISTORY_LIMIT, bytes: HISTORY_BYTES_LIMIT },
    });
  } catch (error) {
    return internalErrorResponse(error, "versions", "خواندن تاریخچه ناموفق بود");
  }
}
