import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { projectEvents, projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, reportOptionsSchema } from "@/lib/validation";
import { ensureGuestToken, getCurrentUser, getGuestToken } from "@/lib/server/auth";
import { clientKey, rateLimit, RATE_RULES } from "@/lib/server/rate-limit";
import { readJsonBody } from "@/lib/server/body";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    if (!user && !guestToken) return NextResponse.json({ projects: [] });

    const filters = [];
    if (user) filters.push(eq(projects.ownerUserId, user.id));
    if (guestToken) filters.push(eq(projects.guestToken, guestToken));

    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectType: projects.projectType,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(filters.length > 1 ? or(...filters) : (filters[0] as never))
      .orderBy(desc(projects.updatedAt))
      .limit(50);

    return NextResponse.json({ projects: rows });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(clientKey(request, "projects"), RATE_RULES.projects);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const payload = parsed.body as { project?: unknown; reportOptions?: unknown };
  let input;
  try {
    input = parseProjectInput(payload.project ?? {});
  } catch (error) {
    return NextResponse.json(
      { error: "داده پروژه نامعتبر است", detail: (error as Error).message },
      { status: 422 },
    );
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
    } catch {
      /* audit trail is best-effort */
    }

    return NextResponse.json({ id: row.id, ok: analysis.errors.length === 0 }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "ذخیره پروژه ناموفق بود", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
