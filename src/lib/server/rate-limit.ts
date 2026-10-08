/**
 * Lightweight in-memory rate limiter for public endpoints.
 *
 * Chosen deliberately over a shared store: HERMIPLAN runs as a single Node
 * process in this deployment, and the limiter's job is to stop obvious abuse
 * (CPU via /api/analyze, memory via exports, OTP spam) rather than to provide
 * distributed guarantees. If the app is ever scaled horizontally, swap this
 * for Redis — the call sites do not need to change.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 20_000;

export interface RateLimitRule {
  /** requests allowed inside the window */
  limit: number;
  /** window size in milliseconds */
  windowMs: number;
}

export const RATE_RULES = {
  analyze: { limit: 60, windowMs: 60_000 },
  export: { limit: 30, windowMs: 60_000 },
  projects: { limit: 30, windowMs: 60_000 },
  auth: { limit: 12, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };

  // drop hits outside the window
  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < rule.windowMs);

  if (bucket.hits.length >= rule.limit) {
    const oldest = bucket.hits[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // bound memory usage
  if (buckets.size > MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }

  return { allowed: true, remaining: rule.limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/**
 * Extracts a client identifier from proxy headers, falling back to "local".
 *
 * On Netlify the edge sets `x-nf-client-connection-ip` itself and it cannot be
 * spoofed by the client, so it is preferred. `x-forwarded-for` is client-
 * controlled input: taking its FIRST entry would let an attacker rotate fake
 * values to dodge the limiter, so only the last (proxy-appended) entry is used
 * as a fallback.
 */
export function clientKey(request: Request, scope: string): string {
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlifyIp) return `${scope}:${netlifyIp}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const lastForwarded = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).pop();
  const ip = lastForwarded || request.headers.get("x-real-ip")?.trim() || "local";
  return `${scope}:${ip}`;
}
