import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { restoreProjectVersion } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import { csrfRejection, internalErrorResponse, isSameOriginRequest, isUuid, jsonError, jsonOk, parsePositiveInt } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Restores a past revision.
 *
 * The previous state is snapshotted (`pre-restore`) in the same transaction, so a
 * restore is itself undoable — the operation never destroys anything.
 *
 * `expectedVersion` (optional) makes it safe against a concurrent edit: if the
 * project moved on since the owner opened the history, the restore is refused
 * with 409 rather than silently reverting newer work.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "versionRestore"), RATE_RULES.versionRestore);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id, version: rawVersion } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");
  const targetVersion = parsePositiveInt(rawVersion);
  if (targetVersion === null) return jsonError(400, "شماره نسخه نامعتبر است");

  // The body is optional; when present it may carry `expectedVersion`.
  let expectedVersion: number | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    if (raw.trim()) {
      try {
        const body = JSON.parse(raw) as { expectedVersion?: unknown };
        if (body.expectedVersion !== undefined) {
          if (!Number.isInteger(body.expectedVersion)) return jsonError(422, "شماره نسخه فعلی نامعتبر است");
          expectedVersion = body.expectedVersion as number;
        }
      } catch {
        return jsonError(400, "بدنه درخواست معتبر نیست");
      }
    }
  }

  let ownerRow;
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
    ownerRow = rows[0] ?? null;
  } catch (error) {
    return internalErrorResponse(error, "versions/restore", "بازگردانی ناموفق بود");
  }
  if (!ownerRow) return jsonError(404, "پروژه یافت نشد");

  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  if (!isProjectOwner(ownerRow, { user, guestToken })) return jsonError(404, "پروژه یافت نشد");

  try {
    const result = await restoreProjectVersion({
      projectId: id,
      targetVersion,
      actor: { kind: user ? "owner" : "guest", userId: user?.id ?? null },
      expectedVersion,
    });

    if (!result.ok && result.reason === "conflict") {
      return jsonError(409, "این پروژه پس از بازکردن تاریخچه تغییر کرده است؛ فهرست را دوباره بارگذاری کنید", {
        currentVersion: result.currentVersion,
      });
    }
    if (!result.ok) return jsonError(404, "این نسخه یافت نشد");

    const restored = await db
      .select({ input: projects.input, analysis: projects.analysis })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    const analysis = restored[0]?.analysis ?? (restored[0] ? analyzeProject(restored[0].input) : null);

    try {
      await db.insert(projectEvents).values({
        projectId: id,
        kind: "restore",
        payload: {
          restoredFrom: result.restoredFrom ?? null,
          version: result.version ?? null,
          activities: analysis?.activities.length ?? null,
          estimate: analysis?.pricing.breakdown.total ?? null,
        },
      });
    } catch (error) {
      console.error("[versions] restore audit event failed:", error);
    }

    return jsonOk({
      id,
      ok: true,
      version: result.version,
      restoredFrom: result.restoredFrom,
      activities: analysis?.activities.length ?? null,
    });
  } catch (error) {
    return internalErrorResponse(error, "versions/restore", "بازگردانی ناموفق بود");
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "POST" } });
}
