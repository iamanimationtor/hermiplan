/**
 * HERMIPLAN — constraint, milestone, baseline, progress and pricing regressions.
 *
 * Every expectation below was computed by hand from the definitions in
 * docs/ENGINE.md (CPM with PDM relations, working-day arithmetic on the
 * Sat–Wed calendar, EVM formulas, quantity-based progress). Nothing here is
 * derived from the implementation it tests.
 *
 * Run: npm run test:engine:regressions
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import { computeSchedule } from "../src/lib/engine/schedule";
import { normalizePricing } from "../src/lib/market/engine";
import { constraintOffset } from "../src/lib/engine/schedule";
import { ensureViableCalendar } from "../src/lib/engine/calendar";
import { buildReportHtml } from "../src/lib/report/html";
import { roundMoney, sumMoney, percentOfMoney, moneyEquals } from "../src/lib/engine/money";
import { computeCostBreakdown } from "../src/lib/market/engine";
import type { ActivityInput, MilestoneInput, ProjectInput } from "../src/lib/engine/types";

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

const near = (actual: number | null | undefined, expected: number, tolerance: number, message: string) =>
  check(
    typeof actual === "number" && Math.abs(actual - expected) <= tolerance,
    message,
    `got ${actual}, expected ${expected} ±${tolerance}`,
  );

/**
 * Calendar used by every scenario:
 *   working week Sat–Wed; 2026-01-03 is a Saturday, so working-day offsets are
 *   0=01-03 Thu? no → Sat 03, 1=Sun 04, 2=Mon 05, 3=Tue 06, 4=Wed 07,
 *   5=Sat 10, 6=Sun 11, 7=Mon 12, 8=Tue 13, 9=Wed 14, 10=Sat 17.
 */
const CALENDAR = { workDays: [6, 0, 1, 2, 3], holidays: [] as string[], hoursPerDay: 8 };
const START = "2026-01-03"; // Saturday, offset 0
const day = (offset: number): string => {
  const axis = ["2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-17"];
  return axis[offset];
};

function act(
  id: string,
  duration: number,
  predecessors: ActivityInput["predecessors"] = [],
  extra: Partial<ActivityInput> = {},
): ActivityInput {
  return {
    id,
    code: id.toUpperCase(),
    name: `فعالیت ${id}`,
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
  };
}

function project(
  activities: ActivityInput[],
  overrides: Partial<ProjectInput> = {},
): ProjectInput {
  return {
    meta: {
      name: "تست",
      type: "general",
      currency: "IRR",
      startDate: START,
      statusDate: START,
    },
    calendar: { ...CALENDAR },
    activities,
    resources: [],
    milestones: [],
    risks: [],
    baseline: null,
    pricing: normalizePricing({ escalationEnabled: false }),
    ...overrides,
  };
}

const rowFor = (analysis: ReturnType<typeof analyzeProject>, id: string) => {
  const row = analysis.activities.find((a) => a.id === id);
  if (!row) throw new Error(`activity ${id} missing from analysis`);
  return row;
};

/* ================================================================== */
console.log("▶ ۱. محدودیت FNLT (پایان نه دیرتر از)");
{
  // A: 3 روز کاری → پایان در آفست ۳ (2026-01-06). محدودیت 2026-01-07 (آفست ۴).
  const ok = analyzeProject(
    project([act("a", 3, [], { constraintType: "FNLT", constraintDate: day(4) })]),
  );
  const a = rowFor(ok, "a");
  eq(a.finishDate, day(2), "FNLT برقرار: فعالیت ۳ روزه در روز سوم تمام می‌شود");
  eq(a.constraint.type, "FNLT", "نوع محدودیت در خروجی قابل مشاهده است");
  eq(a.constraint.date, day(4), "تاریخ محدودیت در خروجی حفظ می‌شود");
  check(!ok.diagnostics.some((d) => d.code === "fnlt-violated"), "هیچ نقضی برای محدودیت برقرار گزارش نمی‌شود");
  eq(a.totalFloat, 0, "شناوری فعالیت با محدودیت پایان = 0");

  // همان فعالیت با محدودیت 2026-01-05 (آفست ۲ ⇒ سقف پایان = ۳)
  // فعالیت ۵ روزه تا آفست ۵ (2026-01-10) ادامه دارد ⇒ ۲ روز کاری نقض
  const violated = analyzeProject(
    project([act("b", 5, [], { constraintType: "FNLT", constraintDate: day(2) })]),
  );
  const b = rowFor(violated, "b");
  const violation = violated.diagnostics.find((d) => d.code === "fnlt-violated");
  check(Boolean(violation), "نقض FNLT به‌صورت تشخیص ساختاری گزارش می‌شود", JSON.stringify(violated.diagnostics));
  eq(violation?.severity, "error", "شدت نقض FNLT خطاست");
  eq(violation?.kind, "constraint", "نوع تشخیص، محدودیت است");
  eq(b.totalFloat, -2, "شناوری منفی = ۲ روز کاری (۵ روز کار در برابر سقف ۳)");
  eq(violated.status, "inconsistent", "وضعیت تحلیل: زمان‌بندی ناسازگار (نه invalid)");
  check(
    (violation?.message ?? "").includes("2026-01-05"),
    "پیام نقض، تاریخ مجاز را نشان می‌دهد",
    violation?.message,
  );

  // زنجیره: A(2) → B(3) با FNLT روی B در آفست ۲ ⇒ پایان B در آفست ۵ ⇒ نقض ۲ روزه
  const chain = analyzeProject(
    project([
      act("p", 2),
      act("s", 3, [{ predecessorId: "p", type: "FS", lag: 0 }], {
        constraintType: "FNLT",
        constraintDate: day(2),
      }),
    ]),
  );
  eq(rowFor(chain, "s").es, 2, "زنجیره: شروع جانشین پس از پایان پیش‌نیاز");
  eq(rowFor(chain, "s").ee, 5, "زنجیره: پایان محاسبه‌شده در آفست ۵");
  check(chain.diagnostics.some((d) => d.code === "fnlt-violated"), "زنجیره: نقض FNLT گزارش می‌شود");
  check(rowFor(chain, "s").totalFloat < 0, "زنجیره: شناوری منفی روی فعالیت محدودشده");
}

