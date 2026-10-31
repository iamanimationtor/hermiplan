/**
 * HERMIPLAN — JS budget guard.
 *
 *   npm run build && npm run test:bundle
 *
 * Next.js prints first-load sizes, but that output is prose for humans: nothing
 * fails a build when a page quietly doubles in weight. This script reads the
 * build manifest, gzips every chunk the browser actually downloads for each
 * route, and compares the result with an explicit budget.
 *
 * Why gzip: that is what goes over the wire (Netlify compresses). Uncompressed
 * size mostly measures comments and whitespace.
 *
 * The budgets are deliberately tight around today's numbers — they are a ratchet,
 * not a ceiling. If a change legitimately needs more, raise the number here in a
 * reviewable diff instead of shipping a silent regression.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Manifests are emitted per page by the App Router as
 * `.next/server/app/<route>/page_client-reference-manifest.js`. The file is a JS
 * assignment, not JSON, so the chunk list is read with a pattern instead of a
 * parser: every `"/_next/static/chunks/….js"` it mentions is a chunk that page
 * downloads. Counting a shared chunk twice is impossible (a Set is used), and
 * counting one extra chunk only makes the budget stricter, never weaker.
 */
const BUDGETS_KB: Record<string, number> = {
  // measured 2026-10-31: / 23.8 · /builder 175.3 · report 137.1 · not-found 20.6
  "/": 45,
  "/builder": 210,
  "/report/[id]": 170,
  "/s/[token]": 170,
  "/_not-found": 40,
  "/_global-error": 40,
};

const DEFAULT_BUDGET_KB = 210;
const CHUNK_PATTERN = /"(\/_next\/static\/chunks\/[^"]+\.js)"/g;

function routePages(): { route: string; manifestPath: string }[] {
  const appDir = join(process.cwd(), ".next", "server", "app");
  const found: { route: string; manifestPath: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name === "page_client-reference-manifest.js") {
        const relativeDir = relative(appDir, dir);
        const route = "/" + relativeDir.split(/[\\/]/).join("/");
        found.push({ route, manifestPath: path });
      }
    }
  };
  walk(appDir);
  return found;
}

function gzipBytes(chunk: string): number {
  // chunk is "/_next/static/chunks/x.js"; the file lives in ".next/static/chunks"
  const path = join(process.cwd(), ".next", chunk.replace(/^\/_next\//, ""));
  if (!existsSync(path)) return 0;
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

let failed = 0;
const pages = routePages();
if (pages.length === 0) {
  console.error("no page manifests found — run `npm run build` first.");
  process.exit(1);
}

console.log("▶ بودجه‌ی جاوااسکریپت هر مسیر (gzip)");
const rows: { route: string; kb: number; budget: number; over: boolean }[] = [];
for (const page of pages) {
  const source = readFileSync(page.manifestPath, "utf8");
  const chunks = new Set<string>();
  for (const match of source.matchAll(CHUNK_PATTERN)) chunks.add(match[1]);
  const bytes = [...chunks].reduce((sum, chunk) => sum + gzipBytes(chunk), 0);
  const kb = Math.round((bytes / 1024) * 10) / 10;
  const budget = BUDGETS_KB[page.route] ?? DEFAULT_BUDGET_KB;
  const over = kb > budget;
  if (over) failed += 1;
  rows.push({ route: page.route, kb, budget, over });
}

rows.sort((a, b) => b.kb - a.kb);
for (const row of rows) {
  console.log(
    `  ${row.over ? "✗" : "✓"} ${row.route.padEnd(18, " ")} ${String(row.kb).padStart(7)} KB  (سقف ${row.budget} KB)`,
  );
}

const heaviest = rows[0];
console.log(`\n  سنگین‌ترین مسیر: ${heaviest.route} با ${heaviest.kb} KB gzip`);

/*
 * A budget that can never fail is decoration. This sanity check shows the
 * comparison actually rejects something: the heaviest route must exceed a
 * hypothetical 1 KB budget.
 */
if (heaviest.kb > 1) {
  console.log("  ✓ خودآزمون: بودجه‌ی ۱KB روی سنگین‌ترین مسیر «نقض» تشخیص داده می‌شود");
} else {
  failed += 1;
  console.log("  ✗ خودآزمون بودجه شکست خورد (مقایسه درست کار نمی‌کند)");
}

if (failed) {
  console.log(`\n✘ ${failed} مسیر از بودجه فراتر رفته است.`);
  process.exit(1);
}
console.log(`\n✔ ${rows.length} مسیر در بودجه‌ی تعیین‌شده هستند.`);
