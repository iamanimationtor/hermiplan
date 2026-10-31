/**
 * Shared loading logic for the printable report.
 *
 * Both entry points — `/report/[id]` (owner) and `/s/[token]` (share link) —
 * must produce exactly the same document. Keeping the defensive parsing and the
 * report-option fallback in one place is what guarantees that: a report opened
 * through a share link can never differ from the one the owner reviewed.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, projectShareTokens } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { resolveShareToken } from "@/lib/server/share-token";
import {
  DEFAULT_REPORT_SECTIONS,
  parseProjectInput,
  reportOptionsSchema,
  type ReportOptions,
} from "@/lib/validation";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

export interface LoadedReport {
  id: string;
  input: ProjectInput;
  analysis: ProjectAnalysis;
  options: ReportOptions;
  isPublic: boolean;
  shareExpiresAt: Date | null;
  /** expires_at of the token that granted access (null for the owner view) */
  tokenExpiresAt: Date | null;
}

type ProjectRow = typeof projects.$inferSelect;

/** Placeholder document used when a stored payload cannot be parsed. */
function fallbackInput(): ProjectInput {
  return {
    meta: {
      name: "پروژه بدون نام",
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

export function buildLoadedReport(row: ProjectRow, tokenExpiresAt: Date | null = null): LoadedReport {
  // Defensive parsing: stored payloads were validated on write, but a legacy or
  // corrupted row must never crash the page.
  let input: ProjectInput;
  try {
    input = parseProjectInput(row.input ?? {});
  } catch {
    input = fallbackInput();
  }

  const analysis = analyzeProject(input);

  let options: ReportOptions;
  try {
    options = reportOptionsSchema.parse(row.reportOptions ?? {});
  } catch {
    options = {
      sections: DEFAULT_REPORT_SECTIONS,
      includeNotes: true,
      includeGanttDependencyArrows: true,
      ganttScale: "day",
      theme: "print",
    };
  }

  return {
    id: row.id,
    input,
    analysis,
    options,
    isPublic: row.isPublic,
    shareExpiresAt: row.shareExpiresAt,
    tokenExpiresAt,
  };
}

export async function loadOwnedReport(id: string): Promise<LoadedReport | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  return row ? buildLoadedReport(row) : null;
}

/**
 * Loads a project through a share token. Returns `null` for unknown, revoked or
 * expired tokens — the caller answers 404 in every case, so the response never
 * reveals which of the three happened.
 */
export async function loadSharedReport(token: string): Promise<LoadedReport | null> {
  const resolved = await resolveShareToken(token);
  if (!resolved) return null;

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, resolved.projectId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const tokenRows = await db
    .select({ expiresAt: projectShareTokens.expiresAt })
    .from(projectShareTokens)
    .where(eq(projectShareTokens.id, resolved.tokenId))
    .limit(1);

  return buildLoadedReport(row, tokenRows[0]?.expiresAt ?? null);
}
