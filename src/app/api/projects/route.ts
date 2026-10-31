import { NextResponse } from "next/server";
import { desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, reportOptionsSchema } from "@/lib/validation";
import { ensureGuestToken, getCurrentUser, getGuestToken } from "@/lib/server/auth";
import { recordProjectCreation } from "@/lib/server/project-versions";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import {
  csrfRejection,
  internalErrorResponse,
  isSameOriginRequest,
  jsonError,
  jsonOk,
  parsePositiveInt,
  payloadTooLarge,
  readJson,
  validationErrorResponse,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One page of the saved-project list (the UI asks for 20 at a time). */
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

const MAX_BODY_BYTES = 3_000_000;

/**
 * `GET /api/projects?limit=&offset=` — newest first.
 *
 * Bounded and paged on purpose: a guest can accumulate projects over months, and
 * an unbounded list is both a slow query and a large response. The response says
 * how many projects exist in total, so the UI can offer "show more" instead of
 * silently pretending the first page is everything.
 *
 * A database failure returns 500 — never an empty list, which would read as
 * "you have no projects" and could make a user think their work was lost.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const limit = rawLimit === null ? DEFAULT_PAGE : parsePositiveInt(rawLimit, MAX_PAGE);
  if (limit === null) return jsonError(400, "مقدار limit نامعتبر است");
  const offset = rawOffset === null ? 0 : /^\d{1,6}$/.test(rawOffset) ? Number(rawOffset) : null;
  if (offset === null) return jsonError(400, "مقدار offset نامعتبر است");

  // Listing costs a count + a page read; it is rate-limited like other reads so
  // a script cannot use it to hammer the database.
  const limited = await checkRateLimit(clientKey(request, "projectsList"), RATE_RULES.projectRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  try {
    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    if (!user && !guestToken) return jsonOk({ projects: [], total: 0, hasMore: false, nextOffset: null });

    const filters = [];
    if (user) filters.push(eq(projects.ownerUserId, user.id));
    if (guestToken) filters.push(eq(projects.guestToken, guestToken));
    const where = filters.length > 1 ? or(...filters) : (filters[0] as never);

    const [rows, counted] = await Promise.all([
      db
        .select({
          id: projects.id,
          name: projects.name,
          projectType: projects.projectType,
          isPublic: projects.isPublic,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(where)
        .orderBy(desc(projects.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(projects).where(where),
    ]);

    const total = Number(counted[0]?.count ?? rows.length);
    const nextOffset = offset + rows.length < total ? offset + rows.length : null;
    return jsonOk({ projects: rows, total, hasMore: nextOffset !== null, nextOffset });
  } catch (error) {
    return internalErrorResponse(error, "projects", "خواندن فهرست پروژه‌ها ناموفق بود");
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "projects"), RATE_RULES.projects);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }
  if (payloadTooLarge(request, MAX_BODY_BYTES)) {
    return jsonError(413, "حجم داده پروژه بیش از حد مجاز است");
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonError(400, "بدنه درخواست معتبر نیست");

  const payload = parsed.body as { project?: unknown; reportOptions?: unknown };
  let input;
  try {
    input = parseProjectInput(payload.project ?? {});
  } catch (error) {
    return validationErrorResponse(error, "projects");
  }

  const reportOptions = reportOptionsSchema.parse(payload.reportOptions ?? {});
  const analysis = analyzeProject(input);

  try {
    const [user, guestToken] = await Promise.all([getCurrentUser(), ensureGuestToken()]);
    const [row] = await db
      .insert(projects)
      .values({
        ownerUserId: user?.id ?? null,
        guestToken: guestToken ?? null,
        name: input.meta.name,
        projectType: input.meta.type,
        // New projects are private until the owner publishes them explicitly.
        isPublic: false,
        input,
        analysis,
        reportOptions,
      })
      .returning({ id: projects.id });

    try {
      await db.insert(projectEvents).values({
        projectId: row.id,
        kind: "create",
        payload: {
          activities: input.activities.length,
          workingDays: analysis.schedule.workingDays,
          estimate: analysis.pricing.breakdown.total,
        },
      });
    } catch (error) {
      /* audit trail is best-effort, but a failure must stay visible in logs */
      console.error("[projects] audit event failed:", error);
    }

    await recordProjectCreation(row.id, input, reportOptions, {
      kind: user ? "owner" : "guest",
      userId: user?.id ?? null,
    });

    return jsonOk({ id: row.id, ok: analysis.errors.length === 0, isPublic: false, version: 1 }, 201);
  } catch (error) {
    return internalErrorResponse(error, "projects", "ذخیره پروژه ناموفق بود");
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,POST" } });
}
