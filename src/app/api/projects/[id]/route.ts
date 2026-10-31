import { projectViewKey } from "@/lib/server/view-key";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, reportOptionsSchema } from "@/lib/validation";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { revokeAllShareTokens } from "@/lib/server/share-token";
import { saveProjectRevision } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import {
  csrfRejection,
  internalErrorResponse,
  isSameOriginRequest,
  isUuid,
  jsonError,
  jsonOk,
  readJson,
  validationErrorResponse,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

async function loadProject(id: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0] ?? null;
}

async function loadOwnerContext() {
  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  return { user, guestToken };
}

async function logEvent(projectId: string, kind: string, payload: Record<string, unknown>) {
  try {
    await db.insert(projectEvents).values({ projectId, kind, payload });
  } catch (error) {
    /* the audit trail must never break the primary operation */
    console.error("[projects/:id] audit event failed:", error);
  }
}

/** Normalises the optional share expiry (ISO date or null). */
function parseShareExpiry(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Raw project data (editable payload) is restricted to the owner.
 * The printable report page is shareable only when the owner published it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(clientKey(request, "projectRead"), RATE_RULES.projectRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  let row;
  try {
    row = await loadProject(id);
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "خواندن پروژه ناموفق بود");
  }
  if (!row) return jsonError(404, "پروژه یافت نشد");

  if (!isProjectOwner(row, await loadOwnerContext())) {
    // 404 for foreign ids: never confirm that someone else's project exists.
    return jsonError(404, "پروژه یافت نشد");
  }

  return jsonOk({
    id: row.id,
    // Same reasoning as the list: the caller just proved ownership.
    viewKey: projectViewKey(row.id),
    project: row.input,
    analysis: row.analysis ?? analyzeProject(row.input),
    reportOptions: row.reportOptions,
    isPublic: row.isPublic,
    shareExpiresAt: row.shareExpiresAt,
    version: row.version,
    updatedAt: row.updatedAt,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "projects"), RATE_RULES.projects);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  let row;
  try {
    row = await loadProject(id);
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "ویرایش پروژه ناموفق بود");
  }
  if (!row) return jsonError(404, "پروژه یافت نشد");
  if (!isProjectOwner(row, await loadOwnerContext())) {
    return jsonError(404, "پروژه یافت نشد");
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonError(400, "بدنه درخواست معتبر نیست");
  const body = parsed.body as {
    project?: unknown;
    reportOptions?: unknown;
    isPublic?: unknown;
    shareExpiresAt?: unknown;
    expectedVersion?: unknown;
  };

  let expectedVersion: number | undefined;
  if (body.expectedVersion !== undefined) {
    if (!Number.isInteger(body.expectedVersion)) return jsonError(422, "شماره نسخه نامعتبر است");
    expectedVersion = body.expectedVersion as number;
  }

  const expiry = parseShareExpiry(body.shareExpiresAt);
  if (body.shareExpiresAt !== undefined && expiry === undefined) {
    return jsonError(422, "تاریخ انقضای اشتراک نامعتبر است");
  }

  // Publishing is an explicit, auditable owner action.
  if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") {
    return jsonError(422, "وضعیت انتشار باید مقدار بولی داشته باشد");
  }

  // Visibility-only update (used by the report toolbar).
  if (body.project === undefined) {
    if (body.isPublic === undefined && body.shareExpiresAt === undefined) {
      return jsonError(400, "درخواست ویرایش خالی است");
    }
    const nextPublic = body.isPublic ?? row.isPublic;
    await db
      .update(projects)
      .set({
        isPublic: nextPublic,
        shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));
    // Turning sharing off must actually turn it off: every outstanding link is
    // revoked in the same request, so an old link cannot outlive the decision.
    if (!nextPublic) await revokeAllShareTokens(id);
    await logEvent(id, "visibility", {
      isPublic: nextPublic,
      shareExpiresAt: (expiry === undefined ? row.shareExpiresAt : expiry)?.toISOString() ?? null,
      revokedLinks: nextPublic ? 0 : true,
    });
    return jsonOk({
      id,
      isPublic: nextPublic,
      shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
    });
  }

  let input;
  try {
    input = parseProjectInput(body.project);
  } catch (error) {
    return validationErrorResponse(error, "projects/:id");
  }

  let reportOptions;
  try {
    reportOptions = reportOptionsSchema.parse(body.reportOptions ?? row.reportOptions ?? {});
  } catch (error) {
    return validationErrorResponse(error, "projects/:id");
  }

  const analysis = analyzeProject(input);

  // One transaction: revision number, snapshot and prune. `expectedVersion`
  // turns a concurrent edit into 409 instead of a silent overwrite.
  let outcome;
  try {
    outcome = await saveProjectRevision({
      projectId: id,
      input,
      reportOptions,
      name: input.meta.name,
      projectType: input.meta.type,
      isPublic: body.isPublic ?? row.isPublic,
      shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
      analysis,
      expectedVersion,
      actor: { kind: row.ownerUserId ? "owner" : "guest", userId: row.ownerUserId },
    });
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "ذخیره پروژه ناموفق بود");
  }

  if (outcome.status === "conflict") {
    return jsonError(
      409,
      "این پروژه از جای دیگری تغییر کرده است؛ نسخه تازه را بارگذاری کنید و ویرایش را دوباره اعمال کنید",
      { currentVersion: outcome.currentVersion },
    );
  }
  if (outcome.status === "missing") return jsonError(404, "پروژه یافت نشد");

  if (body.isPublic === false) await revokeAllShareTokens(id);

  await logEvent(id, "update", {
    activities: input.activities.length,
    workingDays: analysis.schedule.workingDays,
    estimate: analysis.pricing.breakdown.total,
    version: outcome.version,
    unchanged: outcome.unchanged,
  });

  return jsonOk({
    id,
    viewKey: projectViewKey(id),
    ok: analysis.errors.length === 0,
    isPublic: body.isPublic ?? row.isPublic,
    shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
    version: outcome.version,
    unchanged: outcome.unchanged,
  });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  let row;
  try {
    row = await loadProject(id);
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "حذف پروژه ناموفق بود");
  }
  if (!row) return jsonError(404, "پروژه یافت نشد");
  if (!isProjectOwner(row, await loadOwnerContext())) {
    return jsonError(404, "پروژه یافت نشد");
  }

  try {
    // project_events has ON DELETE CASCADE, so a single statement is atomic.
    await db.delete(projects).where(eq(projects.id, id));
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "حذف پروژه ناموفق بود");
  }

  return jsonOk({ ok: true });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,PATCH,DELETE" } });
}
