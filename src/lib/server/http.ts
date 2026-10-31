/**
 * Shared HTTP helpers for the API routes: input guards, error normalisation,
 * CSRF (same-origin) checks and cache policy.
 *
 * Error messages come in two flavours:
 *  • `userMessage` — safe, actionable, in Persian, returned to the client
 *  • internal detail — logged on the server only (never serialised)
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface ApiErrorBody {
  error: string;
  /** field-level problems for 422 responses (message text only, no internals) */
  issues?: { path: string; message: string }[];
  retryAfterSeconds?: number;
}

export function jsonError(
  status: number,
  error: string,
  extra: Omit<ApiErrorBody, "error"> = {},
  headers: Record<string, string> = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function jsonOk<T extends object>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Maps a thrown value to a safe client message and logs the internal detail.
 * Zod errors keep their field paths (they describe the request, not the
 * server), everything else collapses to a generic message.
 */
export function validationErrorResponse(error: unknown, scope: string): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return jsonError(422, "داده پروژه نامعتبر است", {
      issues: error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  console.error(`[${scope}] validation failed:`, error);
  return jsonError(422, "داده پروژه نامعتبر است");
}

export function internalErrorResponse(error: unknown, scope: string, message: string): NextResponse<ApiErrorBody> {
  console.error(`[${scope}]`, error);
  return jsonError(500, message);
}

/**
 * CSRF guard for mutating requests.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site form
 * posts; this adds defence in depth by rejecting requests whose `Origin`
 * disagrees with the request host and by honouring `Sec-Fetch-Site`.
 * Requests without either header (server-to-server clients, curl) are allowed
 * because they cannot be triggered by a victim's browser.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originHost = new URL(origin).host;
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return originHost === host;
  } catch {
    return false;
  }
}

export function csrfRejection(): NextResponse<ApiErrorBody> {
  return jsonError(403, "درخواست از منبع نامعتبر ارسال شده است");
}

/** Parses a JSON body, distinguishing malformed JSON from an empty body. */
export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export function payloadTooLarge(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(declared) && declared > maxBytes;
}
