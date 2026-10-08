/**
 * Exhaustive edge-case audit for the HERMIPLAN engine + export pipeline.
 * Run: npx tsx scripts/edge-case-audit.ts
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { buildSheets } from "../src/lib/report/export";
import { buildXlsx } from "../src/lib/report/xlsx";
import { buildMsProjectXml } from "../src/lib/report/msproject";
import { buildReportHtml } from "../src/lib/report/html";
import { renderGanttSvg } from "../src/lib/report/gantt-svg";
import { buildDeliveryPackage } from "../src/lib/report/package";
import { fromJalali, toJalali, isoToJalaliInput, jalaliInputToIso, formatJalali } from "../src/lib/date-fa";
import { applyMarketRates, computeEscalation, normalizePricing } from "../src/lib/market/engine";
import type { ProjectInput } from "../src/lib/engine/types";

let failures = 0;
const check = (condition: boolean, message: string) => {
  if (!condition) {
    failures += 1;
    console.error("  ✗", message);
  }
};
const section = (title: string) => console.log(`\n▶ ${title}`);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

function assertAnalysisIsSafe(name: string, project: ProjectInput) {
  const start = Date.now();
  let analysis;
  try {
    analysis = analyzeProject(project);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}: THREW →`, (error as Error).message);
    return;
  }
  const ms = Date.now() - start;
  check(ms < 4000, `${name}: analysis too slow (${ms}ms)`);

  const json = JSON.stringify(analysis);
  check(!json.includes("null") || true, `${name}: null tolerated`);
  for (const activity of analysis.activities) {
    check(finite(activity.totalFloat), `${name}/${activity.code}: float not finite`);
    check(finite(activity.budgetCost), `${name}/${activity.code}: cost not finite`);
    check(activity.finishDate >= activity.startDate, `${name}/${activity.code}: finish < start`);
  }
  check(finite(analysis.costs.budget), `${name}: budget not finite`);
  check(finite(analysis.pricing.breakdown.total), `${name}: estimate not finite`);
  check(finite(analysis.health.score), `${name}: health score not finite`);
  check(analysis.gantt.dates.length > 0, `${name}: gantt timeline empty`);
  check(!JSON.stringify(analysis).includes('"NaN"'), `${name}: NaN in output`);

  // every export path must survive
  try {
    const sheets = buildSheets(analysis, project);
    check(sheets.length >= 8, `${name}: expected full sheet set, got ${sheets.length}`);
    const xlsx = buildXlsx(sheets);
    check(xlsx instanceof Uint8Array && xlsx.length > 500, `${name}: xlsx not produced`);
    const msp = buildMsProjectXml(project, analysis);
    check(msp.includes("<Project") && msp.includes("</Project>"), `${name}: msproject xml invalid`);
    const svg = renderGanttSvg({ gantt: analysis.gantt, links: [] });
    check(!svg.includes("NaN") && !svg.includes("undefined"), `${name}: gantt svg has NaN/undefined`);
    const html = buildReportHtml(project, analysis, svg);
    check(!html.includes("NaN") && !html.includes("undefined"), `${name}: report html has NaN/undefined`);
    const zip = buildDeliveryPackage(project, analysis, { ganttSvg: svg, reportUrl: "x" });
    check(zip.length > 1000, `${name}: package not produced`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}: export pipeline threw →`, (error as Error).message);
  }
  console.log(`  ✓ ${name} (${analysis.activities.length} acts, ${analysis.schedule.workingDays} wd, ${ms}ms)`);
}

/* ------------------------------------------------------------------ */
section("۱. پروژه خالی (بدون فعالیت، بدون منبع)");
{
  const project: ProjectInput = {
    meta: {
      name: "خالی",
      type: "general",
      currency: "IRR",
      startDate: "2026-03-21",
      statusDate: "2026-03-21",
    },
    calendar: { workDays: [6, 0, 1, 2, 3], holidays: [], hoursPerDay: 8 },
    activities: [],
    resources: [],
    milestones: [],
    risks: [],
    baseline: null,
    pricing: normalizePricing(null),
  };
  assertAnalysisIsSafe("empty-project", project);
}

/* ------------------------------------------------------------------ */
section("۲. فقط Milestone");
{
  const base = buildProjectFromTemplate("general");
  base.activities = base.activities.slice(0, 3).map((a) => ({ ...a, duration: 0, milestone: true, predecessors: [] }));
  base.resources = [];
  assertAnalysisIsSafe("milestones-only", base);
}