/* ================================================================== */
console.log("▶ ۲. محدودیت MSO (باید در تاریخ مشخص شروع شود)");
{
  // سازگار: MSO در آفست ۲ بدون پیش‌نیاز ⇒ ES = 2, EF = 4
  const ok = analyzeProject(project([act("a", 2, [], { constraintType: "MSO", constraintDate: day(2) })]));
  const a = rowFor(ok, "a");
  eq(a.es, 2, "MSO سازگار: ES دقیقاً روی تاریخ اجباری");
  eq(a.ee, 4, "MSO سازگار: EF = ES + مدت");
  eq(a.startDate, day(2), "MSO سازگار: تاریخ شروع محاسبه‌شده = تاریخ اجباری");
  eq(a.totalFloat, 0, "MSO: فعالیت شناوری ندارد (LS پین می‌شود)");
  eq(ok.status, "valid", "MSO سازگار: تحلیل معتبر است");

  // ناسازگار: پیش‌نیاز ۵ روزه، جانشین MSO در آفست ۱ ⇒ تعارض منطقی
  const conflict = analyzeProject(
    project([
      act("p", 5),
      act("s", 2, [{ predecessorId: "p", type: "FS", lag: 0 }], {
        constraintType: "MSO",
        constraintDate: day(1),
      }),
    ]),
  );
  const s = rowFor(conflict, "s");
  const message = conflict.diagnostics.find((d) => d.code === "mso-conflicts-with-logic");
  check(Boolean(message), "MSO ناسازگار: تعارض با وابستگی گزارش می‌شود", JSON.stringify(conflict.diagnostics));
  eq(message?.severity, "error", "MSO ناسازگار: شدت خطا");
  eq(conflict.status, "inconsistent", "MSO ناسازگار: وضعیت تحلیل ناسازگار است");
  eq(s.constraint.applied, false, "MSO ناسازگار: محدودیت به‌عنوان اعمال‌شده علامت نمی‌خورد");
  check(Boolean(s.constraint.conflict), "MSO ناسازگار: علت تعارض در ردیف فعالیت قابل مشاهده است");
  eq(s.es, 5, "MSO ناسازگار: شبکه معتبر می‌ماند (شروع تابع پیش‌نیاز)");
  check(s.startDate >= rowFor(conflict, "p").finishDate, "MSO ناسازگار: شروع پیش از پایان پیش‌نیاز نیست");

  // MSO روی روز غیرکاری: 2026-01-08 (پنجشنبه) ⇒ اولین روز کاری بعد = 2026-01-10 (آفست ۵)
  const holiday = analyzeProject(
    project([act("a", 1, [], { constraintType: "MSO", constraintDate: "2026-01-08" })]),
  );
  const mapped = constraintOffset(
    ensureViableCalendar(CALENDAR),
    START,
    "2026-01-08",
    "start",
  );
  eq(mapped.alignedDate, "2026-01-10", "نگاشت تاریخ محدودیت روی روز غیرکاری به روز کاری بعد");
  eq(rowFor(holiday, "a").es, 5, "MSO روی تعطیلی: ES روی اولین روز کاری");
  check(
    holiday.diagnostics.some((d) => d.code === "constraint-non-working-day"),
    "MSO روی تعطیلی: هشدار جابه‌جایی تاریخ صادر می‌شود",
  );

  // MSO پیش از شروع پروژه ⇒ اولین روز کاری + خطا
  const before = analyzeProject(
    project([act("a", 1, [], { constraintType: "MSO", constraintDate: "2025-12-01" })]),
  );
  eq(rowFor(before, "a").es, 0, "MSO پیش از شروع پروژه: فعالیت روی اولین روز کاری");
  check(
    before.diagnostics.some((d) => d.code === "mso-before-project-start"),
    "MSO پیش از شروع پروژه: خطای صریح گزارش می‌شود",
  );

  // MSO با رابطه SS: پیش‌نیاز SS+0 و تاریخ اجباری در آفست ۳ (بعد از شروع) ⇒ سازگار
  const withSs = analyzeProject(
    project([
      act("p", 4),
      act("s", 2, [{ predecessorId: "p", type: "SS", lag: 0 }], {
        constraintType: "MSO",
        constraintDate: day(3),
      }),
    ]),
  );
  eq(rowFor(withSs, "s").es, 3, "MSO با SS: تاریخ اجباری دیرتر از رابطه اعمال می‌شود");
  eq(withSs.status, "valid", "MSO با SS: تحلیل معتبر است");

  // FNLT/MSo بدون تاریخ ⇒ هشدار
  const noDate = analyzeProject(project([act("a", 1, [], { constraintType: "MSO" })]));
  check(
    noDate.diagnostics.some((d) => d.code === "constraint-without-date"),
    "محدودیت بدون تاریخ: هشدار صریح",
  );
}

/* ================================================================== */
console.log("▶ ۳. نقاط عطف (Milestones)");
{
  const milestones: MilestoneInput[] = [
    { id: "m1", name: "نقطه عطف آینده", date: "2030-01-01" },
    { id: "m2", name: "نقطه عطف گذشته", date: "2025-01-01" },
    { id: "m3", name: "بدون تاریخ و بدون فعالیت" },
    { id: "m4", name: "متصل به فعالیت", activityId: "a" },
  ];
  const analysis = analyzeProject(
    project([act("a", 3, [], { progress: 100 })], {
      milestones,
      meta: { name: "m", type: "general", currency: "IRR", startDate: START, statusDate: day(6) },
    }),
  );
  const byId = new Map(analysis.milestones.map((m) => [m.id, m]));
  eq(byId.get("m1")?.status, "upcoming", "نقطه عطف مستقل با تاریخ آینده: upcoming (نه reached)");
  eq(byId.get("m1")?.date, "2030-01-01", "تاریخ نقطه عطف مستقل همان تاریخ کاربر است");
  eq(byId.get("m2")?.status, "reached", "نقطه عطف مستقل با تاریخ گذشته: reached");
  eq(byId.get("m3")?.status, "unscheduled", "نقطه عطف بدون تاریخ: unscheduled (تاریخ ساختگی ندارد)");
  eq(byId.get("m3")?.date, "", "نقطه عطف بدون تاریخ: تاریخ خالی است");
  check(
    analysis.diagnostics.some((d) => d.code === "milestone-without-date"),
    "نقطه عطف بدون تاریخ: هشدار صریح",
  );
  eq(byId.get("m4")?.status, "reached", "نقطه عطف متصل به فعالیت تکمیل‌شده: reached");

  // نقطه عطف متصل به فعالیت ناتمام که تاریخش گذشته است ⇒ late
  const late = analyzeProject(
    project([act("a", 3, [], { progress: 40 })], {
      milestones: [{ id: "m", name: "نقطه کنترل", activityId: "a" }],
      meta: { name: "m", type: "general", currency: "IRR", startDate: START, statusDate: day(8) },
    }),
  );
  eq(late.milestones.find((m) => m.id === "m")?.status, "late", "نقطه عطف متصل و ناتمام پس از تاریخ: late");
}

