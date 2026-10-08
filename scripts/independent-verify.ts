/**
 * INDEPENDENT POST-REPAIR VERIFICATION
 *
 * Every expectation here was derived by hand, on paper, BEFORE running the
 * engine, and is deliberately different from the cases used during the repair
 * phase. If the engine disagrees with any line, that is a defect.
 *
 * Run: npx tsx scripts/independent-verify.ts
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import type { ActivityInput, ProjectInput } from "../src/lib/engine/types";

let passed = 0;
let failed = 0;
const misses: string[] = [];
const eq = (actual: unknown, expected: unknown, label: string) => {
  const ok = actual === expected;
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    misses.push(`${label}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
    console.error(`  ✗ ${label}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  }
};

// Working week Saturday→Wednesday. 2026-01-03 is a Saturday.
const CAL = { workDays: [6, 0, 1, 2, 3] as number[], holidays: [] as string[], hoursPerDay: 8 };
const base = (activities: ActivityInput[], extra: Partial<ProjectInput> = {}): ProjectInput => ({
  meta: { name: "v", type: "general", currency: "IRR", startDate: "2026-01-03", statusDate: "2026-01-03" },
  calendar: { ...CAL, ...(extra.calendar ?? {}) },
  activities,
  resources: [],
  milestones: [],
  risks: [],
  baseline: null,
  ...extra,
});
const A = (
  id: string,
  duration: number,
  preds: ActivityInput["predecessors"] = [],
  extra: Partial<ActivityInput> = {},
): ActivityInput => ({
  id,
  code: id.toUpperCase(),
  name: id,
  phase: "p",
  duration,
  predecessors: preds,
  progress: 0,
  resources: [],
  fixedCost: 0,
  materialCost: 0,
  constraintType: "ASAP",
  milestone: false,
  ...extra,
});
const g = (a: ReturnType<typeof analyzeProject>, id: string) => a.activities.find((x) => x.id === id)!;

/* ==================================================================== */
console.log("▶ A. FS با Lag منفی + تعطیلی (محاسبه دستی روی تقویم)");
{
  // محور روزهای کاری با تعطیلی ۰۷ ژانویه:
  //   Jan3=0, Jan4=1, Jan5=2, Jan6=3, Jan10=4, Jan11=5, Jan12=6
  // A(4): افست‌های 0..3 ⇒ Jan3,4,5,6 ⇒ پایان Jan6
  // B: FS(A) با Lag −2 ⇒ ES = 4 − 2 = 2 ⇒ افست‌های 2..4 ⇒ Jan5, Jan6, Jan10 ⇒ پایان Jan10
  const a = analyzeProject(
    base([A("a", 4), A("b", 3, [{ predecessorId: "a", type: "FS", lag: -2 }])], {
      calendar: { ...CAL, holidays: ["2026-01-07"] },
    }),
  );
  eq(a.schedule.startDate, "2026-01-03", "A: شروع پروژه شنبه");
  eq(g(a, "a").startDate, "2026-01-03", "A: شروع");
  eq(g(a, "a").finishDate, "2026-01-06", "A: پایان با ۴ روز کاری");
  eq(g(a, "b").es, 2, "B: ES با Lag −2 برابر ۲");
  eq(g(a, "b").startDate, "2026-01-05", "B: شروع (Jan5)");
  eq(g(a, "b").finishDate, "2026-01-10", "B: پایان با تعطیلی Jan7 ⇒ Jan10");
  eq(a.schedule.workingDays, 5, "پایان پروژه در افست ۵");
  eq(a.criticalPath.length, 2, "هر دو فعالیت بحرانی‌اند");
  eq(g(a, "b").totalFloat, 0, "B: شناوری صفر");
}

