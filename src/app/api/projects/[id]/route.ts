import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, reportOptionsSchema } from "@/lib/validation";
import { getCurrentUser, getGuestToken } from "@/lib/server/auth";
import { clientKey, rateLimit, RATE_RULES } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadProject(id: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Ownership = guest token of the creating browser, or the logged-in account. */
async function isOwner(row: { guestToken: string | null; ownerUserId: string | null }) {
  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  if (user && row.ownerUserId === user.id) return true;
  if (guestToken && row.guestToken === guestToken) return true;
  return false;
}

async function logEvent(projectId: string, kind: string, payload: Record<string, unknown>) {
  try {
    await db.insert(projectEvents).values({ projectId, kind, payload });
  } catch {
    /* the audit trail must never break the primary operation */
  }
}

/**
 * Raw project data (editable payload) is restricted to the owner.
 * The printable report page stays shareable — that is the product's sharing
 * model — and can be made private per project through `isPublic`.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "شناسه پروژه نامعتبر است" }, { status: 400 });
  }

  const row = await loadProject(id);
  if (!row) return NextResponse.json({ error: "پروژه یافت نشد" }, { status: 404 });

  if (!(await isOwner(row))) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  }

  return NextResponse.json({
    id: row.id,
    project: row.input,
    analysis: row.analysis ?? analyzeProject(row.input),
    reportOptions: row.reportOptions,
    isPublic: row.isPublic,
    updatedAt: row.updatedAt,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(clientKey(request, "projects"), RATE_RULES.projects);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const { id } = await ctx.params;
  const row = await loadProject(id);
  if (!row) return NextResponse.json({ error: "پروژه یافت نشد" }, { status: 404 });

  if (!(await isOwner(row))) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  }

  let body: { project?: unknown; reportOptions?: unknown; isPublic?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست" }, { status: 400 });
  }

  // visibility-only update (used by the report toolbar)
  if (typeof body.isPublic === "boolean" && body.project === undefined) {
    await db
      .update(projects)
      .set({ isPublic: body.isPublic, updatedAt: new Date() })
      .where(eq(projects.id, id));
    await logEvent(id, "visibility", { isPublic: body.isPublic });
    return NextResponse.json({ id, isPublic: body.isPublic });
  }

  let input;
  try {
    input = parseProjectInput(body.project ?? row.input);
  } catch (error) {
    return NextResponse.json(
      { error: "داده پروژه نامعتبر است", detail: (error as Error).message },
      { status: 422 },
    );
  }

  const reportOptions = reportOptionsSchema.parse(body.reportOptions ?? row.reportOptions ?? {});
  const analysis = analyzeProject(input);

  await db
    .update(projects)
    .set({
      input,
      analysis,
      reportOptions,
      isPublic: typeof body.isPublic === "boolean" ? body.isPublic : row.isPublic,
      name: input.meta.name,
      projectType: input.meta.type,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id));

  await logEvent(id, "update", {
    activities: input.activities.length,
    workingDays: analysis.schedule.workingDays,
    estimate: analysis.pricing.breakdown.total,
  });

  return NextResponse.json({ id, ok: analysis.errors.length === 0 });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await loadProject(id);
  if (!row) return NextResponse.json({ error: "پروژه یافت نشد" }, { status: 404 });

  if (!(await isOwner(row))) {
    return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  }

  await db.delete(projectEvents).where(eq(projectEvents.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ ok: true });
}