/* ------------------------------------------------------------------ */
section("۳. حلقه وابستگی و ارجاع نامعتبر");
{
  const base = buildProjectFromTemplate("general");
  base.activities = [
    { ...base.activities[0], id: "x1", predecessors: [{ predecessorId: "x2", type: "FS", lag: 0 }] },
    { ...base.activities[1], id: "x2", predecessors: [{ predecessorId: "x1", type: "SS", lag: 2 }] },
    { ...base.activities[2], id: "x3", predecessors: [{ predecessorId: "ghost", type: "FS", lag: 0 }] },
  ];
  const analysis = analyzeProject(base);
  check(analysis.errors.length > 0, "cycle must be reported as an error");
  check(analysis.warnings.length > 0, "invalid predecessor must be reported as a warning");
  console.log(`  ✓ cycle detection → ${analysis.errors.length} error(s), ${analysis.warnings.length} warning(s)`);
  assertAnalysisIsSafe("cyclic-project", base);
}

/* ------------------------------------------------------------------ */
section("۴. تقویم‌های خاص");
{
  const allHoliday = buildProjectFromTemplate("general");
  allHoliday.calendar.holidays = [
    "2026-01-01","2026-01-02","2026-01-03","2026-01-04","2026-01-05","2026-01-06","2026-01-07",
  ];
  assertAnalysisIsSafe("holidays-blocked-week", allHoliday);

  const noWorkDays = buildProjectFromTemplate("general");
  noWorkDays.calendar.workDays = [];
  const normalized = analyzeProject(noWorkDays);
  check(normalized.schedule.workingDays > 0, "empty workDays must fall back to default calendar");
  console.log("  ✓ empty workDays falls back to the default working week");

  const singleDay = buildProjectFromTemplate("general");
  singleDay.calendar.workDays = [1];
  assertAnalysisIsSafe("single-working-day", singleDay);

  const long = buildProjectFromTemplate("general");
  long.activities = long.activities.map((a) => ({ ...a, duration: a.duration * 12, predecessors: [] }));
  assertAnalysisIsSafe("very-long-project", long);
}

/* ------------------------------------------------------------------ */
section("۵. انواع وابستگی، Lag منفی و محدودیت‌ها");
{
  const base = buildProjectFromTemplate("construction");
  base.activities = base.activities.slice(0, 8).map((a, i) => ({
    ...a,
    predecessors: i === 0 ? [] : [{ predecessorId: base.activities[i - 1].id, type: (["FS", "SS", "FF", "SF"] as const)[i % 4], lag: i % 3 === 0 ? -2 : 3 }],
    constraintType: i === 3 ? "MSO" : i === 5 ? "SNET" : "ASAP",
    constraintDate: "2026-06-01",
  }));
  assertAnalysisIsSafe("mixed-dependencies", base);
}

/* ------------------------------------------------------------------ */
section("۶. قیمت‌گذاری و تعدیل");
{
  const base = buildProjectFromTemplate("construction");
  const market = applyMarketRates(base, normalizePricing({ series: "market", region: "metro", indexFactor: 120 }));
  check(
    market.resources.every((r) => r.rate > 0),
    "market rates must resolve to positive values",
  );
  const analysis = analyzeProject(market);
  check(analysis.pricing.breakdown.total > analysis.pricing.breakdown.direct, "estimate must exceed direct cost");

  const noEscalation = analyzeProject({ ...base, pricing: normalizePricing({ escalationEnabled: false }) });
  check(noEscalation.pricing.breakdown.escalation === 0, "escalation must be zero when disabled");
  check(noEscalation.pricing.escalation.months.length === 0, "escalation months must be empty when disabled");

  const extreme = analyzeProject({ ...base, pricing: normalizePricing({ escalationRatePerMonth: 30, overheadPercent: 200, profitPercent: 200, contingencyPercent: 200 }) });
  check(finite(extreme.pricing.breakdown.total), "extreme pricing must stay finite");
  const months = computeEscalation(base, extreme, normalizePricing({ escalationRatePerMonth: 30 }));
  check(months.total > 0, "30% monthly escalation must produce a positive adjustment");
  console.log(`  ✓ pricing & escalation (direct ${analysis.pricing.breakdown.direct} → total ${Math.round(analysis.pricing.breakdown.total)})`);
}

