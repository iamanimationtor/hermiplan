/**
 * HERMIPLAN — independent engine verification.
 *
 * Every expectation in this file was computed BY HAND from the standard
 * CPM/PDM and EVM definitions, so a passing run is evidence that the engine
 * matches textbook scheduling mathematics — not merely that it is stable.
 *
 * Run: npx tsx scripts/engine-verification.ts
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import { normalizePricing } from "../src/lib/market/engine";
import type { ActivityInput, ProjectInput } from "../src/lib/engine/types";

let failures = 0;
let checks = 0;
const check = (condition: boolean, message: string, detail?: string) => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
};
const eq = (actual: unknown, expected: unknown, message: string) =>
  check(
    actual === expected,
    message,
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );

function makeProject(
  activities: ActivityInput[],
  overrides: Partial<ProjectInput> = {},
): ProjectInput {
  return {
    meta: {
      name: "تست",
      type: "general",
      currency: "IRR",
      startDate: "2026-01-01",
      statusDate: "2026-01-01",
    },
    calendar: { workDays: [6, 0, 1, 2, 3], holidays: [], hoursPerDay: 8 },
    activities,
    resources: [],
    milestones: [],
    risks: [],
    baseline: null,
    pricing: normalizePricing({ escalationEnabled: false }),
    ...overrides,
  };
}

const act = (
  id: string,
  name: string,
  duration: number,
  predecessors: ActivityInput["predecessors"] = [],
  extra: Partial<ActivityInput> = {},
): ActivityInput => ({
  id,
  code: id.toUpperCase(),
  name,
  phase: "فاز ۱",
  duration,
  predecessors,
  progress: 0,
  resources: [],
  fixedCost: 0,
  materialCost: 0,
  constraintType: "ASAP",
  milestone: false,
  ...extra,
});

const row = (analysis: ReturnType<typeof analyzeProject>, id: string) =>
  analysis.activities.find((a) => a.id === id)!;

/* ================================================================== */
console.log("▶ ۱. مسیر بحرانی، شناوری کل و آزاد (محاسبه دستی)");
{
  // A(3) → B(5) → C(2) ; D(4) موازی پس از A
  // ES/EF: A 0→3, B 3→8, C 8→10, D 3→7  ⇒ پایان پروژه ۱۰ روز
  // شناوری D = 10 − 7 = 3 (کل) و 3 (آزاد)
  const analysis = analyzeProject(
    makeProject([
      act("a", "A", 3),
      act("b", "B", 5, [{ predecessorId: "a", type: "FS", lag: 0 }]),
      act("c", "C", 2, [{ predecessorId: "b", type: "FS", lag: 0 }]),
      act("d", "D", 4, [{ predecessorId: "a", type: "FS", lag: 0 }]),
    ]),
  );

  eq(analysis.schedule.workingDays, 10, "مدت پروژه = ۱۰ روز کاری");
  eq(row(analysis, "a").es, 0, "ES(A) = 0");
  eq(row(analysis, "a").ee, 3, "EF(A) = 3");
  eq(row(analysis, "b").es, 3, "ES(B) = 3");
  eq(row(analysis, "b").ee, 8, "EF(B) = 8");
  eq(row(analysis, "c").es, 8, "ES(C) = 8");
  eq(row(analysis, "c").ee, 10, "EF(C) = 10");
  eq(row(analysis, "d").es, 3, "ES(D) = 3");
  eq(row(analysis, "d").ee, 7, "EF(D) = 7");
  eq(row(analysis, "d").totalFloat, 3, "Total Float(D) = 3");
  eq(row(analysis, "d").freeFloat, 3, "Free Float(D) = 3");
  eq(
    analysis.criticalPath.map((item) => item.id).sort().join(","),
    "a,b,c",
    "مسیر بحرانی = A→B→C",
  );
  check(analysis.criticalPathRatio > 0, "نسبت مسیر بحرانی محاسبه شده است");
}

