import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput } from "@/lib/validation";
import { TEMPLATES } from "@/lib/templates";
import { checkRateLimit, RATE_RULES, clientKey, retryAfterHeaders } from "@/lib/server/rate-limit";
import {
  csrfRejection,
  isSameOriginRequest,
  jsonError,
  jsonOk,
  payloadTooLarge,
  readJson,
  validationErrorResponse,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk({
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
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "analyze"), RATE_RULES.analyze);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید.", {}, retryAfterHeaders(limited));
  }
  if (payloadTooLarge(request, MAX_BODY_BYTES)) {
    return jsonError(413, "حجم داده پروژه بیش از حد مجاز است");
  }

  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return jsonError(400, "بدنه درخواست معتبر نیست");

  const payload = parsedBody.body as { project?: unknown };
  let parsed;
  try {
    parsed = parseProjectInput(payload.project ?? {});
  } catch (error) {
    return validationErrorResponse(error, "analyze");
  }

  const analysis = analyzeProject(parsed);
  return jsonOk({ ok: analysis.errors.length === 0, analysis });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,POST" } });
}
