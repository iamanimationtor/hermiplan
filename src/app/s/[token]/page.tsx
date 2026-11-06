import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report/ReportView";
import { loadSharedReport } from "@/lib/server/report-loader";
import { checkRateLimit, RATE_RULES } from "@/lib/server/rate-limit";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Shared report entry point — `/s/<token>`.
 *
 * The token is the credential: 256 bits from a CSPRNG, stored only as a SHA-256
 * digest, revocable by the owner and optionally expiring. Unknown, revoked and
 * expired tokens all answer the same 404 so the response carries no information
 * about the project.
 */
export const metadata: Metadata = {
  title: "گزارش مدیریت پروژه",
  description: "گزارش حرفه‌ای، آماده چاپ و ارائه به کارفرما",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // A random-looking 404 for malformed tokens: no database round trip and no
  // hint that the URL shape is wrong.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();

  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "local";
  // Scope must match `PRODUCT_QUOTA_KEYS` so `open` access mode can lift it.
  const limited = await checkRateLimit(`shareRead:ip:${ip}`, RATE_RULES.shareRead);
  if (!limited.allowed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-lg font-bold text-ink-900">تعداد بازدیدهای این لینک بیش از حد مجاز است</h1>
        <p className="mt-2 text-sm text-slate-600">لطفاً چند دقیقه دیگر دوباره تلاش کنید.</p>
      </main>
    );
  }

  const report = await loadSharedReport(token);
  if (!report) notFound();

  return (
    <ReportView
      projectId={report.id}
      project={report.input}
      analysis={report.analysis}
      options={report.options}
      isPublic
      shareExpiresAt={report.tokenExpiresAt ? report.tokenExpiresAt.toISOString() : null}
      canManage={false}
      shared
    />
  );
}
