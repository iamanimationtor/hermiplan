import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * A strict CSP is intentionally NOT set: the Persian webfont is loaded from a
 * CDN through a CSS `@import`, and Next.js injects inline bootstrap scripts, so
 * a policy written without browser testing would either break the UI or be
 * meaningless. This is a documented, known gap (see
 * docs/AUDIT-REPORT.md → «معیارهای پذیرش ناتمام») rather than a guessed
 * configuration.
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
    ];
  },
};

export default nextConfig;
