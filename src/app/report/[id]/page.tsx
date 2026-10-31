import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { ReportView } from "@/components/report/ReportView";
import { getCurrentUser, getGuestToken, isProjectOwner } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/http";
import { buildLoadedReport } from "@/lib/server/report-loader";

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
   * Access rule: **owner only**.
   *
   * This route used to serve any published project to anyone who knew the UUID.
   * A UUID is an identifier, not a credential, so shared viewing now happens
   * exclusively through `/s/<token>` (see `lib/server/share-token.ts`). The
   * owner still lands here after saving, and a shared visitor who guesses this
   * URL gets a 404 — the project's existence is never confirmed.
   */
  if (!isOwner) notFound();

  const report = buildLoadedReport(row);

  return (
    <ReportView
      projectId={report.id}
      project={report.input}
      analysis={report.analysis}
      options={report.options}
      isPublic={report.isPublic}
      shareExpiresAt={report.shareExpiresAt ? report.shareExpiresAt.toISOString() : null}
      canManage
    />
  );
}