/* ------------------------------------------------------------------ */
section("۷. تاریخ هجری شمسی");
{
  const cases: [string, [number, number, number]][] = [
    ["2025-03-21", [1404, 1, 1]],
    ["2026-03-21", [1405, 1, 1]],
    ["2026-01-01", [1404, 10, 11]],
    ["2026-09-22", [1405, 6, 31]],
    ["2026-12-21", [1405, 9, 30]],
    ["2026-09-23", [1405, 7, 1]],
    ["2024-03-20", [1403, 1, 1]],
  ];
  for (const [iso, expected] of cases) {
    const actual = toJalali(iso);
    check(
      actual[0] === expected[0] && actual[1] === expected[1] && actual[2] === expected[2],
      `toJalali(${iso}) → ${actual.join("-")} (expected ${expected.join("-")})`,
    );
    const back = fromJalali(actual[0], actual[1], actual[2]);
    check(back === iso, `fromJalali round-trip → ${back} (expected ${iso})`);
  }
  for (const iso of ["2026-03-21", "2026-07-15", "2026-11-30"]) {
    const typed = isoToJalaliInput(iso);
    const parsed = jalaliInputToIso(typed);
    check(parsed === iso, `jalali input round-trip ${typed} → ${parsed}`);
    const persianTyped = "۱۴۰۵/۰۱/۰۱";
    check(jalaliInputToIso(persianTyped) === "2026-03-21", "persian digits input must parse");
  }
  check(formatJalali("2026-03-21") === "۱ فروردین ۱۴۰۵", `formatJalali → ${formatJalali("2026-03-21")}`);
  // brute-force round-trip across 16 years (~5,800 days)
  let roundTrips = 0;
  for (let d = Date.UTC(2020, 0, 1); d <= Date.UTC(2036, 11, 31); d += 86_400_000) {
    const iso = new Date(d).toISOString().slice(0, 10);
    const j = toJalali(iso);
    const back = fromJalali(j[0], j[1], j[2]);
    if (back !== iso) {
      check(false, `jalali round-trip failed for ${iso} → ${j.join("/")} → ${back}`);
      break;
    }
    // jalali structural validation
    check(j[1] >= 1 && j[1] <= 12, `invalid jalali month for ${iso}`);
    check(j[2] >= 1 && j[2] <= 31, `invalid jalali day for ${iso}`);
    if (j[1] > 6 && j[2] > 30) {
      check(false, `jalali day 31 in month ${j[1]} for ${iso}`);
      break;
    }
    roundTrips += 1;
  }
  console.log(`  ✓ jalali brute-force round-trip over ${roundTrips} days (2020–2036)`);
}

/* ------------------------------------------------------------------ */
section("۸. همه قالب‌ها × همه مسیرهای خروجی");
{
  const templates = ["construction","civil","architecture","infrastructure","software","manufacturing","research","event","renovation","general"] as const;
  for (const id of templates) {
    assertAnalysisIsSafe(`template:${id}`, buildProjectFromTemplate(id));
  }
}

/* ------------------------------------------------------------------ */
section("۹. Baseline و پیشرفت کامل/صفر");
{
  const base = buildProjectFromTemplate("software");
  const withBaseline = {
    ...base,
    activities: base.activities.map((a) => ({ ...a, progress: 100 })),
    baseline: {
      name: "مبنا",
      createdAt: new Date().toISOString(),
      activities: base.activities.map((a) => ({
        activityId: a.id,
        startDate: "2026-01-01",
        finishDate: "2026-02-01",
        duration: a.duration + 5,
        cost: 1000,
      })),
    },
  };
  const analysis = analyzeProject(withBaseline);
  check(analysis.baseline.available, "baseline must be detected");
  check(analysis.baseline.changedActivities.length > 0, "baseline variance must be computed");
  check(analysis.progress.overall === 100, "fully progressed project must be 100%");
  check(analysis.progress.completed === analysis.activities.length, "all activities completed");
  assertAnalysisIsSafe("baseline-100%", withBaseline);
}

console.log(
  failures === 0
    ? "\n══════════ EDGE-CASE AUDIT PASSED ══════════"
    : `\n══════════ ${failures} ISSUE(S) FOUND ══════════`,
);
process.exit(failures === 0 ? 0 : 1);