/* ================================================================== */
console.log("▶ ۲. روابط SS / FF / SF و Lag");
{
  // SS+2:  A(4) از ۰ شروع می‌شود؛ B(6) دو روز پس از شروع A ⇒ ES(B)=2, EF(B)=8
  const ss = analyzeProject(
    makeProject([
      act("a", "A", 4),
      act("b", "B", 6, [{ predecessorId: "a", type: "SS", lag: 2 }]),
    ]),
  );
  eq(row(ss, "b").es, 2, "SS+2 ⇒ ES(B) = 2");
  eq(row(ss, "b").ee, 8, "SS+2 ⇒ EF(B) = 8");
  eq(ss.schedule.workingDays, 8, "SS: پایان پروژه = ۸");

  // FF:   A(6) 0→6 ; B(4) باید هم‌زمان پایان یابد ⇒ ES(B)=2, EF(B)=6
  const ff = analyzeProject(
    makeProject([
      act("a", "A", 6),
      act("b", "B", 4, [{ predecessorId: "a", type: "FF", lag: 0 }]),
    ]),
  );
  eq(row(ff, "b").es, 2, "FF ⇒ ES(B) = 2");
  eq(row(ff, "b").ee, 6, "FF ⇒ EF(B) = 6");

  // SF:   A(4) 0→4 ; B(3) باید پس از شروع A پایان یابد ⇒ ES(B) کلمپ به ۰
  const sf = analyzeProject(
    makeProject([
      act("a", "A", 4),
      act("b", "B", 3, [{ predecessorId: "a", type: "SF", lag: 0 }]),
    ]),
  );
  eq(row(sf, "b").es, 0, "SF ⇒ ES(B) کلمپ به شروع پروژه");
  eq(row(sf, "b").ee, 3, "SF ⇒ EF(B) = 3");
  check(
    sf.activities.every((a) => a.es >= 0),
    "هیچ فعالیتی قبل از شروع پروژه برنامه‌ریزی نمی‌شود",
  );

  // ---------- پاس معکوس روابط SS / SF ----------
  // SS+2:  A(4) 0→4 ، B(6) 2→8 ، پایان پروژه ۸
  //        B: LS=2, LF=8 ⇒ شناوری ۰
  //        A: LF ≤ B.LS − 2 + مدتِ خودِ A = 2−2+4 = 4 ⇒ LS=0 ⇒ شناوری ۰
  eq(row(ss, "a").totalFloat, 0, "SS: شناوری پیش‌نیار بر صفر است (نه مدت جانشین)");
  eq(row(ss, "b").totalFloat, 0, "SS: شناوری جانشین صفر است");
  eq(row(ss, "a").lateFinishDate, row(ss, "a").finishDate, "SS: تاریخ دیرترین پایان پیش‌نیار منطقی است");

  // FF:  A(6) 0→6 ، B(4) 2→6 ⇒ هر دو بحرانی
  eq(row(ff, "a").totalFloat, 0, "FF: شناوری پیش‌نیار صفر است");
  eq(row(ff, "b").totalFloat, 0, "FF: شناوری جانشین صفر است");

  // Lead (Lag منفی): B یک روز قبل از پایان A شروع می‌شود ⇒ ES(B)=2
  const lead = analyzeProject(
    makeProject([
      act("a", "A", 5),
      act("b", "B", 4, [{ predecessorId: "a", type: "FS", lag: -1 }]),
    ]),
  );
  eq(row(lead, "b").es, 4, "FS با Lag=-1 ⇒ ES(B) = 4");
}

/* ================================================================== */
console.log("▶ ۳. تقویم کاری، تعطیلات و تاریخ‌ها");
{
  // 2026-01-01 پنجشنبه است؛ با هفته کاری شنبه تا چهارشنبه، اولین روز کاری = شنبه ۰۳
  const base = analyzeProject(makeProject([act("a", "A", 3)]));
  eq(base.schedule.startDate, "2026-01-03", "شروع پروژه روی اولین روز کاری (شنبه)");
  eq(base.schedule.finishDate, "2026-01-05", "فعالیت ۳ روزه: شنبه، یکشنبه، دوشنبه");

  // با تعطیل شدن دوشنبه، پایان به سه‌شنبه می‌رود
  const holiday = analyzeProject(
    makeProject([act("a", "A", 3)], { calendar: { workDays: [6, 0, 1, 2, 3], holidays: ["2026-01-05"], hoursPerDay: 8 } }),
  );
  eq(holiday.schedule.finishDate, "2026-01-06", "تعطیلی، تاریخ پایان را جابه‌جا می‌کند");
  eq(holiday.schedule.workingDays, 3, "تعطیلی از شمار روزهای کاری کم نمی‌کند");

  // شروع پروژه در روز کاری ⇒ همان روز
  const aligned = analyzeProject(makeProject([act("a", "A", 1)], { meta: { name: "x", type: "general", currency: "IRR", startDate: "2026-01-05", statusDate: "2026-01-05" } }));
  eq(aligned.schedule.startDate, "2026-01-05", "شروع در روز کاری بدون جابه‌جایی");
}