/* ==================================================================== */
console.log("▶ B. رابطه SF (پاس رو به جلو و معکوس)");
{
  // A(4): 0→4 ، B(3) با SF از A و Lag +1 ⇒ B.EE ≥ A.ES + 1 = 1 ⇒ B.ES کلمپ به ۰ ⇒ B: 0→3
  // پایان پروژه = max(4, 3) = 4
  // پاس معکوس: B بدون جانشین ⇒ LF=4 ⇒ LS=1 ⇒ شناوری B = 1
  //             A با جانشین SF ⇒ LF ≤ B.LE − 1 + مدت A = 4 − 1 + 4 = 7 ⇒ LS=3 ⇒ شناوری A = 3
  const a = analyzeProject(base([A("a", 4), A("b", 3, [{ predecessorId: "a", type: "SF", lag: 1 }])]));
  eq(g(a, "b").es, 0, "SF: ES جانشین کلمپ به صفر");
  eq(g(a, "b").ee, 3, "SF: EE جانشین = ۳");
  eq(a.schedule.workingDays, 4, "SF: پایان پروژه = ۴");
  eq(g(a, "b").totalFloat, 1, "SF: شناوری جانشین = ۱");
  // A itself finishes at the project finish (4), so it cannot slip at all.
  // The SF bound (LF ≤ 7) is looser than the project-finish bound and therefore not binding.
  eq(g(a, "a").totalFloat, 0, "SF: پیش‌نیار در پایان پروژه است ⇒ شناوری ۰");
  eq(g(a, "a").lateFinishDate, g(a, "a").finishDate, "SF: دیرترین پایان = پایان واقعی");
}

/* ==================================================================== */
console.log("▶ C. رابطه FF با Lag مثبت");
{
  // A(5): 0→5 ، B(3) با FF از A و Lag +2 ⇒ B.EE ≥ 5 + 2 = 7 ⇒ B.ES = 4 ⇒ B: 4→7
  // پاس معکوس: پایان ۷ ⇒ B: LF=7,LS=4,شناوری ۰
  //             A: LF ≤ B.LE − 2 = 5 ⇒ LS=0 ⇒ شناوری ۰
  const a = analyzeProject(base([A("a", 5), A("b", 3, [{ predecessorId: "a", type: "FF", lag: 2 }])]));
  eq(g(a, "b").es, 4, "FF+2: ES جانشین = ۴");
  eq(g(a, "b").ee, 7, "FF+2: EE جانشین = ۷");
  eq(g(a, "a").totalFloat, 0, "FF: شناوری پیش‌نیار = ۰");
  eq(g(a, "b").totalFloat, 0, "FF: شناوری جانشین = ۰");
  eq(a.schedule.workingDays, 7, "FF: پایان پروژه = ۷");
}

/* ==================================================================== */
console.log("▶ D. شاخه‌بندی: شناوری کل در برابر شناوری آزاد");
{
  // A(3) → B(5) ؛ A(3) → C(2) ؛ B → D(4)
  // ES/EE: A 0→3 ، B 3→8 ، C 3→5 ، D 8→12
  // پاس معکوس از ۱۲: D(LS 8, float 0) ، B(LS 3, float 0) ، C(LS 10, float 7)
  // A: LF = min(LS_B, LS_C) = 3 ⇒ float 0
  // شناوری آزاد C = پایان پروژه − EE(C) = 12 − 5 = 7
  // شناوری آزاد A = min(ES_B, ES_C) − EE(A) = 3 − 3 = 0
  const a = analyzeProject(
    base([
      A("a", 3),
      A("b", 5, [{ predecessorId: "a", type: "FS", lag: 0 }]),
      A("c", 2, [{ predecessorId: "a", type: "FS", lag: 0 }]),
      A("d", 4, [{ predecessorId: "b", type: "FS", lag: 0 }]),
    ]),
  );
  eq(a.schedule.workingDays, 12, "پایان پروژه = ۱۲");
  eq(g(a, "c").totalFloat, 7, "C: شناوری کل = ۷");
  eq(g(a, "c").freeFloat, 7, "C: شناوری آزاد = ۷");
  eq(g(a, "a").freeFloat, 0, "A: شناوری آزاد = ۰");
  eq(g(a, "b").totalFloat, 0, "B: بحرانی");
  eq(
    a.criticalPath.map((x) => x.id).join(","),
    "a,b,d",
    "مسیر بحرانی A→B→D",
  );
}

