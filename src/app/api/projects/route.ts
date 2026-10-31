import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
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
  payloadTooLarge,
  readJson,
  validationErrorResponse,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 3_000_000;

export async function GET() {
  try {
    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    if (!user && !guestToken) return jsonOk({ projects: [] });

    const filters = [];
    if (user) filters.push(eq(projects.ownerUserId, user.id));
    if (guestToken) filters.push(eq(projects.guestToken, guestToken));

    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectType: projects.projectType,
        isPublic: projects.isPublic,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(filters.length > 1 ? or(...filters) : (filters[0] as never))
      .orderBy(desc(projects.updatedAt))
      .limit(50);

    return jsonOk({ projects: rows });
  } catch (error) {
    console.error("[projects] list failed:", error);
    return jsonOk({ projects: [] });
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