/* ================================================================== */
console.log("▶ ۴. تخصیص منابع، ظرفیت و بیش‌تخصیص");
{
  const project = makeProject(
    [
      act("a", "A", 1, [], { resources: [{ resourceId: "r1", units: 3 }] }),
      act("b", "B", 1, [], { resources: [{ resourceId: "r1", units: 3 }] }),
    ],
    { resources: [{ id: "r1", name: "کارگر", type: "labor", rate: 1_000_000, capacity: 4 }] },
  );
  const analysis = analyzeProject(project);
  const resource = analysis.resources[0];
  eq(resource.peakUnits, 6, "اوج تخصیص = ۶ واحد در روز");
  eq(resource.totalUnits, 6, "مجموع واحد-روز = ۶");
  check(resource.overallocated, "منبع بیش از ظرفیت مجاز (۴) شناسایی شد");
  eq(resource.utilization, 150, "بهره‌وری = ۱۵۰٪");
  eq(resource.cost, 6_000_000, "هزینه منبع = نرخ × واحد-روز");

  // بدون هم‌پوشانی ⇒ بدون بیش‌تخصیص
  const sequential = analyzeProject(
    makeProject(
      [
        act("a", "A", 1, [], { resources: [{ resourceId: "r1", units: 3 }] }),
        act("b", "B", 1, [{ predecessorId: "a", type: "FS", lag: 0 }], { resources: [{ resourceId: "r1", units: 3 }] }),
      ],
      { resources: [{ id: "r1", name: "کارگر", type: "labor", rate: 1_000_000, capacity: 4 }] },
    ),
  );
  check(!sequential.resources[0].overallocated, "فعالیت‌های پشت‌سرهم بیش‌تخصیص ایجاد نمی‌کنند");
  eq(sequential.resources[0].peakUnits, 3, "اوج تخصیص ترتیبی = ۳");
}

/* ================================================================== */
console.log("▶ ۵. مدیریت ارزش کسب‌شده (EVM) با اعداد دستی");
{
  // یک فعالیت ۱۰ روزه با بودجه ۱۰۰۰؛ تاریخ وضعیت = روز پنجم؛ پیشرفت ۴۰٪
  // PV = 500 · EV = 400 · AC = 400 (بدون هزینه واقعی) · SPI = 0.8 · CPI = 1
  const analysis = analyzeProject(
    makeProject(
      [act("a", "A", 10, [], { fixedCost: 1000, progress: 40 })],
      {
        meta: {
          name: "evm",
          type: "general",
          currency: "IRR",
          startDate: "2026-01-03",
          statusDate: "2026-01-09", // پنجمین روز کاری
        },
      },
    ),
  );
  const a = row(analysis, "a");
  eq(a.plannedProgress, 50, "پیشرفت برنامه‌ای در روز ۵ از ۱۰ = ۵۰٪");
  eq(analysis.costs.budget, 1000, "BAC = ۱۰۰۰");
  eq(analysis.costs.plannedToDate, 500, "PV = ۵۰۰");
  eq(analysis.costs.earned, 400, "EV = ۴۰۰");
  eq(analysis.costs.actual, 400, "AC = ۴۰۰ (پیش‌فرض برابر ارزش کسب‌شده)");
  eq(analysis.progress.schedulePerformanceIndex, 0.8, "SPI = ۰٫۸ (عقب‌ماندگی)");
  eq(analysis.progress.costPerformanceIndex, 1, "CPI = ۱");
  eq(analysis.costs.estimateAtCompletion, 1000, "EAC = BAC / CPI = ۱۰۰۰");
  eq(analysis.progress.overall, 40, "پیشرفت فیزیکی = ۴۰٪");
  eq(analysis.progress.scheduleVariance, -100, "SV = EV − PV = −۱۰۰");

  // با هزینه واقعی بیشتر: AC = 500 ⇒ CPI = 0.8 ⇒ EAC = 1250
  const over = analyzeProject(
    makeProject(
      [act("a", "A", 10, [], { fixedCost: 1000, progress: 40, actualCost: 500 })],
      {
        meta: {
          name: "evm2",
          type: "general",
          currency: "IRR",
          startDate: "2026-01-03",
          statusDate: "2026-01-09",
        },
      },
    ),
  );
  eq(over.progress.costPerformanceIndex, 0.8, "CPI با AC=۵۰۰ برابر ۰٫۸");
  eq(over.costs.estimateAtCompletion, 1250, "EAC = ۱۰۰۰ / ۰٫۸ = ۱۲۵۰");
  eq(over.costs.varianceAtCompletion, -250, "VAC = ۱۰۰۰ − ۱۲۵۰ = −۲۵۰");
}

