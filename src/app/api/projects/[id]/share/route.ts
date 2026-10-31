import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
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
} from "@/lib/server/http";
import {
  countActiveShareTokens,
  createShareToken,
  listShareTokens,
  revokeAllShareTokens,
  revokeShareToken,
} from "@/lib/server/share-token";

export const dynamic = "force-dynamic";

/** Hard cap on live links per project — bounded blast radius for a leaked list. */
const MAX_ACTIVE_LINKS = 10;

/**
 * Share links for the printable report.
 *
 *   GET    /api/projects/:id/share          → link metadata (never the token)
 *   POST   /api/projects/:id/share          → issue a link; the token is
 *                                             returned exactly once
 *   DELETE /api/projects/:id/share          → revoke one link
 *         ?tokenId=<id>                       (or every link with ?all=1)
 *
 * Only the owner may call any of these. Every response is `no-store`.
 */

async function loadOwnedProject(id: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  if (!row) return { row: null, owner: false } as const;
  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  return { row, owner: isProjectOwner(row, { user, guestToken }) } as const;
}

/** Expiry is optional; when present it must be a valid future date. */
function parseExpiry(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  if (date.getTime() <= Date.now()) return { ok: false };
  // A link beyond ten years is far more likely a typo than an intent.
  if (date.getTime() > Date.now() + 10 * 365 * 24 * 3600 * 1000) return { ok: false };
  return { ok: true, value: date };
}

function shareUrl(request: Request, token: string): string {
  // The canonical origin, when configured, is authoritative: behind a proxy or a
  // serverless function the request URL can expose the internal bind address
  // (e.g. http://0.0.0.0:3000), which must never end up in a link a client shares.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return `${configured}/s/${token}`;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}/s/${token}`;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(clientKey(request, "projectRead"), RATE_RULES.projectRead);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  try {
    const { row, owner } = await loadOwnedProject(id);
    if (!row || !owner) return jsonError(404, "پروژه یافت نشد");
    return jsonOk({ id, isPublic: row.isPublic, tokens: await listShareTokens(id) });
  } catch (error) {
    return internalErrorResponse(error, "projects/:id/share", "خواندن لینک‌های اشتراک ناموفق بود");
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "shareCreate"), RATE_RULES.shareCreate);
  if (!limited.allowed) {
    return jsonError(429, "تعداد ساخت لینک بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  // An empty body is a valid request ("just create a link with defaults").
  const parsedBody = await readJson(request);
  if (!parsedBody.ok) return jsonError(400, "بدنه درخواست معتبر نیست");
  const body = (parsedBody.body ?? {}) as { expiresAt?: unknown; label?: unknown };

  const expiry = parseExpiry(body.expiresAt);
  if (!expiry.ok) return jsonError(422, "تاریخ انقضای لینک باید تاریخی در آینده باشد");
  if (body.label !== undefined && (typeof body.label !== "string" || body.label.length > 80)) {
    return jsonError(422, "برچسب لینک نامعتبر است");
  }

  try {
    const { row, owner } = await loadOwnedProject(id);
    if (!row || !owner) return jsonError(404, "پروژه یافت نشد");

    const active = await countActiveShareTokens(id);
    if (active >= MAX_ACTIVE_LINKS) {
      return jsonError(
        409,
        `حداکثر ${MAX_ACTIVE_LINKS} لینک فعال برای هر پروژه مجاز است؛ ابتدا یکی را باطل کنید`,
      );
    }

    const created = await createShareToken(id, { expiresAt: expiry.value, label: body.label ?? null });
    return jsonOk(
      {
        id,
        token: created.token,
        url: shareUrl(request, created.token),
        tokenId: created.view.id,
        expiresAt: created.view.expiresAt,
        warning: "این لینک فقط یک‌بار نمایش داده می‌شود؛ آن را در جای امن نگه دارید.",
      },
      201,
    );
  } catch (error) {
    return internalErrorResponse(error, "projects/:id/share", "ساخت لینک اشتراک ناموفق بود");
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "shareRevoke"), RATE_RULES.shareRevoke);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌ها بیش از حد مجاز است", {}, retryAfterHeaders(limited));
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "شناسه پروژه نامعتبر است");

  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "1";
  const tokenId = url.searchParams.get("tokenId");

  try {
    const { row, owner } = await loadOwnedProject(id);
    if (!row || !owner) return jsonError(404, "پروژه یافت نشد");

    if (all) {
      const count = await revokeAllShareTokens(id);
      return jsonOk({ id, revoked: count, all: true });
    }
    if (!tokenId || !isUuid(tokenId)) return jsonError(400, "شناسه لینک نامعتبر است");
    const revoked = await revokeShareToken(id, tokenId);
    if (!revoked) return jsonError(404, "لینک فعال یافت نشد");
    return jsonOk({ id, revoked: 1, tokenId });
  } catch (error) {
    return internalErrorResponse(error, "projects/:id/share", "ابطال لینک اشتراک ناموفق بود");
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { Allow: "GET,POST,DELETE" } });
}
