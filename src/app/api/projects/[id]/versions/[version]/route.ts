import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { getProjectVersion, versionReasonLabel } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import { internalErrorResponse, isUuid, jsonError, jsonOk } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One revision payload (owner only) — used to preview before restoring. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const limited = await checkRateLimit(clientKey(request, "versionRead"), RATE_RULES.versionRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id, version: rawVersion } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");
  const version = Number.parseInt(rawVersion, 10);
  if (!Number.isInteger(version) || version < 1) return jsonError(400, "شماره نسخه نامعتبر است");

  try {
    const rows = await db
      .select({
        ownerUserId: projects.ownerUserId,
        guestToken: projects.guestToken,
        currentVersion: projects.version,
      })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return jsonError(404, "پروژه یافت نشد");

    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    if (!isProjectOwner(row, { user, guestToken })) return jsonError(404, "پروژه یافت نشد");

    const detail = await getProjectVersion(id, version);
    if (!detail) return jsonError(404, "این نسخه یافت نشد");

    return jsonOk({
      id,
      currentVersion: row.currentVersion,
      version: detail.version,
      reason: detail.reason,
      reasonLabel: versionReasonLabel(detail.reason),
      createdAt: detail.createdAt,
      project: detail.input,
      reportOptions: detail.reportOptions,
    });
  } catch (error) {
    return internalErrorResponse(error, "versions/:version", "خواندن نسخه ناموفق بود");
  }
}
