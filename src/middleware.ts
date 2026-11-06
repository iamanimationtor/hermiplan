import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce.
 *
 * Why middleware and not `next.config.ts`?
 * ----------------------------------------
 * Next.js injects a small inline bootstrap script into every document. A policy
 * without a nonce would either block it (breaking every page) or have to allow
 * `'unsafe-inline'` for scripts — which defeats the purpose. The framework reads
 * the nonce from the `Content-Security-Policy` **request** header, so the value
 * has to be generated per request here.
 *
 * What the policy actually buys us
 * --------------------------------
 * • `script-src` has no `'unsafe-inline'` and no `'unsafe-eval'` in production:
 *   an injected `<script>` tag cannot execute, even if an escape bug lets markup
 *   through. (Markup escaping is still the primary defence — the report HTML
 *   exporter escapes every project string.)
 * • `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and
 *   `frame-ancestors 'none'` remove three classic injection/clickjacking paths.
 * • `style-src` does need `'unsafe-inline'`: the app sets 20+ React `style={{…}}`
 *   attributes and CSS-in-attributes cannot be nonced. This is a documented,
 *   accepted limitation, not an oversight.
 *
 * Honest limits: this policy was validated by inspecting the served headers and
 * the generated markup (see `scripts/csp-check.ts` and `docs/evidence/csp.txt`),
 * not by a real browser. A browser run is still listed as open work.
 */

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's bootstrap script load the chunks it needs
    // while still refusing any inline script that lacks this request's nonce.
    isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // The font is self-hosted now, so no third-party style/font origin is allowed.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  // `btoa` is part of the edge runtime; `Buffer` is not guaranteed there.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads this header to attach the nonce to its own inline scripts.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  /**
   * Documents and API responses only: static assets under `/_next/static` are
   * immutable and do not need a per-request nonce.
   */
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
