/**
 * Fast-capture parser tests — Excel paste, CSV, Persian digits and units.
 *
 * Run: npx tsx scripts/import-parser.test.ts
 */
import { buildActivitiesFromImport, IMPORT_SAMPLE, parseActivityImport, parseDuration } from "../src/lib/import";

let failed = 0;
const check = (condition: boolean, message: string) => {
  if (!condition) {
    failed += 1;
    console.error("  ✗", message);
  }
};

/* duration units */
check(parseDuration("10") === 10, "plain number");
check(parseDuration("۱۲") === 12, "persian digits");
check(parseDuration("2 هفته") === 10, "weeks → working days");
check(parseDuration("۱ ماه") === 22, "months → working days");
check(parseDuration("16 ساعت") === 2, "hours → working days");
check(parseDuration("") === 0, "empty → 0");
check(parseDuration("abc") === 0, "garbage → 0");

/* Excel paste with a header row (tab separated) */
const excel = parseActivityImport(IMPORT_SAMPLE);
check(excel.rows.length === 5, `excel row count ${excel.rows.length}`);
check(excel.detected.hadHeader === true, "header row detected");
check(excel.rows[0].duration === 8, "duration column mapped");
check(excel.rows[2].phase === "فونداسیون", "phase column mapped");
const linked = buildActivitiesFromImport(excel);
check(linked.linkedPredecessors === 4, `predecessors linked: ${linked.linkedPredecessors}`);
check(linked.activities[2].predecessors.length === 1, "A30 depends on A20");
check(linked.phaseCount === 3, `phases: ${linked.phaseCount}`);

/* CSV with a quoted decimal comma */
const csv = parseActivityImport('Survey,5\nExcavation,"8,5"\nConcrete,4');
check(csv.rows.length === 3, `csv rows ${csv.rows.length}`);
check(csv.detected.hadHeader === false, "no header detected");
check(csv.rows[1].duration === 8.5, `quoted decimal comma → ${csv.rows[1]?.duration}`);

/* semicolons, progress and cost */
const semi = parseActivityImport("name;duration;phase;progress;predecessors;cost\nDesign;10;فاز ۱;25;A10;500000");
check(semi.rows[0].progress === 25, "progress mapped");
check(semi.rows[0].cost === 500000, "cost mapped");
check(
  buildActivitiesFromImport(semi).warnings.some((w) => w.includes("A10")),
  "unknown predecessor produces a warning",
);

/* blank and separator-only lines are ignored */
const messy = parseActivityImport("\n\n---\n|||\nTask A\t3\n\n");
check(messy.rows.length === 1, `messy rows ${messy.rows.length}`);

/* single column defaults to 1 day */
const single = parseActivityImport("فعالیت اول\nفعالیت دوم");
check(single.rows.length === 2 && single.rows[0].duration === 1, "single column defaults to 1 day");

/* empty input */
const empty = parseActivityImport("");
check(empty.rows.length === 0 && empty.errors.length > 0, "empty input reported");

console.log(
  failed === 0 ? "✔ IMPORT PARSER: ALL CHECKS PASSED" : `✘ IMPORT PARSER: ${failed} FAILURE(S)`,
);
process.exit(failed === 0 ? 0 : 1);
