import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput } from "@/lib/validation";
import { TEMPLATES } from "@/lib/templates";
import { clientKey, rateLimit, RATE_RULES } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    templates: TEMPLATES.map((t) => ({
      id: t.id,
      title: t.title,
      icon: t.icon,
      tagline: t.tagline,
      phases: t.phases,
      activityCount: t.activities.length,
      resourceCount: t.resources.length,
    })),
  });
}

const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: Request) {
  const limited = rateLimit(clientKey(request, "analyze"), RATE_RULES.analyze);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "حجم داده پروژه بیش از حد مجاز است" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بدنه درخواست معتبر نیست" }, { status: 400 });
  }

  const payload = body as { project?: unknown };
  let parsed;
  try {
    parsed = parseProjectInput(payload.project ?? {});
  } catch (error) {
    return NextResponse.json(
      { error: "داده پروژه نامعتبر است", detail: (error as Error).message },
      { status: 422 },
    );
  }
  const analysis = analyzeProject(parsed);

  return NextResponse.json({
    ok: analysis.errors.length === 0,
    analysis,
  });
}
