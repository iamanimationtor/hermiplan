import type { MetadataRoute } from "next";

/**
 * Public crawling policy.
 *
 * Only the two public pages are indexable. Project reports (`/report/…`) are
 * owner-only and share links (`/s/…`) are secret URLs — a crawler that stored
 * one would publish a client's cost data, so both are disallowed here *and*
 * carry `X-Robots-Tag: noindex` plus `Referrer-Policy: no-referrer` from
 * `next.config.ts` (defence in depth: `robots.txt` is only a request).
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hermiplan.netlify.app").replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/builder"],
        disallow: ["/api/", "/report/", "/s/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
