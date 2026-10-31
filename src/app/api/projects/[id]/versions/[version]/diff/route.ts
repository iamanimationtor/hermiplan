import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { getProjectVersion, versionReasonLabel } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import { internalErrorResponse, isUuid, jsonError, jsonOk, parsePositiveInt } from "@/lib/server/http";
import { diffRevisions } from "@/lib/report/version-diff";

export const dynamic = "force-dynamic";

/**
 * `GET /api/projects/:id/versions/:version/diff[?against=<version|current>]`
 *
 * "What changed between this revision and the current project?" — the question
 * an owner asks before restoring. Owner-only, like every other revision route:
 * a stranger, an anonymous visitor or a share link gets 404, never a partial
 * answer that would reveal the project exists.
 *
 * The answer is computed on demand from stored payloads; nothing is cached, so
 * it can never disagree with the data actually stored.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const limited = await checkRateLimit(clientKey(request, "versionRead"), RATE_RULES.versionRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id, version: rawVersion } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");
  const version = parsePositiveInt(rawVersion);
  if (version === null) return jsonError(400, "شماره نسخه نامعتبر است");

  const againstRaw = new URL(request.url).searchParams.get("against") ?? "current";
  let against: number | "current";
  if (againstRaw === "current") {
    against = "current";
  } else {
    const parsed = parsePositiveInt(againstRaw);
    if (parsed === null) return jsonError(400, "نسخه مقایسه نامعتبر است");
    against = parsed;
  }

  try {
    const rows = await db
      .select({
        ownerUserId: projects.ownerUserId,
        guestToken: projects.guestToken,
        currentVersion: projects.version,
        input: projects.input,
        reportOptions: projects.reportOptions,
      })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    const row = rows[0];
    // Same 404 for "does not exist" and "not yours": existence is not public.
    if (!row) return jsonError(404, "پروژه یافت نشد");
    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    if (!isProjectOwner(row, { user, guestToken })) return jsonError(404, "پروژه یافت نشد");

    const base = await getProjectVersion(id, version);
    if (!base) return jsonError(404, "این نسخه یافت نشد");

    let target: { version: number; createdAt: string; reason: string | null; input: typeof row.input; reportOptions: typeof row.reportOptions };
    if (against === "current") {
      target = {
        version: row.currentVersion,
        createdAt: new Date().toISOString(),
        reason: null,
        input: row.input,
        reportOptions: row.reportOptions,
      };
    } else {
      const other = await getProjectVersion(id, against);
      if (!other) return jsonError(404, "نسخه مقایسه یافت نشد");
      target = { version: other.version, createdAt: other.createdAt, reason: other.reason, input: other.input, reportOptions: other.reportOptions };
    }

    const diff = diffRevisions(
      { project: base.input, reportOptions: base.reportOptions },
      { project: target.input, reportOptions: target.reportOptions },
    );

    return jsonOk({
      id,
      from: { version: base.version, createdAt: base.createdAt, reason: base.reason, reasonLabel: versionReasonLabel(base.reason) },
      to: {
        version: target.version,
        createdAt: target.createdAt,
        reason: target.reason,
        reasonLabel: target.reason ? versionReasonLabel(target.reason) : "نسخه جاری",
      },
      diff,
    });
  } catch (error) {
    return internalErrorResponse(error, "versions/:version/diff", "مقایسه نسخه‌ها ناموفق بود");
  }
}