/* ================================================================== */
console.log("▶ ۴. انحراف برنامه مبنا (شروع و پایان مستقل)");
{
  // مبنا: ۰۳ تا ۰۷ ژانویه (۵ روز کاری). جاری: شروع آفست ۲ (۰۵ ژانویه)، مدت ۵ روز
  // ⇒ پایان آفست ۷ (۱۱ ژانویه). انحراف شروع = ۲، انحراف پایان = ۲، تغییر مدت = ۰.
  const analysis = analyzeProject(
    project([act("a", 5, [], { constraintType: "SNET", constraintDate: day(2) })], {
      baseline: {
        name: "مبنا",
        createdAt: "2026-01-01T00:00:00.000Z",
        activities: [
          { activityId: "a", startDate: day(0), finishDate: day(4), duration: 5, cost: 100 },
        ],
      },
    }),
  );
  const row = analysis.baseline.changedActivities[0];
  check(Boolean(row), "ردیف انحراف مبنا تولید می‌شود");
  eq(row.currentStart, day(2), "شروع جاری محاسبه‌شده");
  eq(row.currentFinish, day(6), "پایان جاری محاسبه‌شده (۵ روز کاری از ۰۵ ژانویه)");
  eq(row.startVarianceDays, 2, "انحراف شروع = ۲ روز کاری");
  eq(row.finishVarianceDays, 2, "انحراف پایان = ۲ روز کاری");
  eq(row.durationChange, 0, "تغییر مدت = ۰");
  eq(row.status, "later", "وضعیت نسبت به مبنا: عقب‌تر");
  eq(row.varianceDays, 2, "فیلد سازگاری varianceDays = انحراف پایان (نه صفر)");
  check(row.varianceDays !== 0, "تغییر هم‌زمان شروع و پایان، تأخیر را صفر نمی‌کند");
  eq(analysis.baseline.maxFinishSlipDays, 2, "بیشترین تأخیر پایان در سطح پروژه");
  eq(analysis.baseline.maxStartSlipDays, 2, "بیشترین تأخیر شروع در سطح پروژه");
  eq(analysis.baseline.scheduleVarianceDays, 2, "انحراف زمان‌بندی پروژه");

  // فعالیت زودتر از مبنا
  const early = analyzeProject(
    project([act("a", 2)], {
      baseline: {
        name: "مبنا",
        createdAt: "2026-01-01T00:00:00.000Z",
        activities: [{ activityId: "a", startDate: day(3), finishDate: day(4), duration: 2, cost: 10 }],
      },
    }),
  );
  eq(early.baseline.changedActivities[0].status, "earlier", "شروع زودتر از مبنا: earlier");
  eq(early.baseline.changedActivities[0].startVarianceDays, -3, "انحراف شروع منفی = زودتر");
}

/* ================================================================== */
console.log("▶ ۵. پیشرفت مقداری (فیزیکی) در برابر پیشرفت زمان‌محور");
{
  const analysis = analyzeProject(
    project(
      [
        act("a", 4, [], {
          progress: 50,
          fixedCost: 1_000_000,
          quantity: { unit: "مترمکعب", planned: 100, actual: 120 },
        }),
        act("b", 4, [], { progress: 10, fixedCost: 1_000_000 }),
      ],
      { meta: { name: "q", type: "general", currency: "IRR", startDate: START, statusDate: day(2) } },
    ),
  );
  const a = rowFor(analysis, "a");
  eq(a.quantity?.status, "over", "مقدار اجرا بیش از برنامه: وضعیت over");
  eq(a.quantity?.overrun, true, "مقدار اجرا بیش از برنامه: overrun=true");
  eq(a.physicalProgress, 120, "پیشرفت مقداری = ۱۲۰٪ (کلمپ نمی‌شود)");
  eq(a.quantity?.unit, "مترمکعب", "واحد اندازه‌گیری حفظ می‌شود");
  eq(analysis.progress.physical, 120, "پیشرفت فیزیکی پروژه بر مبنای مقدار");
  // پوشش: فقط فعالیت a مقدار دارد ⇒ ۵۰٪ بودجه
  eq(analysis.progress.physicalCoverage, 50, "پوشش پیشرفت فیزیکی = سهم بودجه دارای مقدار");
  eq(analysis.progress.timeBased, 30, "پیشرفت زمان‌محور = میانگین وزنی مدت (50+10)/2");
  check(
    analysis.progress.physical !== analysis.progress.timeBased,
    "پیشرفت فیزیکی و زمان‌محور دو شاخص مستقل‌اند",
  );

  // مقدار برنامه‌ریزی‌شده صفر ⇒ تقسیم بر صفر ممنوع
  const zero = analyzeProject(
    project([act("z", 2, [], { quantity: { unit: "متر", planned: 0, actual: 5 } })]),
  );
  eq(rowFor(zero, "z").physicalProgress, null, "مقدار برنامه صفر: پیشرفت فیزیکی null است");
  eq(rowFor(zero, "z").quantity?.status, "invalid", "مقدار برنامه صفر: وضعیت invalid");

  // بدون هیچ مقدار ⇒ null
  const none = analyzeProject(project([act("n", 2)]));
  eq(none.progress.physical, null, "بدون مقدار اجرا: پیشرفت فیزیکی null است");
  eq(none.progress.physicalCoverage, 0, "بدون مقدار اجرا: پوشش صفر");

  // پیشرفت مالی = EV ÷ BAC (سنجه سوم، مستقل از دو سنجه دیگر)
  // بودجه: a = 1,000,000 (پیشرفت ۵۰٪) و b = 1,000,000 (پیشرفت ۱۰٪)
  // EV = 500,000 + 100,000 = 600,000 ⇒ 600,000 / 2,000,000 = ۳۰٪
  eq(analysis.progress.financial, 30, "پیشرفت مالی = EV/BAC = ۳۰٪");
  const noBudget = analyzeProject(
    project([act("p", 2, [], { progress: 40 })], {
      resources: [],
    }),
  );
  eq(noBudget.progress.financial, null, "بودجه صفر ⇒ پیشرفت مالی null است (بدون تقسیم بر صفر)");
}

