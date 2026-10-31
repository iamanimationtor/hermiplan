/**
 * Deterministic smoke test for the HERMIPLAN project engine.
 * Run with: node --experimental-strip-types scripts/engine-smoke.ts
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import { buildProjectFromTemplate } from "../src/lib/templates";
import { TEMPLATES } from "../src/lib/templates";

let failures = 0;
const assert = (condition: boolean, message: string) => {
  if (!condition) {
    failures += 1;
    console.error("  ✗", message);
  }
};

for (const template of TEMPLATES) {
  const project = buildProjectFromTemplate(template.id);
  const analysis = analyzeProject(project);

  assert(analysis.errors.length === 0, `${template.id}: engine errors → ${analysis.errors.join(" | ")}`);
  assert(analysis.activities.length === project.activities.length, `${template.id}: activity count mismatch`);
  assert(analysis.schedule.workingDays > 0, `${template.id}: duration must be positive`);
  assert(analysis.schedule.finishDate >= analysis.schedule.startDate, `${template.id}: finish before start`);
  assert(analysis.costs.budget > 0, `${template.id}: budget should be computed`);
  assert(analysis.criticalPath.length > 0, `${template.id}: critical path should exist`);
  assert(analysis.milestones.length >= template.milestones.length, `${template.id}: milestones resolved`);

  for (const activity of analysis.activities) {
    assert(!Number.isNaN(activity.totalFloat), `${template.id}/${activity.code}: NaN float`);
    assert(activity.finishDate >= activity.startDate, `${template.id}/${activity.code}: finish < start`);
    if (activity.critical) {
      assert(activity.totalFloat === 0, `${template.id}/${activity.code}: critical with float`);
    }
  }
  assert(!Number.isNaN(analysis.health.score), `${template.id}: health score NaN`);
  assert(analysis.gantt.dates.length > 0, `${template.id}: empty gantt timeline`);
  console.log(
    `  ✓ ${template.id.padEnd(14)} ${String(analysis.activities.length).padStart(3)} acts · ${analysis.schedule.workingDays} wd · CP ${analysis.criticalPath.length} · budget ${analysis.costs.budget}`,
  );
}

// cycle detection
const cyclic = buildProjectFromTemplate("general");
cyclic.activities = [
  { ...cyclic.activities[0], id: "x1", predecessors: [{ predecessorId: "x2", type: "FS", lag: 0 }] },
  { ...cyclic.activities[1], id: "x2", predecessors: [{ predecessorId: "x1", type: "FS", lag: 0 }] },
];
const cyclicAnalysis = analyzeProject(cyclic);
assert(cyclicAnalysis.errors.length > 0, "cycle should be detected");
console.log("  ✓ circular dependency detection");

// calendar behaviour: 5 working days → 7 calendar days for a 5-day activity
const cal = buildProjectFromTemplate("general");
cal.activities = [{ ...cal.activities[5], duration: 5, predecessors: [] }];
const calAnalysis = analyzeProject(cal);
assert(calAnalysis.schedule.workingDays === 5, `calendar working days: ${calAnalysis.schedule.workingDays}`);
const spanDays =
  Math.round(
    (new Date(calAnalysis.schedule.finishDate).getTime() - new Date(calAnalysis.schedule.startDate).getTime()) / 86_400_000,
  ) + 1;
assert(spanDays >= 5 && spanDays <= 9, `5 working days should span 5–9 calendar days, got ${spanDays}`);
console.log("  ✓ calendar arithmetic (Sat–Wed working week)");

// progress / earned value
const ev = buildProjectFromTemplate("general");
ev.meta.statusDate = ev.meta.startDate;
const evAnalysis = analyzeProject(ev);
assert(evAnalysis.progress.overall === 0, "no progress at project start");
assert(evAnalysis.progress.planned === 0, "no planned progress at project start");
console.log("  ✓ earned value at data date");

// pricing & escalation
for (const template of TEMPLATES) {
  const project = buildProjectFromTemplate(template.id);
  const analysis = analyzeProject(project);
  const b = analysis.pricing.breakdown;
  assert(b.direct > 0, `${template.id}: direct cost must be positive`);
  assert(b.total > b.direct, `${template.id}: total estimate must exceed direct cost`);
  assert(analysis.pricing.rates.length === project.resources.length, `${template.id}: rate basis rows mismatch`);
  assert(analysis.standards.length > 0, `${template.id}: standards basis missing`);
  if (analysis.pricing.escalationEnabled && analysis.pricing.escalation.months.length) {
    const sum = analysis.pricing.escalation.months.reduce((acc, m) => acc + m.escalation, 0);
    assert(Math.abs(sum - analysis.pricing.escalation.total) < 2, `${template.id}: escalation total mismatch`);
    assert(analysis.pricing.escalation.months.every((m) => m.plannedValue >= 0), `${template.id}: negative planned value`);
  }
  assert(project.pricing !== undefined, `${template.id}: default pricing missing`);
  assert(project.resources.every((r) => r.rate > 0), `${template.id}: template rates must be resolved from market catalog`);
}
console.log("  ✓ market pricing, escalation and standards basis");

console.log(failures === 0 ? "\nALL ENGINE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