/* ================================================================== */
console.log("▶ ۶. تعدیل قیمت بر پایه کارکرد ماهانه");
{
  // پروژه‌ای که کامل در ماهِ تاریخ وضعیت اجرا می‌شود ⇒ تعدیل صفر
  const withinMonth = analyzeProject(
    makeProject([act("a", "A", 5)], {
      meta: { name: "m", type: "general", currency: "IRR", startDate: "2026-03-21", statusDate: "2026-03-21" },
      pricing: normalizePricing({ escalationEnabled: true, escalationRatePerMonth: 10 }),
    }),
  );
  eq(withinMonth.pricing.escalation.total, 0, "پروژه داخل ماهِ وضعیت ⇒ تعدیل صفر");
  eq(withinMonth.pricing.breakdown.escalation, 0, "بدون مبلغ تعدیل در برآورد");

  // همان پروژه با مدت ۳۰ روز کاری ⇒ ماه بعد ضریب ۱٫۱ می‌گیرد
  const spanning = analyzeProject(
    makeProject([act("a", "A", 30, [], { fixedCost: 30_000_000 })], {
      meta: { name: "m2", type: "general", currency: "IRR", startDate: "2026-03-21", statusDate: "2026-03-21" },
      pricing: normalizePricing({ escalationEnabled: true, escalationRatePerMonth: 10 }),
    }),
  );
  const months = spanning.pricing.escalation.months;
  check(months.length >= 2, "پروژه ۳۰ روزه دست‌کم دو ماه تقویمی را در بر می‌گیرد");
  eq(months[0].factor, 1, "ماهِ تاریخ وضعیت ضریب ۱ دارد");
  check(
    months.slice(1).every((m) => m.factor > 1),
    "ماه‌های بعدی ضریب بیش از ۱ دارند",
  );
  const manualTotal = months.reduce((sum, m) => sum + m.escalation, 0);
  check(
    Math.abs(manualTotal - spanning.pricing.escalation.total) < 2,
    "جمع ردیف‌های تعدیل با مجموع گزارش‌شده برابر است",
  );
  check(spanning.pricing.breakdown.escalation > 0, "مبلغ تعدیل در برآورد نهایی اعمال شده است");
}

/* ================================================================== */
console.log("▶ ۷. ساختار برآورد هزینه");
{
  const analysis = analyzeProject(
    makeProject([act("a", "A", 5, [], { fixedCost: 1_000_000 })], {
      pricing: normalizePricing({ overheadPercent: 20, profitPercent: 10, contingencyPercent: 5, escalationEnabled: false }),
    }),
  );
  // مستقیم ۱٬۰۰۰٬۰۰۰ · بالاسری ۲۰۰٬۰۰۰ · سود ۱۲۰٬۰۰۰ · احتیاط ۵۰٬۰۰۰ ⇒ جمع ۱٬۳۷۰٬۰۰۰
  eq(analysis.pricing.breakdown.direct, 1_000_000, "هزینه مستقیم");
  eq(analysis.pricing.breakdown.overhead, 200_000, "بالاسری ۲۰٪");
  eq(analysis.pricing.breakdown.profit, 120_000, "سود ۱۰٪ روی (مستقیم+بالاسری)");
  eq(analysis.pricing.breakdown.contingency, 50_000, "احتیاط ۵٪");
  eq(analysis.pricing.breakdown.total, 1_370_000, "جمع برآورد");
}

