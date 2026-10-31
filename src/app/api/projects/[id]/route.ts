import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, reportOptionsSchema } from "@/lib/validation";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
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
    project: row.input,
    analysis: row.analysis ?? analyzeProject(row.input),
    reportOptions: row.reportOptions,
    isPublic: row.isPublic,
    shareExpiresAt: row.shareExpiresAt,
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
  };

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
    await logEvent(id, "visibility", {
      isPublic: nextPublic,
      shareExpiresAt: (expiry === undefined ? row.shareExpiresAt : expiry)?.toISOString() ?? null,
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

  try {
    await db
      .update(projects)
      .set({
        input,
        analysis,
        reportOptions,
        isPublic: body.isPublic ?? row.isPublic,
        shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
        name: input.meta.name,
        projectType: input.meta.type,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));
  } catch (error) {
    return internalErrorResponse(error, "projects/:id", "ذخیره پروژه ناموفق بود");
  }

  await logEvent(id, "update", {
    activities: input.activities.length,
    workingDays: analysis.schedule.workingDays,
    estimate: analysis.pricing.breakdown.total,
  });

  return jsonOk({
    id,
    ok: analysis.errors.length === 0,
    isPublic: body.isPublic ?? row.isPublic,
    shareExpiresAt: expiry === undefined ? row.shareExpiresAt : expiry,
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
