import type { MetadataRoute } from "next";

/**
 * The sitemap lists the public pages only.
 *
 * Projects are private by construction (`is_public` defaults to false and access
 * needs a token), so they must never appear here — enumerating them would be an
 * information leak even if every URL answered 404.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hermiplan.netlify.app").replace(/\/+$/, "");
  const lastModified = new Date(process.env.BUILD_TIME ?? Date.now());
  return [
    { url: `${base}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/builder`, lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];
}
