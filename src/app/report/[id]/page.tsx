import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { DEFAULT_REPORT_SECTIONS, parseProjectInput, reportOptionsSchema, type ReportOptions } from "@/lib/validation";
import { ReportView } from "@/components/report/ReportView";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/http";
import type { ProjectInput } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

/**
 * Shared report pages are deliberately excluded from search engines: a project
 * report contains client, contract and cost information that must not end up in
 * a search index.
 */
export const metadata: Metadata = {
  title: "گزارش مدیریت پروژه",
  description: "گزارش حرفه‌ای، آماده چاپ و ارائه به کارفرما",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  if (!row) notFound();

  const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
  const isOwner = isProjectOwner(row, { user, guestToken });

  /**
   * Access rules:
   *  • the owner always has access;
   *  • everyone else needs an explicitly published project whose share link
   *    has not expired. The UUID alone is an identifier, never a credential.
   */
  // Server component: the page is rendered per request, so reading the clock
  // here is intentional (and never causes a hydration mismatch).
  // eslint-disable-next-line react-hooks/purity
  const shareExpired = row.shareExpiresAt !== null && row.shareExpiresAt.getTime() <= Date.now();
  const shareable = row.isPublic && !shareExpired;
  if (!isOwner && !shareable) notFound();

  // Defensive parsing: stored payloads were validated on write, but a legacy or
  // corrupted row must never crash the page.
  let input: ProjectInput;
  try {
    input = parseProjectInput(row.input ?? {});
  } catch {
    input = {
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

  return (
    <ReportView
      projectId={row.id}
      project={input}
      analysis={analysis}
      options={options}
      isPublic={row.isPublic}
      shareExpiresAt={row.shareExpiresAt ? row.shareExpiresAt.toISOString() : null}
      canManage={isOwner}
    />
  );
}
