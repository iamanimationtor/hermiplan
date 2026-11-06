/**
 * Creates a throwaway project + share link so route-level checks can be run
 * against the *real* pages: the owner report and a live share link.
 *
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/share-fixture.ts
 *
 * It prints the environment values another check needs, for example:
 *
 *   CSP_PATHS=/report/<id>,/s/<token>
 *   CSP_COOKIE=hermiplan_guest=…
 *
 * Test databases only: it writes a guest project and a share token. Never run
 * it against production.
 */
import { buildProjectFromTemplate } from "../src/lib/templates";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const jar: string[] = [];

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const headers = new Headers(init.headers ?? {});
  if (jar.length) headers.set("cookie", jar.join("; "));
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie?.() ?? []) jar.push(cookie.split(";")[0]);
  return { status: response.status, body: await response.text() };
}

async function main(): Promise<void> {
  const project = buildProjectFromTemplate("construction");
  project.meta.name = "پروژه آزمون مسیرها";

  const created = await call("/api/projects", {
    method: "POST",
    body: JSON.stringify({ project, reportOptions: {} }),
  });
  if (created.status !== 201) {
    console.error(`fixture failed: POST /api/projects → ${created.status} ${created.body.slice(0, 200)}`);
    process.exit(1);
  }
  const id = (JSON.parse(created.body) as { id: string }).id;

  const share = await call(`/api/projects/${id}/share`, { method: "POST", body: "{}" });
  if (share.status !== 201) {
    console.error(`fixture failed: POST /share → ${share.status} ${share.body.slice(0, 200)}`);
    process.exit(1);
  }
  const token = (JSON.parse(share.body) as { token: string }).token;

  console.log(`CSP_PATHS=/report/${id},/s/${token}`);
  console.log(`CSP_COOKIE=${jar.join("; ")}`);
  console.log(`fixture ready: project ${id} · share ${BASE}/s/${token}`);
}

void main();
