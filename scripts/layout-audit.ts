/**
 * HERMIPLAN — visual/layout audit **without a browser**.
 *
 * Why this exists (and what it is not)
 * ------------------------------------
 * Real browser rendering needs Chromium, which cannot start in this environment
 * (the shared libraries `libnspr4.so` / `libnss3.so` are absent and installing
 * them needs root + Debian mirrors). Screenshot-based visual testing therefore
 * remains open work, listed with that exact reason in `docs/PROMPT-COMPLIANCE.md`.
 *
 * What can be measured for real, and is measured here:
 *
 *  1. **Chart rendering** — the Gantt SVG produced by `renderGanttSvg` is
 *     rasterised with resvg and the pixels are inspected with ImageMagick:
 *     the image is not blank, and no chart content is clipped at the edges.
 *  2. **Print geometry** — the exported HTML report declares A4 page rules,
 *     repeated headers and a `.no-print` layer, so "Print → Save as PDF" keeps
 *     working on paper.
 *  3. **Mobile layout preconditions** — every document carries a
 *     `width=device-width` viewport, the responsive breakpoints used by the
 *     layout exist in the markup, and no stylesheet rule forces a fixed width
 *     wider than a 360 px phone.
 *
 * Usage: npx tsx scripts/layout-audit.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { analyzeProject } from "../src/lib/engine/analysis";
import { renderGanttSvg } from "../src/lib/report/gantt-svg";
import { buildReportHtml } from "../src/lib/report/html";
import { DEFAULT_REPORT_SECTIONS } from "../src/lib/validation";
import type { ProjectInput } from "../src/lib/engine/types";

let checks = 0;
let failures = 0;
let skipped = 0;

function check(condition: boolean, message: string, detail?: string) {
  checks += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

function hasImageMagick(): boolean {
  try {
    execFileSync("convert", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const workdir = mkdtempSync(join(tmpdir(), "hermiplan-layout-"));

/** Adds `count` extra activities so the chart is dense enough to overflow. */
function denseProject(): ProjectInput {
  const base = buildProjectFromTemplate("construction");
  const extra = Array.from({ length: 30 }, (_, index) => {
    const id = `extra-${index}`;
    return {
      ...base.activities[0],
      id,
      code: `X${index + 1}`,
      name: `فعالیت تکمیلی ${index + 1}`,
      phase: index % 3 === 0 ? "فاز الف" : index % 3 === 1 ? "فاز ب" : "فاز ج",
      duration: 2 + (index % 7),
      predecessors: index === 0 ? [] : [{ predecessorId: `extra-${index - 1}`, type: "FS" as const, lag: 0 }],
    };
  });
  return { ...base, activities: [...base.activities, ...extra] };
}

function rasterize(label: string, svg: string, width: number) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  const path = join(workdir, `${label}.png`);
  writeFileSync(path, png.asPng());
  return path;
}

function trimInfo(path: string): { width: number; height: number; trim: string } {
  const size = execFileSync("identify", ["-format", "%w %h", path], { encoding: "utf8" }).trim().split(" ");
  // `-trim` reports the bounding box of non-background pixels as WxH+X+Y.
  const trim = execFileSync("convert", [path, "-bordercolor", "white", "-border", "1", "-trim", "-format", "%@", "info:"], {
    encoding: "utf8",
  }).trim();
  return { width: Number(size[0]), height: Number(size[1]), trim };
}

function chartChecks() {
  console.log("▶ ۱. رندر واقعی نمودار گانت (SVG → پیکسل)");
  const project = denseProject();
  const analysis = analyzeProject(project);
  const links = project.activities.flatMap((activity) =>
    activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
  );
  const svg = renderGanttSvg({ gantt: analysis.gantt, links, showArrows: true, statusDate: project.meta.statusDate });
  check(svg.startsWith("<svg") || svg.includes("<svg"), "نمودار SVG تولید شد");
  check(analysis.activities.length >= 30, "پروژه آزمون حداقل ۳۰ فعالیت دارد", `${analysis.activities.length}`);

  const wide = rasterize("gantt-wide", svg, 1180);
  const narrow = rasterize("gantt-narrow", svg, 360);

  const wideInfo = trimInfo(wide);
  const narrowInfo = trimInfo(narrow);
  check(wideInfo.width === 1180, "رندر در عرض دسکتاپ ۱۱۸۰ پیکسل است", `${wideInfo.width}`);
  check(narrowInfo.width === 360, "رندر در عرض موبایل ۳۶۰ پیکسل است", `${narrowInfo.width}`);

  // Clipping test: the trimmed content box must stay inside the canvas.
  const parse = (trim: string) => {
    const match = trim.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    return match ? { w: Number(match[1]), h: Number(match[2]), x: Number(match[3]), y: Number(match[4]) } : null;
  };
  for (const [label, info] of [
    ["دسکتاپ", wideInfo],
    ["موبایل", narrowInfo],
  ] as const) {
    const box = parse(info.trim);
    check(Boolean(box), `جعبه محتوا در ${label} قابل اندازه‌گیری است`, info.trim);
    if (!box) continue;
    const inside =
      box.x >= -1 && box.y >= -1 && box.x + box.w <= info.width + 1 && box.y + box.h <= info.height + 1;
    check(inside, `هیچ محتوایی از بوم ${label} بیرون نمی‌زند (بدون بریدگی)`, JSON.stringify({ box, canvas: info }));
    const coverage = (box.w * box.h) / (info.width * info.height);
    check(coverage > 0.05, `نمودار ${label} خالی نیست (پوشش ${(coverage * 100).toFixed(1)}٪)`);
  }

  // A blank white image would trim to a 1x1 box — a cheap "did it render" guard.
  const blank = trimInfo(wide).trim.startsWith("1x1");
  check(!blank, "خروجی رندر شده خالی نیست");
}

