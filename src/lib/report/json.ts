import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import type { ReportOptions } from "@/lib/validation";

/** Lossless project snapshot plus the deterministic analysis used in exports. */
export function buildProjectJson(
  project: ProjectInput,
  analysis: ProjectAnalysis,
  reportOptions?: Partial<ReportOptions>,
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: analysis.generatedAt,
      dateEncoding: "Gregorian ISO 8601 calendar dates (YYYY-MM-DD); UI presentation uses the Jalali calendar.",
      ...(reportOptions ? { reportOptions } : {}),
      project,
      analysis,
    },
    null,
    2,
  );
}