/* ================================================================== */
console.log("▶ ۶. شاخص‌های EVM و مدیریت تقسیم بر صفر");
{
  // A: ۱۰ روز، بودجه ۱۰۰۰، پیشرفت ۴۰٪، تاریخ وضعیت = آفست ۵ (۶ روز کاری گذشته)
  // PV = 1000 × 5/10 = 500 · EV = 400 · AC (بدون ثبت هزینه) = 400
  const analysis = analyzeProject(
    project([act("a", 10, [], { fixedCost: 1000, progress: 40 })], {
      meta: { name: "evm", type: "general", currency: "IRR", startDate: START, statusDate: day(5) },
    }),
  );
  eq(analysis.evm.pv, 500, "PV = BAC × پیشرفت برنامه‌ای");
  eq(analysis.evm.ev, 400, "EV = BAC × پیشرفت واقعی");
  eq(analysis.evm.ac, 400, "AC = ارزش کسب‌شده وقتی هزینه واقعی ثبت نشده");
  eq(analysis.evm.sv, -100, "SV = EV − PV");
  eq(analysis.evm.cv, 0, "CV = EV − AC");
  eq(analysis.evm.spi, 0.8, "SPI = EV / PV");
  eq(analysis.evm.cpi, 1, "CPI = EV / AC");
  eq(analysis.evm.bac, 1000, "BAC = بودجه تجمیعی");
  eq(analysis.evm.eac, 1000, "EAC = BAC / CPI");
  eq(analysis.evm.etc, 600, "ETC = EAC − AC");
  eq(analysis.evm.vac, 0, "VAC = BAC − EAC");
  eq(analysis.evm.costDataCoverage, 0, "پوشش داده هزینه = ۰ (هیچ هزینه واقعی ثبت نشده)");
  check(analysis.evm.notes.length > 0, "نبود داده هزینه به‌صورت یادداشت اعلام می‌شود");

  // با هزینه واقعی ۵۰۰ ⇒ CPI = 0.8 · EAC = 1250
  const over = analyzeProject(
    project([act("a", 10, [], { fixedCost: 1000, progress: 40, actualCost: 500 })], {
      meta: { name: "evm2", type: "general", currency: "IRR", startDate: START, statusDate: day(5) },
    }),
  );
  eq(over.evm.cpi, 0.8, "CPI با هزینه واقعی");
  eq(over.evm.eac, 1250, "EAC = BAC / CPI");
  eq(over.evm.vac, -250, "VAC منفی = بیش‌هزینه پیش‌بینی‌شده");
  eq(over.evm.costDataCoverage, 100, "پوشش داده هزینه = ۱۰۰٪");

  // PV = 0 (تاریخ وضعیت = شروع پروژه) ⇒ SPI باید null باشد، نه 0 و نه Infinity
  const atStart = analyzeProject(
    project([act("a", 10, [], { fixedCost: 1000 })], {
      meta: { name: "p0", type: "general", currency: "IRR", startDate: START, statusDate: START },
    }),
  );
  eq(atStart.evm.pv, 0, "PV در شروع پروژه صفر است");
  eq(atStart.evm.spi, null, "SPI با PV=0 مقدار null دارد (نه 0 / Infinity)");
  eq(atStart.progress.schedulePerformanceIndex, 0, "فیلد سازگاری SPI عددی صفر است");
  check(
    atStart.kpis.find((k) => k.key === "spi")?.value === "—",
    "KPI عملکرد زمان‌بندی وقتی SPI تعریف‌نشده است «—» نشان می‌دهد",
  );
  check(!JSON.stringify(atStart).includes("Infinity"), "هیچ Infinity در خروجی نیست");
  check(!JSON.stringify(atStart).includes("NaN"), "هیچ NaN در خروجی نیست");
}