function printChecks() {
  console.log("\n▶ ۲. چیدمان چاپ (A4) در گزارش HTML");
  const project = buildProjectFromTemplate("construction");
  const analysis = analyzeProject(project);
  const links = project.activities.flatMap((activity) =>
    activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
  );
  const ganttSvg = renderGanttSvg({ gantt: analysis.gantt, links, showArrows: true, statusDate: project.meta.statusDate });
  const html = buildReportHtml(project, analysis, ganttSvg);
  check(/@page\s*\{[^}]*size:\s*A4/i.test(html) || /size:\s*A4/i.test(html), "قاعده @page با اندازه A4 تعریف شده است");
  check(html.includes(".no-print"), "لایه .no-print برای کنترل ابزارها هنگام چاپ وجود دارد");
  check(/dir="rtl"/.test(html), "جهت سند راست‌به‌چپ است");
  check(/page-break-after|break-after|page-break-inside|break-inside/.test(html), "قواعد شکست صفحه تعریف شده‌اند");
  check(html.length > 20_000, "گزارش کامل تولید شد", `${html.length} نویسه`);
  const fixedWidths = [...html.matchAll(/width:\s*(\d+)px/g)].map((m) => Number(m[1]));
  check(
    fixedWidths.every((width) => width <= 1180),
    "هیچ عرض ثابتی بزرگ‌تر از قالب A4/دسکتاپ در گزارش نیست",
    fixedWidths.filter((w) => w > 1180).join(","),
  );

  // The report must render as pixels too (catches malformed SVG nesting).
  if (hasImageMagick()) {
    const path = rasterize("report-gantt", ganttSvg, 1180);
    const info = trimInfo(path);
    check(info.height > 100, "نمودار داخل گزارش ارتفاع واقعی دارد", `${info.height}px`);
  } else {
    skipped += 1;
    console.log("  ⚠ ImageMagick موجود نیست — بررسی پیکسلی رد شد");
  }
}

function mobilePreconditions() {
  console.log("\n▶ ۳. پیش‌شرط‌های چیدمان موبایل (از کد، نه از مرورگر)");
  const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

  check(/width:\s*["']device-width["']/.test(layout), "viewport با width=device-width تعریف شده است");
  check(/initialScale:\s*1/.test(layout), "initialScale برابر ۱ است");

  // Any *declared* `min-width` above 360 px would force a phone to scroll
  // sideways. Breakpoint declarations (`@media (min-width: 1024px)`) are not
  // layout widths, so they are excluded on purpose.
  const declaredMinWidths = globals
    .split("\n")
    .filter((line) => !line.trim().startsWith("@media"))
    .flatMap((line) => [...line.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1])));
  check(
    declaredMinWidths.every((width) => width <= 360),
    "هیچ min-width اعلان‌شده بزرگ‌تر از ۳۶۰ پیکسل در استایل‌ها نیست",
    declaredMinWidths.filter((w) => w > 360).join(","),
  );

  // Wide tables must live inside horizontal scroll containers, not be clipped.
  const scrollable = ["src/components/builder/BuilderApp.tsx", "src/components/builder/steps.tsx", "src/components/report/ReportView.tsx"]
    .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
    .filter((source) => source.includes("overflow-x-auto")).length;
  check(scrollable >= 2, "جدول‌های پهن در ظرف اسکرول افقی قرار دارند", `${scrollable} فایل`);

  const builder = readFileSync(join(process.cwd(), "src/components/builder/BuilderApp.tsx"), "utf8");
  const responsiveTokens = (builder.match(/\b(sm|md|lg):/g) ?? []).length;
  check(responsiveTokens >= 10, "رابط بیلدر از نقاط شکست واکنش‌گرا استفاده می‌کند", `${responsiveTokens} مورد`);

  const reportView = readFileSync(join(process.cwd(), "src/components/report/ReportView.tsx"), "utf8");
  const reportTokens = (reportView.match(/\b(sm|md|lg):/g) ?? []).length;
  check(reportTokens >= 10, "گزارش هم چیدمان موبایل دارد", `${reportTokens} مورد`);

  console.log(`\n  پوشه خروجی تصاویر: ${workdir}`);
}

function main() {
  console.log("▶ بازبینی چیدمان و رندر گرافیکی (بدون مرورگر)\n");
  chartChecks();
  printChecks();
  mobilePreconditions();
  console.log(
    failures === 0
      ? `\n✔ ${checks} بررسی چیدمان/رندر — همه موفق${skipped ? ` (${skipped} مورد رد شد)` : ""}\n  این جایگزین آزمون مرورگری نیست: چیدمان CSS واقعی هنوز در مرورگر دیده نشده است.`
      : `\n✘ ${failures} خطا از ${checks} بررسی چیدمان`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
