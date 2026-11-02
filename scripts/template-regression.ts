/**
 * Template regression — every project template must produce a valid analysis
 * with internally consistent schedule, float and pricing data.
 *
 * Run: npx tsx scripts/template-regression.ts
 */
import { analyzeProject } from "../src/lib/engine/analysis";
import { buildProjectFromTemplate, TEMPLATES } from "../src/lib/templates";

let failed = 0;
const rows: string[] = [];

for (const template of TEMPLATES) {
  const project = buildProjectFromTemplate(template.id);
  const analysis = analyzeProject(project);

  const issues = [
    analysis.errors.length ? "engine-errors" : "",
    analysis.activities.some((a) => !Number.isFinite(a.totalFloat)) ? "float-not-finite" : "",
    analysis.activities.some((a) => !Number.isFinite(a.freeFloat)) ? "free-float-not-finite" : "",
    analysis.activities.some((a) => a.finishDate < a.startDate) ? "finish-before-start" : "",
    analysis.activities.some((a) => a.es < 0) ? "negative-early-start" : "",
    analysis.activities.some((a) => a.critical && a.totalFloat !== 0) ? "critical-with-float" : "",
    analysis.activities.some((a) => a.freeFloat < 0) ? "negative-free-float" : "",
    analysis.activities.some((a) => a.progress < 0 || a.progress > 100) ? "progress-out-of-range" : "",
    analysis.pricing.breakdown.total <= 0 ? "no-estimate" : "",
    !Number.isFinite(analysis.health.score) ? "health-not-finite" : "",
    analysis.gantt.dates.length === 0 ? "empty-timeline" : "",
    project.activities.length !== analysis.activities.length ? "activity-count-mismatch" : "",
  ].filter(Boolean);

  if (issues.length) failed += 1;
  rows.push(
    `  ${template.id.padEnd(14)} acts:${String(analysis.activities.length).padStart(3)}  wd:${String(
      analysis.schedule.workingDays,
    ).padStart(4)}  CP:${String(analysis.criticalPath.length).padStart(3)}  ${
      issues.length ? "⚠ " + issues.join(",") : "✓"
    }`,
  );
}

rows.forEach((row) => console.log(row));
console.log(failed === 0 ? `\n✔ ALL ${TEMPLATES.length} TEMPLATES CLEAN` : `\n✘ ${failed} TEMPLATE(S) WITH ISSUES`);
process.exit(failed === 0 ? 0 : 1);