/* ================================================================== */
console.log("▶ ۷. تاریخ تعدیل و انتخاب دوره شاخص");
{
  // پروژه از ۲۱ مارس ۲۰۲۶ (۱۴۰۵/۰۱/۰۱) به مدت ۳۰ روز کاری
  const base = project([act("a", 30, [], { fixedCost: 30_000_000 })], {
    meta: { name: "esc", type: "general", currency: "IRR", startDate: "2026-03-21", statusDate: "2026-03-21" },
    pricing: normalizePricing({ escalationEnabled: true, escalationRatePerMonth: 10 }),
  });
  const within = analyzeProject(base);
  eq(within.pricing.escalation.months[0].factor, 1, "ماهِ تاریخ وضعیت ضریب ۱ دارد");
  check(
    within.pricing.escalation.months.slice(1).every((m) => m.factor > 1),
    "ماه‌های بعد از تاریخ وضعیت تعدیل می‌شوند",
  );
  check(
    within.pricing.escalation.note?.includes("سناریوی افزایش هزینه") ?? false,
    "توضیح صریح: این محاسبه سناریوی افزایش هزینه است، نه تعدیل قراردادی",
  );

  // تاریخ وضعیت پیش از شروع پروژه و روی روز غیرکاری (جمعه ۲ ژانویه ۲۰۲۶ = ۱۴۰۴/۱۰/۱۲)
  const beforeProject = analyzeProject({
    ...base,
    meta: { ...base.meta, statusDate: "2026-01-02" },
  });
  // ماه شروع پروژه سه ماه بعد از ماه وضعیت است ⇒ ضریب (1.1)^3 = 1.331
  const first = beforeProject.pricing.escalation.months[0];
  near(first.factor, 1.331, 0.001, "تاریخ وضعیت پیش از پروژه: فاصله ماه‌ها از تاریخ وضعیت محاسبه می‌شود");
  check(
    beforeProject.pricing.escalation.total > 0,
    "تاریخ وضعیت پیش از پروژه: تعدیل روی همه ماه‌ها اعمال می‌شود",
  );
  check(
    !(beforeProject.pricing.escalation.months[0].factor === 1.1),
    "تاریخ وضعیت خارج از بازه پروژه: fallback به اندیس صفر رخ نمی‌دهد",
  );

  // تاریخ وضعیت بعد از پایان پروژه ⇒ هیچ ماهی تعدیل نمی‌شود
  const afterProject = analyzeProject({
    ...base,
    meta: { ...base.meta, statusDate: "2027-06-01" },
  });
  eq(afterProject.pricing.escalation.total, 0, "تاریخ وضعیت بعد از پایان پروژه: تعدیل صفر");

  /* ---- فراداده هر نرخ: نوع، واحد، واحد پول، تاریخ، اعتبار، سند ---- */
  const withResource = analyzeProject(
    project([act("a", 5, [], { resources: [{ resourceId: "r", units: 1 }] })], {
      resources: [{ id: "r", name: "کارگر ساده", type: "labor", rate: 5_000_000, capacity: 1 }],
    }),
  );
  const rate = withResource.pricing.rates[0];
  if (!rate) {
    check(false, "دست‌کم یک نرخ در خروجی قیمت‌گذاری وجود دارد");
  } else {
    check(Boolean(rate.provenance), "هر نرخ فراوانی/فراداده منبع دارد");
    eq(rate.provenance?.currency, "IRR", "واحد پول هر نرخ صریح است");
    check(Boolean(rate.provenance?.asOfIso), "تاریخ مرجع هر نرخ ثبت شده است");
    check(Boolean(rate.provenance?.lastUpdatedIso), "تاریخ آخرین به‌روزرسانی هر نرخ ثبت شده است");
    check(
      rate.provenance?.sourceRef === null && rate.provenance?.sourceUrl === null,
      "نرخ بدون سند: ارجاع و پیوند به‌صورت null (بدون جعل سند) اعلام می‌شود",
    );
    eq(rate.provenance?.verification, "unverified", "کاتالوگ داخلی «تأییدنشده» علامت می‌خورد");
    eq(rate.verified, false, "نرخ کاتالوگ به‌عنوان تأییدشده نمایش داده نمی‌شود");
    check(
      !(rate.provenance?.kind === "official-wage" && rate.verified === false && rate.provenance?.sourceRef !== null),
      "برچسب «رسمی» بدون ارجاع سند ممکن نیست",
    );
  }
}

/* ================================================================== */
console.log("▶ ۸. مدت اعشاری، چرخه‌ها و پیش‌نیاز نامعتبر");
{
  // مدت ۲٫۵ روز ⇒ گرد به ۳ روز کاری + هشدار، و بودجه بر همان ۳ روز محاسبه می‌شود
  const fractional = analyzeProject(
    project([act("a", 2.5, [], { resources: [{ resourceId: "r", units: 2 }] })], {
      resources: [{ id: "r", name: "کارگر", type: "labor", rate: 1000, capacity: 10 }],
    }),
  );
  eq(rowFor(fractional, "a").duration, 3, "مدت ۲٫۵ روز به ۳ روز کاری گرد می‌شود");
  eq(rowFor(fractional, "a").budgetCost, 6000, "بودجه با مدت گردشده محاسبه می‌شود (3×2×1000)");
  check(
    fractional.diagnostics.some((d) => d.code === "fractional-duration"),
    "گرد کردن مدت به کاربر اعلام می‌شود",
  );

  // چرخه A→B→C→A
  const cyclic = analyzeProject(
    project([
      act("a", 1, [{ predecessorId: "c", type: "FS", lag: 0 }]),
      act("b", 1, [{ predecessorId: "a", type: "FS", lag: 0 }]),
      act("c", 1, [{ predecessorId: "b", type: "FS", lag: 0 }]),
    ]),
  );
  const cycle = cyclic.diagnostics.find((d) => d.code === "circular-dependency");
  check(Boolean(cycle), "چرخه شناسایی می‌شود");
  eq(cycle?.kind, "cycle", "نوع تشخیص: چرخه");
  eq(cyclic.status, "invalid", "پروژه دارای چرخه: تحلیل نامعتبر");
  eq(cyclic.unschedulable.length, 3, "هر سه فعالیت چرخه به‌عنوان زمان‌بندی‌نشده فهرست می‌شوند");
  check(
    (cycle?.message ?? "").includes("→"),
    "پیام چرخه مسیر آن را نشان می‌دهد",
    cycle?.message,
  );
  eq(cyclic.activities.length, 0, "هیچ فعالیتی با تاریخ ساختگی برای چرخه تولید نمی‌شود");

  // پیش‌نیاز ناموجود ⇒ خطای داده
  const dangling = analyzeProject(
    project([act("a", 2, [{ predecessorId: "ghost", type: "FS", lag: 0 }])]),
  );
  check(
    dangling.diagnostics.some((d) => d.code === "unknown-predecessor" && d.severity === "error"),
    "پیش‌نیاز ناموجود خطای داده است (نه هشدار خاموش)",
  );
  eq(dangling.status, "invalid", "پیش‌نیاز ناموجود: تحلیل نامعتبر");

  // وابستگی به خود
  const selfRef = analyzeProject(project([act("a", 2, [{ predecessorId: "a", type: "FS", lag: 0 }])]));
  check(
    selfRef.diagnostics.some((d) => d.code === "self-dependency"),
    "وابستگی به خود تشخیص داده می‌شود",
  );

  // رابطه تکراری
  const duplicate = analyzeProject(
    project([
      act("p", 2),
      act("s", 2, [
        { predecessorId: "p", type: "FS", lag: 0 },
        { predecessorId: "p", type: "FS", lag: 0 },
      ]),
    ]),
  );
  check(
    duplicate.diagnostics.some((d) => d.code === "duplicate-dependency"),
    "رابطه تکراری گزارش می‌شود",
  );
  eq(rowFor(duplicate, "s").es, 2, "رابطه تکراری زمان‌بندی را خراب نمی‌کند");
}

