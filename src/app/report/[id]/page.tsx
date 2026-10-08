import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { analyzeProject } from "@/lib/engine/analysis";
import { DEFAULT_REPORT_SECTIONS, parseProjectInput, reportOptionsSchema, type ReportOptions } from "@/lib/validation";
import { ReportView } from "@/components/report/ReportView";
import { getCurrentUser, getGuestToken } from "@/lib/server/auth";
import type { ProjectInput } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "گزارش مدیریت پروژه",
  description: "گزارش حرفه‌ای، آماده چاپ و ارائه به کارفرما",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  if (!row) notFound();

  // A public row renders a shareable report; private rows require ownership.
  if (!row.isPublic) {
    const [user, guestToken] = await Promise.all([getCurrentUser(), getGuestToken()]);
    const owner = (user && row.ownerUserId === user.id) || (guestToken && row.guestToken === guestToken);
    if (!owner) notFound();
  }

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
      canManage={Boolean(row.guestToken || row.ownerUserId)}
    />
  );
}
