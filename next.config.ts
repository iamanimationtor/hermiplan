import type { NextConfig } from "next";

/**
 * Baseline security headers.
 * A strict CSP is intentionally NOT set here: the Persian webfont is loaded
 * from a CDN and Next.js relies on inline styles, so a restrictive policy
 * would break the UI. Verifying a safe CSP requires browser testing that is
 * not available in this environment — documented rather than guessed.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