/* ================================================================== */
console.log("▶ ۹. روابط چهارگانه با تقویم دارای تعطیلی");
{
  const calendar = { workDays: [6, 0, 1, 2, 3], holidays: ["2026-01-05"], hoursPerDay: 8 };
  // تعطیلی ۰۵ ژانویه (آفست ۲ در تقویم عادی) ⇒ محور: 03,04,06,07,10,11,12
  const fs = analyzeProject(
    project(
      [
        act("p", 2, []),
        act("s", 2, [{ predecessorId: "p", type: "FS", lag: 1 }]),
      ],
      { calendar },
    ),
  );
  eq(rowFor(fs, "p").finishDate, "2026-01-04", "تعطیلی: فعالیت ۲ روزه روی ۰۳ و ۰۴");
  eq(rowFor(fs, "s").startDate, "2026-01-07", "FS+1 با تعطیلی: شروع پس از یک روز کاری فاصله");
  eq(rowFor(fs, "s").finishDate, "2026-01-10", "FS+1 با تعطیلی: پایان محاسبه‌شده");

  const ss = analyzeProject(
    project(
      [
        act("p", 3, []),
        act("s", 2, [{ predecessorId: "p", type: "SS", lag: 2 }]),
      ],
      { calendar },
    ),
  );
  eq(rowFor(ss, "s").es, 2, "SS+2: شروع جانشین در آفست ۲");
  eq(rowFor(ss, "s").startDate, "2026-01-06", "SS+2: تاریخ شروع با احتساب تعطیلی");

  const ff = analyzeProject(
    project(
      [
        act("p", 4, []),
        act("s", 2, [{ predecessorId: "p", type: "FF", lag: 0 }]),
      ],
      { calendar },
    ),
  );
  eq(rowFor(ff, "p").ee, 4, "FF: پایان پیش‌نیاز در آفست ۴");
  eq(rowFor(ff, "s").ee, 4, "FF: پایان جانشین هم‌زمان با پیش‌نیاز");
  eq(rowFor(ff, "s").es, 2, "FF: شروع جانشین = پایان مشترک − مدت");

  // SF: پایان جانشین باید یک روز کاری پس از شروع پیش‌نیاز باشد.
  // پیش‌نیاز با SNET در آفست ۳ شروع می‌شود ⇒ SF+1 و مدت ۲ ⇒ ES = 3 + 1 − 2 = 2
  const sf = analyzeProject(
    project(
      [
        // در تقویم این بخش، ۰۷ ژانویه آفست ۳ است (۰۵ ژانویه تعطیل شده)
        act("p", 3, [], { constraintType: "SNET", constraintDate: "2026-01-07" }),
        act("s", 2, [{ predecessorId: "p", type: "SF", lag: 1 }]),
      ],
      { calendar },
    ),
  );
  eq(rowFor(sf, "p").es, 3, "SF: پیش‌نیاز با SNET در آفست ۳");
  eq(rowFor(sf, "s").es, 2, "SF+1: شروع جانشین = شروع پیش‌نیاز + ۱ − مدت جانشین");
  eq(rowFor(sf, "s").ee, 4, "SF+1: پایان جانشین = شروع پیش‌نیاز + ۱");

  // SF بدون فضای کافی ⇒ شروع به صفر کلمپ می‌شود و تاریخ منفی تولید نمی‌شود
  const sfClamped = analyzeProject(
    project([
      act("p", 3),
      act("s", 2, [{ predecessorId: "p", type: "SF", lag: 1 }]),
    ]),
  );
  eq(rowFor(sfClamped, "s").es, 0, "SF: شروع منفی به اولین روز کاری کلمپ می‌شود");
}

/* ================================================================== */
console.log("▶ ۱۰. فراخوانی مستقیم موتور (بدون لایه تحلیل)");
{
  const result = computeSchedule(
    [act("a", 3, [], { constraintType: "FNLT", constraintDate: day(1) })],
    ensureViableCalendar(CALENDAR),
    START,
  );
  eq(result.status, "inconsistent", "موتور مستقل هم وضعیت ناسازگار را برمی‌گرداند");
  check(
    result.diagnostics.some((d) => d.code === "fnlt-violated"),
    "موتور مستقل: تشخیص نقض FNLT",
  );
  check(Number.isFinite(result.duration), "مدت پروژه عددی معتبر است");
}

