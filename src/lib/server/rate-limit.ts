/**
 * Rate limiting for public and expensive endpoints.
 *
 * The project deploys to a serverless platform (Netlify → one process per
 * function instance), so an in-process counter is not a limit at all: N warm
 * instances multiply every quota by N. The authoritative limiter is therefore
 * an atomic PostgreSQL upsert against `rate_limits`, which works across any
 * number of instances and requires no extra infrastructure.
 *
 * The in-memory implementation is kept **only** as a degraded fallback for
 * local development and for the case where the database is not reachable,
 * and it is documented as such (`degraded: true` in the result).
 */
import { sql } from "drizzle-orm";
import { db, isDatabaseConfigured } from "@/db";

export interface RateLimitRule {
  /** requests allowed inside the window */
  limit: number;
  /** window size in milliseconds */
  windowMs: number;
}

const envInt = (name: string, fallback: number): number => {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/**
 * Default quotas. Every value can be overridden per deployment without a code
 * change — see README → "Rate limits".
 */
export const RATE_RULES = {
  analyze: { limit: envInt("RATE_LIMIT_ANALYZE", 60), windowMs: 60_000 },
  export: { limit: envInt("RATE_LIMIT_EXPORT", 30), windowMs: 60_000 },
  projects: { limit: envInt("RATE_LIMIT_PROJECTS", 30), windowMs: 60_000 },
  projectRead: { limit: envInt("RATE_LIMIT_PROJECT_READ", 120), windowMs: 60_000 },
  auth: { limit: envInt("RATE_LIMIT_AUTH", 12), windowMs: 60_000 },
  otpRequest: { limit: envInt("RATE_LIMIT_OTP_REQUEST", 5), windowMs: 15 * 60_000 },
  otpVerify: { limit: envInt("RATE_LIMIT_OTP_VERIFY", 10), windowMs: 15 * 60_000 },
  shareCreate: { limit: envInt("RATE_LIMIT_SHARE_CREATE", 10), windowMs: 60 * 60_000 },
  shareRevoke: { limit: envInt("RATE_LIMIT_SHARE_REVOKE", 30), windowMs: 60_000 },
  shareRead: { limit: envInt("RATE_LIMIT_SHARE_READ", 240), windowMs: 60_000 },
  versionRead: { limit: envInt("RATE_LIMIT_VERSION_READ", 120), windowMs: 60_000 },
  versionRestore: { limit: envInt("RATE_LIMIT_VERSION_RESTORE", 20), windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  /** true when the distributed store was unavailable and an in-memory counter was used */
  degraded: boolean;
}

/* ------------------------------------------------------------------ */
/* In-memory fallback (development / database outage only)             */
/* ------------------------------------------------------------------ */

const memoryBuckets = new Map<string, number[]>();
const MEMORY_MAX_KEYS = 20_000;

function memoryLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const hits = (memoryBuckets.get(key) ?? []).filter((timestamp) => now - timestamp < rule.windowMs);
  if (hits.length >= rule.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - hits[0])) / 1000));
    memoryBuckets.set(key, hits);
    return { allowed: false, remaining: 0, retryAfterSeconds, degraded: true };
  }
  hits.push(now);
  memoryBuckets.set(key, hits);
  if (memoryBuckets.size > MEMORY_MAX_KEYS) {
    const oldest = memoryBuckets.keys().next().value;
    if (oldest) memoryBuckets.delete(oldest);
  }
  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0, degraded: true };
}

/* ------------------------------------------------------------------ */
/* PostgreSQL-backed limiter                                          */
/* ------------------------------------------------------------------ */

interface LimitRow {
  hits: number;
  window_start: Date | string;
}

/**
 * Increments the window counter for `key` and reports whether the request is
 * allowed. The INSERT … ON CONFLICT is a single atomic statement, so two
 * concurrent requests can never both observe the same count.
 */
export async function checkRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  if (!isDatabaseConfigured()) return memoryLimit(key, rule);

  try {
    const result = await db.execute(sql`
      INSERT INTO rate_limits (key, window_start, hits)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN rate_limits.window_start <= now() - (${rule.windowMs} * interval '1 millisecond') THEN 1
          ELSE rate_limits.hits + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start <= now() - (${rule.windowMs} * interval '1 millisecond') THEN now()
          ELSE rate_limits.window_start
        END
      RETURNING hits, window_start
    `);

    const row = (result as unknown as { rows?: LimitRow[] }).rows?.[0];
    if (!row) return memoryLimit(key, rule);

    const hits = Number(row.hits);
    if (hits > rule.limit) {
      const windowStart = new Date(row.window_start).getTime();
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((rule.windowMs - (Date.now() - windowStart)) / 1000),
      );
      return { allowed: false, remaining: 0, retryAfterSeconds, degraded: false };
    }
    return { allowed: true, remaining: Math.max(0, rule.limit - hits), retryAfterSeconds: 0, degraded: false };
  } catch {
    // Never fail closed on a database hiccup: the limiter is a protection
    // layer, not a dependency of the feature itself.
    return memoryLimit(key, rule);
  }
}

/** Best-effort housekeeping; the caller must not depend on it. */
export async function pruneRateLimits(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  } catch {
    /* housekeeping is best effort */
  }
}

/** Extracts a client identifier from proxy headers, falling back to "local". */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "local"
  );
}

export function clientKey(request: Request, scope: string): string {
  return `${scope}:ip:${clientIp(request)}`;
}

/** Formats a 429 response body shared by every API route. */
export function retryAfterHeaders(result: RateLimitResult): Record<string, string> {
  return { "Retry-After": String(result.retryAfterSeconds) };
}