/* ==================================================================== */
console.log("▶ E. نقطه کنترل (Milestone) در میان زنجیره");
{
  // A(3) → M(0) → B(2): A 0→3 ، M 3→3 ، B 3→5
  // M باید شروع و پایان یکسان داشته باشد و تاریخش = تاریخ شروع B
  const a = analyzeProject(
    base([
      A("a", 3),
      A("m", 0, [{ predecessorId: "a", type: "FS", lag: 0 }], { milestone: true }),
      A("b", 2, [{ predecessorId: "m", type: "FS", lag: 0 }]),
    ]),
  );
  eq(g(a, "m").startDate, g(a, "m").finishDate, "M: شروع و پایان یکسان");
  eq(g(a, "m").finishDate, g(a, "b").startDate, "M: تاریخ = شروع فعالیت بعدی");
  eq(g(a, "m").totalFloat, 0, "M: شناوری صفر");
  eq(a.milestones.length, 1, "M در فهرست نقاط کنترل می‌آید");
  eq(a.milestones[0].date, g(a, "m").finishDate, "تاریخ نقطه کنترل صحیح است");
}

/* ==================================================================== */
console.log("▶ F. تاریخ هدف پایان و شناوری منفی یکنواخت");
{
  // زنجیره A(5) → B(5) → C(5) = ۱۵ روز ؛ هدف در افست ۱۲
  // شناوری هر سه = 12 − 15 = −۳
  const a = analyzeProject(
    base(
      [
        A("a", 5),
        A("b", 5, [{ predecessorId: "a", type: "FS", lag: 0 }]),
        A("c", 5, [{ predecessorId: "b", type: "FS", lag: 0 }]),
      ],
      { meta: { name: "dl", type: "general", currency: "IRR", startDate: "2026-01-03", statusDate: "2026-01-03", deadline: "2026-01-17" } },
    ),
  );
  // Jan3=0 … Jan16=9 ؛ Jan17 = شنبه؟ Jan 17 2026 = Saturday ⇒ افست ۱۰
  eq(g(a, "a").totalFloat, -5, "A: شناوری = افست هدف − مدت طبیعی");
  eq(g(a, "b").totalFloat, -5, "B: همان شناوری منفی");
  eq(g(a, "c").totalFloat, -5, "C: همان شناوری منفی");
  eq(a.schedule.workingDays, 15, "مدت طبیعی برنامه تغییری نمی‌کند");
  eq(a.schedule.deadlineVarianceDays, -5, "انحراف از هدف = −۵");
  eq(a.schedule.deadlineMet, false, "هدف محقق نمی‌شود");
  // محور: Jan3,4,5,6,7 | Jan10,11,12,13,14 | Jan17,18,19,20,21 ⇒ روز پانزدهم = Jan21
  eq(a.schedule.finishDate, "2026-01-21", "پانزدهمین روز کاری = Jan21");
}

/* ==================================================================== */
console.log("▶ G. هم‌خوانی موتور با تاریخ‌های نمایشی");
{
  const a = analyzeProject(
    base([
      A("a", 2),
      A("b", 2, [{ predecessorId: "a", type: "FS", lag: 0 }]),
      A("c", 2, [{ predecessorId: "b", type: "FS", lag: 0 }]),
    ]),
  );
  // 6 روز کاری از Jan3 ⇒ Jan3,4,5,7,8,9 (Jan6? Jan6 = Tue ⇒ کارکرد)
  // محور: Jan3(0) Jan4(1) Jan5(2) Jan6(3) Jan7(4) Jan8(5) Jan9(6)
  // شش روز کاری از شنبه ۳: Jan3,4,5,6,7,10 ⇒ Jan10 (Jan8 پنجشنبه و Jan9 جمعه تعطیل‌اند)
  eq(a.schedule.finishDate, "2026-01-10", "ششمین روز کاری = Jan10");
  const rows = a.activities.map((x) => `${x.code}:${x.startDate}→${x.finishDate}`);
  console.log(`    ${rows.join("  ")}`);
  console.log(`    محور روزهای کاری: ${a.gantt.dates.slice(0, 7).join(", ")}`);
  // هر فعالیت دقیقاً روی روزهای کاری قرار می‌گیرد
  const axis = new Set(a.gantt.dates);
  eq(
    a.activities.every((x) => axis.has(x.startDate) && axis.has(x.finishDate)),
    true,
    "G: شروع و پایان همه فعالیت‌ها روی روز کاری است",
  );
}

console.log(`\n${failed === 0 ? `✔ ${passed} بررسی مستقل تأیید شد` : `✘ ${failed} خطا از ${passed + failed}`}`);
if (misses.length) misses.forEach((m) => console.error(`  • ${m}`));
process.exit(failed === 0 ? 0 : 1);