/* ================================================================== */
console.log("▶ ۱۱. موقعیت تاریخ وضعیت (چهار حالت مرزی)");
{
  // فعالیت ۵ روزه از شنبه 2026-01-03 ⇒ ۰..۴، پایان 2026-01-07، مدت پروژه = ۵.
  const base = [act("a", 5)];
  const at = (statusDate: string) =>
    analyzeProject(project(base, { meta: { ...project(base).meta, statusDate } }));

  // (۱) پیش از شروع پروژه — آفست منفی نباید به صفر «چسبانده» شود بی‌صدا
  const before = at("2025-12-01");
  check(
    before.diagnostics.some((d) => d.code === "status-date-before-start"),
    "تاریخ وضعیت پیش از شروع ⇒ تشخیص status-date-before-start",
    JSON.stringify(before.diagnostics.map((d) => d.code)),
  );
  eq(before.progress.elapsedDays, 0, "پیش از شروع: روزهای سپری‌شده صفر (کلمپ‌شده)");
  eq(before.progress.remainingDays, 5, "پیش از شروع: باقی‌مانده = کل مدت برنامه");
  eq(before.progress.planned, 0, "پیش از شروع: پیشرفت برنامه‌ای صفر");

  // (۲) پس از پایان — آفست نباید از پنجره پروژه فراتر برود
  const after = at("2026-02-01");
  check(
    after.diagnostics.some((d) => d.code === "status-date-after-finish"),
    "تاریخ وضعیت پس از پایان ⇒ تشخیص status-date-after-finish",
    JSON.stringify(after.diagnostics.map((d) => d.code)),
  );
  eq(after.progress.elapsedDays, 5, "پس از پایان: سپری‌شده = کل مدت (کلمپ‌شده)");
  eq(after.progress.remainingDays, 0, "پس از پایان: باقی‌مانده صفر");
  eq(after.progress.planned, 100, "پس از پایان: پیشرفت برنامه‌ای ۱۰۰٪");

  // (۳) روز غیرکاری تعطیل — 2026-01-05 با تعطیلی همان روز
  const holidayProject = project(base, {
    calendar: { ...CALENDAR, holidays: ["2026-01-05"] },
    meta: { ...project(base).meta, statusDate: "2026-01-05" },
  });
  const holiday = analyzeProject(holidayProject);
  check(
    holiday.diagnostics.some((d) => d.code === "status-date-non-working"),
    "تاریخ وضعیت روی تعطیلی ⇒ تشخیص status-date-non-working",
    JSON.stringify(holiday.diagnostics.map((d) => d.code)),
  );
  // با تعطیلی 01-05، روزهای کاری: 03(0) 04(1) 06(2) 07(3) 10(4) …
  // موقعیت 01-05 = ابتدای 06 ⇒ آفست ۲ ⇒ planned = ۲/۵ = ۴۰٪
  eq(holiday.progress.elapsedDays, 2, "تعطیلی: موقعیت با نخستین روز کاری بعد سنجیده می‌شود");
  eq(holiday.progress.planned, 40, "تعطیلی: پیشرفت برنامه‌ای ۲ روز از ۵ = ۴۰٪");

  // (۴) جمعه (روز غیرکاری هفتگی) — 2026-01-09 جمعه ⇒ ابتدای شنبه 01-10 = آفست ۵ ⇒ ۱۰۰٪
  const friday = at("2026-01-09");
  check(
    friday.diagnostics.some((d) => d.code === "status-date-non-working"),
    "تاریخ وضعیت روی جمعه ⇒ تشخیص status-date-non-working",
  );
  eq(friday.progress.elapsedDays, 5, "جمعه بعد از پایان: کلمپ به مدت برنامه");
  eq(friday.progress.planned, 100, "جمعه: پیشرفت برنامه‌ای ۱۰۰٪");
  // روز کاری بعد از جمعه 01-09، شنبه 01-10 و آفست ۵ است ⇒ هم «غیرکاری» و هم
  // «پس از پایان» باید اعلام شود؛ هیچ‌کدام به‌صورت خاموش نادیده گرفته نمی‌شود.
  check(
    friday.diagnostics.some((d) => d.code === "status-date-after-finish"),
    "جمعهٔ پس از پایان ⇒ علاوه بر غیرکاری، پس‌از‌پایان هم گزارش می‌شود",
    JSON.stringify(friday.diagnostics.map((d) => d.code)),
  );
}

/* ================================================================== */
console.log("▶ ۱۲. سیاست واحد گرد کردن مدت و Lag (پایه آزمون: ۸ بررسی)");
{
  // همه انتظارها از سیاست مستندشده در docs/ENGINE.md §۳ می‌آیند:
  // Math.round با حداقل صفر، دقیقاً یک‌بار، روی روز کاری.
  eq(rowFor(analyzeProject(project([act("a", 2.4)])), "a").duration, 2, "۲٫۴ ⇒ ۲ روز کاری");
  eq(rowFor(analyzeProject(project([act("b", 2.5)])), "b").duration, 3, "۲٫۵ ⇒ ۳ روز کاری (round-half-up)");
  eq(rowFor(analyzeProject(project([act("c", 0.4)])), "c").duration, 0, "۰٫۴ ⇒ ۰ (نقطه کنترل)");
  eq(rowFor(analyzeProject(project([act("d", -2)])), "d").duration, 0, "مدت منفی ⇒ ۰");

  // Lag اعشاری در هر دو جهت
  const lagProject = analyzeProject(
    project([
      act("p", 2),
      act("q", 2, [{ predecessorId: "p", type: "FS", lag: 1.6 }]),
      act("r", 2, [{ predecessorId: "p", type: "FS", lag: -1.6 }]),
    ]),
  );
  eq(rowFor(lagProject, "q").es, 4, "Lag ۱٫۶ ⇒ ۲ روز کاری (شروع در آفست ۴)");
  eq(rowFor(lagProject, "r").es, 0, "Lag −۱٫۶ ⇒ −۲ روز کاری و کلمپ به صفر");
  check(
    lagProject.diagnostics.some((d) => d.code === "fractional-lag"),
    "گرد کردن Lag به کاربر اعلام می‌شود",
  );

  // گرد کردن یک‌بار است: مقدار گردشده دیگر تغییر نمی‌کند (idempotent)
  const once = analyzeProject(project([act("e", 2.5)]));
  const twice = analyzeProject(project([act("e", 3)]));
  eq(rowFor(twice, "e").duration, 3, "گرد کردن idempotent است (۳ ⇒ ۳)");
  eq(rowFor(twice, "e").budgetCost, rowFor(once, "e").budgetCost, "بودجه پس از گرد کردن دوباره تغییر نمی‌کند");
  check(
    !twice.diagnostics.some((d) => d.code === "fractional-duration"),
    "ورودی صحیح هشدار گرد کردن تولید نمی‌کند",
  );
}

