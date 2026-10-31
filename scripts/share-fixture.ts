/**
 * HERMIPLAN — share-link fixture for route-level checks (test databases only).
 *
 * Creates a guest-owned project through the public API, issues a share link, and
 * prints the values needed to probe the *real* routes:
 *
 *   • `CSP_PATHS`      — `/`, `/builder`, the owner report, the shared report, a
 *                        revoked link and an unknown token
 *   • `CSP_COOKIE`     — the guest cookie, so the owner-only route is reachable
 *   • `CSP_EXPECT_404` — the paths that must stay 404
 *
 * It only ever talks to `BASE_URL` with its own fresh cookie jar, so it cannot
 * touch data that belongs to anyone else. Never point it at production data you
 * care about: it creates one project and one link.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/share-fixture.ts
 */
import { buildProjectFromTemplate } from "../src/lib/templates";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const cookieJar = new Map<string, string>();

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorb(response: Response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    if (name) cookieJar.set(name.trim(), rest.join("="));
  }
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const headers = new Headers(init.headers ?? {});
  if (cookieHeader()) headers.set("cookie", cookieHeader());
  if (init.body) headers.set("content-type", "application/json");
  headers.set("x-forwarded-for", "10.66.0.7");
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  absorb(response);
  return { status: response.status, body: await response.text() };
}

async function main() {
  const project = buildProjectFromTemplate("construction");
  project.meta.name = "پروژه آزمون CSP و لینک اشتراک";

  const created = await call("/api/projects", {
    method: "POST",
    body: JSON.stringify({ project, reportOptions: {} }),
  });
  if (created.status !== 201) {
    console.error(`creating the fixture failed: ${created.status} ${created.body.slice(0, 200)}`);
    process.exit(1);
  }
  const projectId = (JSON.parse(created.body) as { id: string }).id;

  const share = await call(`/api/projects/${projectId}/share`, { method: "POST", body: "{}" });
  if (share.status !== 201) {
    console.error(`creating the share link failed: ${share.status} ${share.body.slice(0, 200)}`);
    process.exit(1);
  }
  const { token, tokenId, url } = JSON.parse(share.body) as { token: string; tokenId: string; url: string };

  // A second link that is revoked right away: it must behave exactly like an
  // unknown token (404) and must not be distinguishable from one.
  const doomed = await call(`/api/projects/${projectId}/share`, { method: "POST", body: "{}" });
  const doomedBody = JSON.parse(doomed.body) as { token: string; tokenId: string };
  await call(`/api/projects/${projectId}/share?tokenId=${doomedBody.tokenId}`, { method: "DELETE" });

  const unknownToken = "a".repeat(43);
  const paths = [
    "/",
    "/builder",
    `/report/${projectId}`,
    `/s/${token}`,
    `/s/${doomedBody.token}`,
    `/s/${unknownToken}`,
  ].join(",");
  const expect404 = [`/s/${doomedBody.token}`, `/s/${unknownToken}`].join(",");

  console.log(`CSP_PATHS=${paths}`);
  console.log(`CSP_EXPECT_404=${expect404}`);
  console.log(`CSP_COOKIE=${cookieHeader()}`);
  console.error(`fixture ready: project ${projectId} · share ${url} · owner cookie len ${cookieHeader().length}`);
}

void main();
