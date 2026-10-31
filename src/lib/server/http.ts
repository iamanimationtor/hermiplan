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
import { MIGRATION_MESSAGE, isSchemaError } from "./schema";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Strict positive-integer parsing for path/query parameters.
 *
 * `Number.parseInt` is deliberately **not** used for these: it accepts `"1.5"`,
 * `"12abc"` and silently truncates, and a very long digit string becomes a value
 * that overflows the database's `integer` column — a 500 instead of a 400.
 * Returns `null` for anything that is not a plain positive integer within range.
 */
export function parsePositiveInt(raw: string, max = 1_000_000): number | null {
  if (!/^[1-9]\d{0,8}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export interface ApiErrorBody {
  error: string;
  /** field-level problems for 422 responses (message text only, no internals) */
  issues?: { path: string; message: string }[];
  retryAfterSeconds?: number;
  /** present on 409 responses: the revision the server currently holds */
  currentVersion?: number;
  /** machine-readable reason, e.g. `schema_incomplete` for an unmigrated database */
  code?: string;
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

/**
 * A database that is missing tables or columns is a *deployment* state, not a
 * bug: answer 503 with the same wording `/api/health` uses, instead of a 500
 * that hides the real instruction. Returns `null` when the error is something
 * else, so the caller keeps its own handling.
 */
export function schemaRejection(error: unknown): NextResponse<ApiErrorBody> | null {
  if (!isSchemaError(error)) return null;
  console.error("[schema] the database is missing objects — migrations have not been applied:", error);
  return jsonError(503, MIGRATION_MESSAGE, { code: "schema_incomplete" });
}

export function internalErrorResponse(error: unknown, scope: string, message: string): NextResponse<ApiErrorBody> {
  if (isSchemaError(error)) {
    console.error(`[${scope}] is running against an unmigrated database:`, error);
    return jsonError(503, MIGRATION_MESSAGE, { code: "schema_incomplete" });
  }
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

/**
 * Reads a JSON body where **no body at all** is a meaningful request ("do it
 * with defaults"). The distinction matters: `POST /share` with an empty body is
 * valid, while `{"expiresAt":` (truncated JSON) must still be rejected — a
 * half-written payload is a client bug, not an intent.
 */
export async function readOptionalJson(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function payloadTooLarge(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(declared) && declared > maxBytes;
}