/* ================================================================== */
console.log("▶ ۱۳. هر تشخیص دارای راه‌حل عملی است (what/which/cause/remedy)");
{
  const broken = analyzeProject(
    project([
      act("a", 2, [{ predecessorId: "ghost", type: "FS", lag: 0 }]),
      act("b", 0, [], { milestone: true }),
    ]),
  );
  check(
    broken.diagnostics.length >= 1,
    "سناریوی معیوب تشخیص تولید می‌کند",
  );
  const missing = broken.diagnostics.filter((d) => !d.remedy);
  check(missing.length === 0, "هیچ تشخیصی بدون راه‌حل باقی نمی‌ماند", missing.map((d) => d.code).join(","));
  const unknown = broken.diagnostics.find((d) => d.code === "unknown-predecessor");
  check(Boolean(unknown?.remedy && unknown.remedy.length > 10), "راه‌حل پیش‌نیاز نامعتبر متنی و عملی است");
  eq(unknown?.kind, "data", "دسته تشخیص پیش‌نیاز نامعتبر: داده");
  check(Boolean(unknown?.activityIds?.length), "فعالیت متأثر در تشخیص مشخص است");
}

/* ================================================================== */
console.log("▶ ۱۴. گزارش خروجی HTML: نرخ با فراداده، راه‌حل تشخیص، پیشرفت مالی");
{
  const withResource = project([act("a", 3)], {
    resources: [{ id: "r1", name: "بولدوزر", type: "equipment", unit: "روز", capacity: 1, rate: 2_500_000, rateKey: "bulldozer" }],
    activities: [{ ...act("a", 3), resources: [{ resourceId: "r1", units: 1 }] }],
  });
  const html = buildReportHtml(withResource, analyzeProject(withResource), "");

  check(html.includes("نرخ‌های اعمال‌شده روی منابع پروژه"), "جدول نرخ‌های اعمال‌شده در گزارش HTML هست");
  check(html.includes("نوع داده"), "هر نرخ ستون «نوع داده» دارد");
  check(html.includes("ارز"), "هر نرخ ستون ارز دارد");
  check(html.includes("تاریخ مرجع"), "هر نرخ ستون تاریخ مرجع دارد");
  check(
    html.includes("سند ثبت نشده"),
    "نرخ بدون سند، صریحاً «سند ثبت نشده» نمایش داده می‌شود (سند جعل نمی‌شود)",
  );
  check(!html.includes("مصوب رسمی قطعی"), "برچسب «رسمی» بدون سند در خروجی وجود ندارد");

  const broken = project([act("a", 2, [{ predecessorId: "ghost", type: "FS", lag: 0 }])]);
  const brokenHtml = buildReportHtml(broken, analyzeProject(broken), "");
  check(brokenHtml.includes("راه‌حل"), "جدول تشخیص‌ها ستون راه‌حل دارد");

  const zeroBudget = project([act("a", 3)], {});
  const zHtml = analyzeProject(zeroBudget);
  check(zHtml.progress.financial === null, "بودجه صفر ⇒ پیشرفت مالی null (نه صفر گمراه‌کننده)");
  check(
    buildReportHtml(zeroBudget, zHtml, "").includes("پیشرفت مالی"),
    "برچسب «پیشرفت مالی» مستقل از «پیشرفت فیزیکی» در گزارش چاپ می‌شود",
  );
}

/* ================================================================== */
console.log("▶ ۱۵. سیاست پول: گرد کردن یک‌بار، جمع اجزای گردشده، بدون NaN");
{
  // half away from zero, at the second decimal
  eq(roundMoney(2.345), 2.35, "۲٫۳۴۵ ⇒ ۲٫۳۵ (نیم به سمت دور از صفر)");
  eq(roundMoney(-2.345), -2.35, "‎−۲٫۳۴۵ ⇒ −۲٫۳۵ (همان قاعده برای منفی)");
  eq(roundMoney(1.005), 1.01, "۱٫۰۰۵ ⇒ ۱٫۰۱ (خطای نمایش دودویی اصلاح می‌شود)");
  eq(roundMoney(0), 0, "صفر بدون تغییر است");

  // idempotent: rounding a rounded value must not move it
  const samples = [0.004, 0.005, 0.015, 1234.5678, 99_999.999, 1e9 + 0.333];
  check(
    samples.every((value) => roundMoney(roundMoney(value)) === roundMoney(value)),
    "گرد کردن idempotent است (قاعده ۱)",
  );

  // non-finite values never leak into a report
  eq(roundMoney(Number.NaN), 0, "NaN ⇒ ۰ (به گزارش نمی‌رسد)");
  eq(roundMoney(Number.POSITIVE_INFINITY), 0, "Infinity ⇒ ۰");
  eq(sumMoney([1, Number.NaN, 2]), 3, "جمع، مقدار نامعتبر را نادیده می‌گیرد");

  // the total is exactly the sum of the printed components
  const breakdown = computeCostBreakdown(12_345_678.905, 4_567.891, {
    overheadPercent: 17,
    profitPercent: 10,
    contingencyPercent: 5,
  } as never);
  const parts = [breakdown.direct, breakdown.overhead, breakdown.profit, breakdown.contingency, breakdown.escalation];
  check(
    breakdown.total === sumMoney(parts),
    "جمع کل برابر جمع دقیق اجزای چاپ‌شده است (قاعده ۲)",
    `${breakdown.total} vs ${sumMoney(parts)}`,
  );
  check(parts.every((value) => Number.isFinite(value)), "هیچ جزئی NaN/Infinity نیست");
  check(
    parts.every((value) => roundMoney(value) === value),
    "هر جزء حداکثر دو رقم اعشار دارد (قاعده ۱)",
  );
  eq(breakdown.overhead, percentOfMoney(breakdown.direct, 17), "بالاسری = ۱۷٪ مستقیم (گردشده یک‌بار)");

  // money equality helper is symmetric and tolerant only to display rounding
  check(moneyEquals(1000.001, 1000), "تفاوت کوچک‌تر از آخرین رقم اعشار برابر حساب می‌شود");
  check(!moneyEquals(1000.01, 1000), "تفاوت یک صدم، نابرابری واقعی است");
}

/* ================================================================== */
console.log(
  failures === 0
    ? `\n✔ ${checks} بررسی رگرسیون موتور — همه با محاسبه دستی تأیید شد`
    : `\n✘ ${failures} خطا از ${checks} بررسی`,
);
process.exit(failures === 0 ? 0 : 1);
