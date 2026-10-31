import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * The Content-Security-Policy lives in `src/middleware.ts`, because it needs a
 * per-request nonce for Next.js's inline bootstrap script; a static header here
 * could not carry one. See `scripts/csp-check.ts` for the automated check of the
 * served policy and `docs/evidence/csp.txt` for its output.
 */
const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const productionSecurityHeaders =
  process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [
      { source: "/:path*", headers: [...baseSecurityHeaders, ...productionSecurityHeaders] },
      {
        // Reports can be shared by link; they must never be indexed or cached
        // by an intermediary because they contain contract and cost data.
        source: "/report/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        // Share links (`/s/<token>`) are the same document reached through a
        // secret URL: never index, never cache, never leak the token by referrer.
        source: "/s/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
