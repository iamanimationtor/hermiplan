import { isIsoDate } from "./calendar";
import { analyzeProject } from "./analysis";
import type { ProjectAnalysis, ProjectInput } from "./types";

/** Creates a minimal, valid project skeleton. */
export function emptyProject(name = "پروژه بدون نام"): ProjectInput {
  return {
    meta: {
      name,
      type: "general",
      currency: "IRR",
      startDate: new Date().toISOString().slice(0, 10),
      statusDate: new Date().toISOString().slice(0, 10),
    },
    calendar: { workDays: [6, 0, 1, 2, 3], holidays: [], hoursPerDay: 8 },
    activities: [],
    resources: [],
    milestones: [],
    risks: [],
    baseline: null,
  };
}

/** Re-runs the engine with a modified copy of the input (what-if scenarios). */
export function runScenario(
  input: ProjectInput,
  mutate: (draft: ProjectInput) => void,
): ProjectAnalysis {
  const draft: ProjectInput = JSON.parse(JSON.stringify(input));
  mutate(draft);
  return analyzeProject(draft);
}

/** Creates a baseline snapshot from the current schedule of an analysis. */
export function createBaseline(
  input: ProjectInput,
  analysis: ProjectAnalysis,
  name = "Baseline اولیه",
): ProjectInput {
  return {
    ...input,
    baseline: {
      name,
      createdAt: new Date().toISOString(),
      activities: analysis.activities.map((a) => ({
        activityId: a.id,
        startDate: a.startDate,
        finishDate: a.finishDate,
        duration: a.duration,
        cost: a.budgetCost,
      })),
    },
  };
}

export { isIsoDate, analyzeProject };