/* ================================================================== */
console.log("▶ ۸. تاریخ هدف پایان و شناوری منفی");
{
  // زنجیره ۱۰ روزه (A→B) با تاریخ هدفی که فقط ۶ روز کاری فضا می‌دهد.
  // شروع: شنبه ۲۰۲۶-۰۱-۰۳ ⇒ روزهای کاری ۰..۹ ؛ هدف = پایان روز ۵ ⇒ انحراف −۵
  const analysis = analyzeProject(
    makeProject(
      [act("a", "A", 6), act("b", "B", 4, [{ predecessorId: "a", type: "FS", lag: 0 }])],
      {
        meta: {
          name: "deadline",
          type: "general",
          currency: "IRR",
          startDate: "2026-01-03",
          statusDate: "2026-01-03",
          deadline: "2026-01-10", // روز کاری ششم ⇒ افست ۵
        },
      },
    ),
  );
  const b = row(analysis, "b");
  eq(analysis.schedule.workingDays, 10, "زنجیره A→B = ۱۰ روز کاری");
  eq(analysis.schedule.deadlineVarianceDays, -5, "انحراف از تاریخ هدف = −۵ روز کاری");
  eq(analysis.schedule.deadlineMet, false, "هدف پایان محقق نمی‌شود");
  check(b.totalFloat < 0, "شناوری منفی روی مسیر بحرانی", `float=${b.totalFloat}`);
  eq(b.totalFloat, -5, "شناوری کل(B) = −۵ (پشت برنامه)");
  check(
    analysis.activities.every((a) => a.es >= 0 && a.ee >= 0),
    "شناوری منفی تاریخ‌ها را نامعتبر نمی‌کند",
  );
  check(
    analysis.warnings.some((w) => w.includes("تاریخ هدف پایان")),
    "هشدار عدم تحقق تاریخ هدف تولید می‌شود",
  );

  // همان پروژه با هدفی که محقق می‌شود ⇒ شناوری مثبت و بدون هشدار
  const feasible = analyzeProject(
    makeProject(
      [act("a", "A", 6), act("b", "B", 4, [{ predecessorId: "a", type: "FS", lag: 0 }])],
      {
        meta: {
          name: "deadline2",
          type: "general",
          currency: "IRR",
          startDate: "2026-01-03",
          statusDate: "2026-01-03",
          deadline: "2026-02-01",
        },
      },
    ),
  );
  eq(feasible.schedule.deadlineMet, true, "هدف دوردست محقق می‌شود");
  check(row(feasible, "b").totalFloat >= 0, "بدون تاریخ هدف تنگ، شناوری منفی نیست");
  check(
    !feasible.warnings.some((w) => w.includes("تاریخ هدف پایان")),
    "برای هدف قابل تحقق هشداری تولید نمی‌شود",
  );
}

/* ================================================================== */
console.log("▶ ۹. انحراف زمان‌بندی نسبت به Baseline (تعریف صحیح)");
{
  const analysis = analyzeProject(
    makeProject([act("a", "A", 8)], {
      baseline: {
        name: "مبنا",
        createdAt: "2026-01-01T00:00:00.000Z",
        activities: [{ activityId: "a", startDate: "2026-01-03", finishDate: "2026-01-10", duration: 4, cost: 100 }],
      },
    }),
  );
  const changed = analysis.baseline.changedActivities[0];
  check(Boolean(changed), "تفاوت با مبنا شناسایی شد");
  // شروع شنبه ۰۳ ژانویه، ۸ روز کاری ⇒ پایان: ۰۳،۰۴،۰۵،۰۶،۰۷،۱۰،۱۱،۱۲ ⇒ ۲۰۲۶-۰۱-۱۲
  // مبنا: ۲۰۲۶-۰۱-۱۰ ⇒ انحراف = ۲ روز
  eq(changed.currentFinish, "2026-01-12", "پایان فعلی با ۸ روز کاری از شنبه ۰۳");
  eq(changed.varianceDays, 2, "انحراف = اختلاف تاریخ پایان (۲ روز)");
  eq(analysis.baseline.scheduleVarianceDays, 2, "حداکثر انحراف زمان‌بندی = ۲ روز");
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/* ================================================================== */
console.log("▶ ۱۰. کارایی روی پروژه بزرگ");
{
  const activities: ActivityInput[] = [];
  for (let i = 0; i < 500; i += 1) {
    activities.push(
      act(`a${i}`, `فعالیت ${i}`, 5, i > 0 ? [{ predecessorId: `a${i - 1}`, type: "FS", lag: 0 }] : [], {
        resources: [{ resourceId: "r1", units: 2 }],
      }),
    );
  }
  const started = Date.now();
  const analysis = analyzeProject(
    makeProject(activities, { resources: [{ id: "r1", name: "کارگر", type: "labor", rate: 1_000_000, capacity: 50 }] }),
  );
  const elapsed = Date.now() - started;
  eq(analysis.schedule.workingDays, 2500, "۵۰۰ فعالیت پشت‌سرهم ⇒ ۲۵۰۰ روز کاری");
  eq(analysis.criticalPath.length, 500, "زنجیره کامل بحرانی است");
  check(elapsed < 4000, `تحلیل ۵۰۰ فعالیتی زیر ۴ ثانیه انجام شد (${elapsed}ms)`);
  console.log(`    زمان تحلیل: ${elapsed}ms برای ۵۰۰ فعالیت`);
}

console.log(
  failures === 0
    ? `\n✔ ${checks} بررسی مستقل موتور — همه با محاسبه دستی تأیید شد`
    : `\n✘ ${failures} خطا از ${checks} بررسی`,
);
process.exit(failures === 0 ? 0 : 1);
