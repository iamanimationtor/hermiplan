"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart, GanttChart, HealthGauge, NetworkDiagram, ResourceHistogram } from "@/components/charts";
import { Badge, Button } from "@/components/ui";
import { EXPORT_FORMATS, REPORT_SECTIONS, type ReportOptions } from "@/lib/validation";
import { describeShareState } from "@/lib/share-status";
import { Modal } from "@/components/ui";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import { formatCompact, formatCurrency, formatJalali, formatNumber, formatPercent, toPersianDigits } from "@/lib/date-fa";

/**
 * Order in which the numbered sections are rendered. Section numbers only count
 * the sections the user kept enabled, so numbering stays contiguous.
 */
const SECTION_RENDER_ORDER = [
  "executive",
  "info",
  "kpis",
  "wbs",
  "activities",
  "schedule",
  "gantt",
  "critical",
  "milestones",
  "network",
  "progress",
  "resources",
  "costs",
  "pricing",
  "risks",
  "delays",
  "baseline",
  "status",
  "standards",
  "signature",
] as const;

const CONSTRAINT_NAMES: Record<string, string> = {
  ASAP: "بدون محدودیت",
  SNET: "شروع نه زودتر از",
  MSO: "باید در تاریخ شروع شود",
  FF: "پایان تا پایان",
  FNLT: "پایان نه دیرتر از",
};

/** Constraint cell: type + date, with an explicit conflict marker. */
function constraintCell(activity: ProjectAnalysis["activities"][number]): string {
  const constraint = activity.constraint;
  if (!constraint || constraint.type === "ASAP") return "—";
  const name = CONSTRAINT_NAMES[constraint.type] ?? constraint.type;
  const date = constraint.date ? ` ${constraint.date}` : "";
  if (constraint.conflict) return `⚠ ${name}${date} — ${constraint.conflict}`;
  return `${name}${date}`;
}

/** Signed working-day value, e.g. "+2", "−1", "0". */
function signedDays(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "۰";
  return `${value > 0 ? "+" : "−"}${toPersianDigits(Math.abs(value))}`;
}

const STATUS_LABELS: Record<ProjectAnalysis["status"], { label: string; tone: string; hint: string }> = {
  valid: {
    label: "تحلیل معتبر",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    hint: "همه فعالیت‌ها زمان‌بندی شدند و هیچ خطا یا هشداری وجود ندارد.",
  },
  warning: {
    label: "تحلیل معتبر همراه با هشدار",
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    hint: "زمان‌بندی محاسبه شده است اما مواردی نیاز به بازبینی دارند.",
  },
  inconsistent: {
    label: "زمان‌بندی ناسازگار",
    tone: "border-orange-300 bg-orange-50 text-orange-900",
    hint: "محدودیت‌های زمانی و منطق شبکه با هم قابل اجرا نیستند؛ شناوری منفی نشانه این تعارض است.",
  },
  invalid: {
    label: "تحلیل نامعتبر",
    tone: "border-red-300 bg-red-50 text-red-900",
    hint: "گراف وابستگی یا داده ورودی معتبر نیست؛ اعداد این گزارش قابل استناد نیستند.",
  },
  "internal-error": {
    label: "خطای داخلی محاسبات",
    tone: "border-red-400 bg-red-50 text-red-900",
    hint: "موتور محاسباتی با خطای غیرمنتظره متوقف شد؛ نتیجه‌ای تولید نشده است.",
  },
};

const TYPE_LABELS: Record<string, string> = {
  construction: "ساختمان (مسکونی / اداری)",
  civil: "پل و راه (مهندسی عمران)",
  architecture: "طراحی معماری",
  infrastructure: "زیرساخت (آب / برق / شبکه)",
  software: "توسعه نرم‌افزار",
  manufacturing: "تولید و صنعت",
  research: "پژوهش",
  event: "رویداد",
  general: "پروژه عمومی",
};

function SectionTitle({ index, title, subtitle }: { index: number; title: string; subtitle?: string }) {
  return (
    <div className="rpt-section-title">
      <span className="index">{toPersianDigits(index)}</span>
      <div>
        <h2 className="text-[15px] font-extrabold leading-6">{title}</h2>
        {subtitle ? <p className="text-[10px] font-normal text-slate-500">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function DataTable({ headers, rows, footer }: { headers: string[]; rows: (string | number)[][]; footer?: (string | number)[] }) {
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td colSpan={headers.length} className="text-center text-slate-500">
              داده‌ای برای نمایش وجود ندارد.
            </td>
          </tr>
        ) : null}
      </tbody>
      {footer ? (
        <tfoot>
          <tr>
            {footer.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

export function ReportView({
  projectId,
  project,
  analysis,
  options,
  isPublic = false,
  shareExpiresAt = null,
  canManage = false,
  shared = false,
}: {
  projectId: string;
  project: ProjectInput;
  analysis: ProjectAnalysis;
  options: ReportOptions;
  isPublic?: boolean;
  /** ISO timestamp after which the public link stops working (null = no expiry). */
  shareExpiresAt?: string | null;
  canManage?: boolean;
  /** true when the page was opened through a share token (`/s/…`) */
  shared?: boolean;
}) {
  const [sections, setSections] = useState<string[]>(options.sections);
  const has = (key: string) => sections.includes(key);
  const ordered = REPORT_SECTIONS.filter((s) => sections.includes(s.key));
  const [printing, setPrinting] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLinks, setShareLinks] = useState<
    { id: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null; useCount: number; active: boolean }[]
  >([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  /* ------------------------- revision history ------------------------- */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyCurrent, setHistoryCurrent] = useState<number | null>(null);
  const [versions, setVersions] = useState<
    { version: number; reason: string; reasonLabel: string; createdAt: string; sizeBytes: number; activities: number; isCurrent: boolean }[]
  >([]);

  /**
   * One source of truth for "is this report shared, private, or was it shared
   * before tokens existed". The badge and the panel both read it, so they cannot
   * tell the owner two different stories.
   */
  const shareState = describeShareState(isPublic, shareLinks);

  /**
   * Share links are managed server-side (hashed token, revocable). The plaintext
   * link is shown exactly once, immediately after creation, and is never stored
   * in the browser or in the database.
   */
  async function loadShares() {
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { tokens?: typeof shareLinks };
      setShareLinks(data.tokens ?? []);
    } catch {
      /* a failed refresh leaves the last known list; no invented state */
    }
  }

  async function createShare() {
    if (!canManage) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setShareError(body.error ?? "ساخت لینک ناموفق بود");
        return;
      }
      const data = (await response.json()) as { url?: string };
      setFreshLink(data.url ?? null);
      await loadShares();
    } catch {
      setShareError("ساخت لینک ناموفق بود");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShare(tokenId?: string) {
    if (!canManage) return;
    setShareBusy(true);
    try {
      const query = tokenId ? `?tokenId=${encodeURIComponent(tokenId)}` : "?all=1";
      const response = await fetch(`/api/projects/${projectId}/share${query}`, { method: "DELETE" });
      if (response.ok) {
        setFreshLink(null);
        await loadShares();
      } else {
        setShareError("ابطال لینک ناموفق بود");
      }
    } catch {
      setShareError("ابطال لینک ناموفق بود");
    } finally {
      setShareBusy(false);
    }
  }

  /**
   * Revision history. Restoring never deletes anything: the server snapshots the
   * state being replaced, so the owner can walk back again if the restore itself
   * was a mistake. The interface says so before the click.
   */
  async function loadVersions() {
    try {
      const response = await fetch(`/api/projects/${projectId}/versions`, { cache: "no-store" });
      if (!response.ok) {
        setHistoryError(response.status === 404 ? "تاریخچه در دسترس نیست" : "بارگذاری تاریخچه ناموفق بود");
        return;
      }
      const data = (await response.json()) as { versions?: typeof versions; currentVersion?: number };
      setVersions(data.versions ?? []);
      setHistoryCurrent(data.currentVersion ?? null);
    } catch {
      setHistoryError("بارگذاری تاریخچه ناموفق بود");
    }
  }

  async function restoreVersion(version: number) {
    if (!canManage) return;
    setHistoryBusy(true);
    setHistoryError(null);
    setHistoryNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/versions/${version}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: historyCurrent ?? undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setHistoryError(body.error ?? "بازگردانی ناموفق بود");
        return;
      }
      const data = (await response.json()) as { version?: number; restoredFrom?: number };
      setHistoryNotice(`نسخه ${toPersianDigits(String(data.restoredFrom ?? version))} بازگردانی شد؛ نسخه تازه ${toPersianDigits(String(data.version ?? ""))} است. صفحه بازخوانی می‌شود.`);
      await loadVersions();
      window.setTimeout(() => window.location.reload(), 1200);
    } catch {
      setHistoryError("بازگردانی ناموفق بود");
    } finally {
      setHistoryBusy(false);
    }
  }

  function toggleHistoryPanel() {
    const next = !historyOpen;
    setHistoryOpen(next);
    setHistoryError(null);
    if (next) void loadVersions();
  }

  /** Opening the panel is also the moment the link list is refreshed. */
  function toggleSharePanel() {
    setShareOpen((open) => {
      if (!open) void loadShares();
      return !open;
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    // `deliver=1` is a one-shot deep link into the download centre. It is read
    // after mount because the server render has no access to the query string;
    // setting state here is deliberate and runs at most once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get("deliver") === "1") setDownloadOpen(true);
  }, []);

  async function download(formatId: string) {
    setBusyFormat(formatId);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          format: formatId,
          reportUrl: typeof window !== "undefined" ? window.location.href : "",
        }),
      });
      if (!response.ok) throw new Error("failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (formatId === "pdf") {
        const win = window.open(url, "_blank");
        window.setTimeout(() => {
          try {
            win?.print();
          } catch {
            /* popup blocked — user can print manually */
          }
        }, 1200);
        return;
      }
      const format = EXPORT_FORMATS.find((f) => f.id === formatId);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `HERMIPLAN-${project.meta.name || "project"}.${format?.ext ?? "txt"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      window.alert("دریافت فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.");
    } finally {
      setBusyFormat(null);
    }
  }

  const links = useMemo(
    () =>
      project.activities.flatMap((activity) =>
        activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
      ),
    [project.activities],
  );

  const a = analysis;
  const currency = project.meta.currency;
  const reportDate = formatJalali(project.meta.statusDate);
  const number = (value: number) => (currency === "IRR" ? formatCompact(value) : formatNumber(value));
  const money = (value: number) => formatCurrency(value, currency);

  /**
   * Section numbers follow the *rendered* order, not the catalogue order: only
   * sections the user kept enabled are numbered, and they stay contiguous.
   */
  const sectionNumber = (key: (typeof SECTION_RENDER_ORDER)[number]) => SECTION_RENDER_ORDER.filter((k) => has(k)).indexOf(key) + 1;

  const totalSheets = 5;

  const statusText = a.health.status === "good" ? "در وضعیت مطلوب" : a.health.status === "watch" ? "نیازمند پایش" : "در وضعیت بحرانی";

  return (
    <div>
      {/* --------------------------- toolbar --------------------------- */}
      <a
        href="#report-main"
        className="no-print sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-[13px] focus:font-bold focus:text-white"
      >
        پرش به محتوای گزارش
      </a>
      <div className="no-print sticky top-0 z-30 border-b border-slate-200/70 glass">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <Link href="/builder" aria-label="HERMIPLAN" className="shrink-0">
            <span className="hidden sm:inline-flex"><Logo tagline="Project Report" /></span>
            <span className="sm:hidden"><LogoMark size="sm" /></span>
          </Link>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-bold text-ink-900">{project.meta.name}</p>
            <p className="truncate text-[10.5px] text-slate-500">
              گزارش مدیریت پروژه · شناسه {projectId.slice(0, 8).toUpperCase()} · نرخ {a.pricing.asOfJalali}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => download("xlsx")} disabled={busyFormat !== null} className="hidden sm:inline-flex">
            Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={copyLink} className="hidden sm:inline-flex">
            {copied ? "✓ کپی شد" : "کپی لینک"}
          </Button>
          {canManage ? (
              <Button
              variant="secondary"
              size="sm"
              onClick={toggleSharePanel}
              title={shareState.hint}
            >
              {shareState.badge}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleHistoryPanel}
              title="نسخه‌های ذخیره‌شده این پروژه؛ هر نسخه قابل بازگردانی است"
            >
              تاریخچه
            </Button>
          ) : null}
          <Button variant="accent" size="sm" onClick={() => setDownloadOpen(true)}>
            <span className="sm:hidden">خروجی</span>
            <span className="hidden sm:inline">دریافت خروجی (۷ فرمت)</span>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            چاپ / PDF
          </Button>
        </div>
        <div className="thin-scroll mx-auto flex max-w-[1180px] gap-1.5 overflow-x-auto px-3 pb-2.5 sm:px-4">
          {REPORT_SECTIONS.map((section) => {
            const active = has(section.key);
            return (
              <button
                key={section.key}
                type="button"
                onClick={() =>
                  setSections(active ? sections.filter((s) => s !== section.key) : [...sections, section.key])
                }
                className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition ${
                  active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-brand-300"
                }`}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------ share link panel ------------------------ */}
      {canManage && shareOpen ? (
        <div className="no-print mx-auto max-w-[1180px] px-3 pt-3 sm:px-4">
          <div className="hp-card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-ink-900">لینک اشتراک گزارش</p>
                <p className="mt-1 text-[11.5px] leading-6 text-slate-500">
                  شناسه پروژه به‌تنهایی دسترسی نمی‌دهد. هر لینک یک رمز ۲۵۶ بیتی تصادفی است که فقط
                  در همین لحظه یک‌بار نمایش داده می‌شود (در پایگاه داده فقط هش آن ذخیره است) و
                  هر زمان می‌توانید آن را باطل کنید.
                </p>
              </div>
              <Button size="sm" onClick={createShare} disabled={shareBusy}>
                {shareBusy ? "در حال ساخت…" : "ساخت لینک جدید"}
              </Button>
            </div>

            {shareError ? <p className="text-[11.5px] font-semibold text-red-600">{shareError}</p> : null}

            {shareState.notice ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-[11.5px] font-bold text-amber-900">لینک قدیمی این گزارش غیرفعال است</p>
                <p className="mt-1 text-[11px] leading-6 text-amber-900">{shareState.notice}</p>
              </div>
            ) : null}

            {freshLink ? (
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                <p className="text-[11px] font-bold text-brand-800">لینک ساخته شد — فقط همین یک‌بار نمایش داده می‌شود:</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="break-all rounded-lg bg-white px-2 py-1 font-mono text-[11px] text-ink-900">
                    {freshLink}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(freshLink);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? "✓ کپی شد" : "کپی لینک"}
                  </Button>
                </div>
                <p className="mt-1.5 text-[10.5px] text-slate-500">
                  اگر این لینک را گم کردید، لینک دیگری بسازید و این یکی را باطل کنید؛ خودِ لینک قابل بازیابی نیست.
                </p>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-right text-[11px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1 font-semibold">وضعیت</th>
                    <th className="py-1 font-semibold">ساخت</th>
                    <th className="py-1 font-semibold">انقضا</th>
                    <th className="py-1 font-semibold">آخرین بازدید</th>
                    <th className="py-1 font-semibold">بازدید</th>
                    <th className="py-1 font-semibold">اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  {shareLinks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-2 text-slate-400">
                        هنوز لینکی ساخته نشده است؛ گزارش فعلاً فقط برای شما قابل مشاهده است.
                      </td>
                    </tr>
                  ) : (
                    shareLinks.map((link) => (
                      <tr key={link.id} className="border-t border-slate-100">
                        <td className="py-1.5">
                          {link.active ? (
                            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">فعال</span>
                          ) : (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">باطل‌شده</span>
                          )}
                        </td>
                        <td className="py-1.5 text-slate-600">{formatJalali(link.createdAt.slice(0, 10), { withMonthName: false })}</td>
                        <td className="py-1.5 text-slate-600">
                          {link.expiresAt ? formatJalali(link.expiresAt.slice(0, 10), { withMonthName: false }) : "بدون انقضا"}
                        </td>
                        <td className="py-1.5 text-slate-600">
                          {link.lastUsedAt ? formatJalali(link.lastUsedAt.slice(0, 10), { withMonthName: false }) : "—"}
                        </td>
                        <td className="py-1.5 text-slate-600">{toPersianDigits(link.useCount)}</td>
                        <td className="py-1.5">
                          {link.active ? (
                            <button
                              type="button"
                              onClick={() => revokeShare(link.id)}
                              disabled={shareBusy}
                              className="rounded-md border border-red-200 px-2 py-0.5 text-[10.5px] font-semibold text-red-600 hover:bg-red-50"
                            >
                              ابطال
                            </button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {shareLinks.some((link) => link.active) ? (
              <button
                type="button"
                onClick={() => revokeShare()}
                disabled={shareBusy}
                className="text-[11px] font-semibold text-red-600 hover:underline"
              >
                ابطال همه لینک‌ها (گزارش دوباره خصوصی می‌شود)
              </button>
            ) : null}
            {shareExpiresAt ? (
              <p className="text-[10.5px] text-slate-500">
                آخرین انقضای ثبت‌شده روی پروژه: {formatJalali(shareExpiresAt.slice(0, 10))}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ------------------------- revision history ------------------------- */}
      {canManage && historyOpen ? (
        <div className="mx-auto max-w-[1180px] px-3 pt-3 sm:px-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-ink-900">تاریخچه نسخه‌ها</p>
                <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
                  هر ذخیره، یک نسخه نگه می‌دارد. بازگردانی چیزی را پاک نمی‌کند: وضعیت فعلی هم پیش از
                  بازگردانی به‌عنوان یک نسخه ذخیره می‌شود و بعداً قابل بازگشت است.
                </p>
              </div>
              {historyCurrent ? (
                <Badge tone="neutral">نسخه فعلی: {toPersianDigits(String(historyCurrent))}</Badge>
              ) : null}
            </div>

            {historyError ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-semibold text-red-700">{historyError}</p>
            ) : null}
            {historyNotice ? (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11.5px] font-semibold text-emerald-800">{historyNotice}</p>
            ) : null}

            <div className="thin-scroll mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-right text-[11.5px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 font-semibold">نسخه</th>
                    <th className="py-1.5 font-semibold">علت</th>
                    <th className="py-1.5 font-semibold">زمان (شمسی)</th>
                    <th className="py-1.5 font-semibold">فعالیت</th>
                    <th className="py-1.5 font-semibold">حجم</th>
                    <th className="py-1.5 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-3 text-center text-slate-400">
                        {historyBusy ? "در حال بارگذاری…" : "هنوز نسخه‌ای ثبت نشده است"}
                      </td>
                    </tr>
                  ) : null}
                  {versions.map((version) => (
                    <tr key={version.version} className={version.isCurrent ? "bg-brand-50/40" : ""}>
                      <td className="py-1.5 font-mono font-semibold text-ink-900">
                        {toPersianDigits(String(version.version))}
                        {version.isCurrent ? <span className="mr-1 text-[10px] text-emerald-700">جاری</span> : null}
                      </td>
                      <td className="py-1.5 text-slate-600">{version.reasonLabel}</td>
                      <td className="py-1.5 text-slate-600">
                        {formatJalali(version.createdAt.slice(0, 10), { withMonthName: false })}
                        <span className="mr-1 font-mono text-[10px] text-slate-400">{version.createdAt.slice(11, 16)}</span>
                      </td>
                      <td className="py-1.5 text-slate-600">{toPersianDigits(String(version.activities))}</td>
                      <td className="py-1.5 text-slate-500">{formatNumber(Math.max(1, Math.round(version.sizeBytes / 1024)))} KB</td>
                      <td className="py-1.5 text-left">
                        {version.isCurrent ? (
                          <span className="text-[10.5px] text-slate-400">—</span>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => restoreVersion(version.version)}
                            disabled={historyBusy}
                            title={`بازگردانی نسخه ${version.version}`}
                          >
                            بازگردانی
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {shared ? (
        <div className="mx-auto max-w-[1180px] px-3 pt-3 sm:px-4">
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            این گزارش از طریق یک لینک اشتراک نمایش داده می‌شود؛ دسترسی شما فقط‌خواندنی است و صاحب
            گزارش می‌تواند همین لینک را در هر لحظه باطل کند.
          </p>
        </div>
      ) : null}

      {/* -------------------------- download center -------------------------- */}
      <Modal open={downloadOpen} onClose={() => setDownloadOpen(false)} title="مرکز دریافت خروجی" wide>
        <div className="space-y-4">
          <p className="text-[12.5px] leading-7 text-slate-500">
            خروجی‌های حرفه‌ای HERMIPLAN برای ارائه، بایگانی و تبادل با نرم‌افزارهای دیگر آماده است.
            برای PDF، فایل «گزارش HTML» را دریافت کنید، در مرورگر باز کنید و <b>Ctrl+P → Save as PDF</b> بزنید؛
            خروجی برداری (Vector) با صفحه‌بندی A4 و سرستون‌های تکرارشونده تولید می‌شود.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPORT_FORMATS.map((format) => (
              <button
                key={format.id}
                type="button"
                onClick={() => download(format.id)}
                disabled={busyFormat !== null}
                className={`hp-card hp-card-hover flex items-start justify-between gap-3 p-3.5 text-right disabled:opacity-60 ${
                  busyFormat === format.id ? "border-brand-400" : ""
                }`}
              >
                <span>
                  <span className="block text-[13px] font-bold text-ink-900">{format.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">{format.hint}</span>
                </span>
                <span className="mt-0.5 rounded-lg bg-brand-50 px-2 py-1 font-mono text-[10.5px] font-bold text-brand-700">
                  .{format.ext}
                </span>
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11.5px] leading-6 text-slate-500">
            <p className="font-bold text-ink-900">محتوای بسته کامل (ZIP)</p>
            <p className="mt-1">
              گزارش HTML قابل چاپ + کارپوشه اکسل چندشییتی (اطلاعات، فعالیت‌ها، زمان‌بندی، منابع، هزینه، تعدیل، ریسک و استانداردها) + فایل Microsoft Project + داده JSON + CSV.
            </p>
          </div>
        </div>
      </Modal>

      {/* ---------------------------- report ---------------------------- */}
      <div id="report-main" className="report-root px-3 py-6 print:p-0" dir="rtl">
        {/* ------------------------- SHEET 1: cover ------------------------ */}
        <section className="report-sheet">
          <div className="report-watermark">HERMIPLAN</div>
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between border-b-2 border-brand-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <LogoMark size="sm" />
                  <p className="text-[10px] font-bold tracking-[0.3em] text-brand-700">HERMIPLAN</p>
                </div>
                <h1 className="mt-2 text-[26px] font-black leading-tight text-brand-900">گزارش مدیریت، زمان‌بندی و کنترل پروژه</h1>
                <p className="mt-1 text-[11px] text-slate-500">Project Management & Control Report</p>
              </div>
              <div className="text-left text-[10px] text-slate-500">
                <p>تاریخ گزارش: {reportDate}</p>
                <p>شناسه: {projectId.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>

            <div className="mt-10 flex flex-1 flex-col justify-center">
              <p className="text-[11px] font-semibold text-slate-500">عنوان پروژه</p>
              <h2 className="mt-2 text-[30px] font-black leading-tight text-ink-900">{project.meta.name}</h2>
              <p className="mt-3 text-[13px] text-brand-700">{TYPE_LABELS[project.meta.type] ?? project.meta.type}</p>
              {project.meta.description ? (
                <p className="mt-4 max-w-[85%] text-[11.5px] leading-7 text-slate-600">{project.meta.description}</p>
              ) : null}

              <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-2 text-[11.5px] md:grid-cols-3">
                {[
                  ["کارفرما", project.meta.client],
                  ["پیمانکار", project.meta.contractor],
                  ["مشاور / ناظر", project.meta.consultant],
                  ["مدیر پروژه", project.meta.manager],
                  ["موقعیت", project.meta.location],
                  ["کد پروژه", project.meta.code],
                  ["تاریخ شروع", formatJalali(a.schedule.startDate)],
                  ["تاریخ پایان (پیش‌بینی)", formatJalali(a.schedule.finishDate)],
                  ["مدت اجرا", `${toPersianDigits(a.schedule.workingDays)} روز کاری`],
                ]
                  .filter(([, value]) => Boolean(value))
                  .map(([label, value]) => (
                    <div key={label} className="border-b border-dashed border-slate-200 py-1.5">
                      <span className="block text-[9.5px] text-slate-500">{label}</span>
                      <span className="font-semibold text-ink-900">{value}</span>
                    </div>
                  ))}
              </div>

              <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  ["پیشرفت زمان‌محور (وزن: مدت)", formatPercent(a.progress.timeBased, 1)],
                  [
                    a.progress.physical === null ? "پیشرفت فیزیکی (اندازه‌گیری‌نشده)" : "پیشرفت فیزیکی (وزن: مقدار اجرا)",
                    a.progress.physical === null ? "—" : formatPercent(a.progress.physical, 1),
                  ],
                  [
                    a.progress.financial === null ? "پیشرفت مالی (بدون بودجه)" : "پیشرفت مالی (EV ÷ BAC)",
                    a.progress.financial === null ? "—" : formatPercent(a.progress.financial, 1),
                  ],
                  ["بودجه تجمیعی", number(a.costs.budget)],
                  ["فعالیت‌ها", toPersianDigits(a.activities.length)],
                  ["وضعیت پروژه", statusText],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-center">
                    <p className="text-[9.5px] text-slate-500">{label}</p>
                    <p className="mt-1 text-[14px] font-extrabold text-brand-800">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-10 flex items-end justify-between border-t border-slate-200 pt-4 text-[9.5px] text-slate-500">
              <span>HERMIPLAN — Project Intelligence Platform</span>
              <span>Created by Mohammad Shirmardi</span>
            </div>
          </div>
          <div className="rpt-sheet-number">
            <span>صفحه ۱ از {toPersianDigits(totalSheets)}</span>
            <span>{project.meta.name}</span>
          </div>
        </section>

        {/* -------------------- SHEET 2: summary & info -------------------- */}
        <section className="report-sheet">
          {has("executive") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("executive")} title="خلاصه مدیریتی (Executive Summary)" subtitle="جمع‌بندی خودکار وضعیت پروژه بر اساس شاخص‌های محاسباتی" />
              {(() => {
                const status = STATUS_LABELS[a.status] ?? STATUS_LABELS.valid;
                return (
                  <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] leading-6 ${status.tone}`}>
                    <b>{status.label}</b> — {status.hint}
                  </div>
                );
              })()}
              {a.diagnostics.length || a.unschedulable.length ? (
                <div className="mb-3 rounded-lg border border-slate-200 bg-white">
                  <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold text-ink-900">
                    هشدارها و خطاهای تحلیل ({toPersianDigits(a.diagnostics.length)})
                  </p>
                  <ul className="thin-scroll max-h-[220px] space-y-1.5 overflow-y-auto px-3 py-2 text-[10.5px] leading-6">
                    {a.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${index}`} className="flex gap-2">
                        <span
                          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                            diagnostic.severity === "error" ? "bg-red-500" : "bg-amber-400"
                          }`}
                        />
                        <span className={diagnostic.severity === "error" ? "text-red-800" : "text-slate-700"}>
                          {diagnostic.message}
                          {diagnostic.remedy ? (
                            <span className="block text-[10px] text-slate-500">راه‌حل: {diagnostic.remedy}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                    {a.unschedulable.map((item) => (
                      <li key={item.id} className="flex gap-2">
                        <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                        <span className="text-red-800">
                          «{item.name}» ({item.code}) زمان‌بندی نشد: {item.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap items-start gap-6">
                <div className="min-w-[260px] flex-1">
                  <div className="rpt-callout">
                    <p className="text-[12px] font-bold text-brand-900">{a.summary.headline}</p>
                  </div>
                  <ul className="mt-3 space-y-2 text-[11px] leading-7 text-slate-700">
                    {a.summary.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="text-center">
                  <HealthGauge score={a.health.score} status={a.health.status} />
                  <p className="mt-1 text-[10.5px] font-semibold text-slate-500">امتیاز سلامت پروژه</p>
                  <p className="mt-3 text-[11px] font-bold text-slate-700">{statusText}</p>
                </div>
              </div>
            </div>
          ) : null}

          {has("info") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("info")} title="مشخصات پروژه (Project Information)" />
              <table className="rpt-kv">
                <tbody>
                  {[
                    ["نام پروژه", project.meta.name],
                    ["کد / شماره قرارداد", project.meta.code || "—"],
                    ["نوع پروژه", TYPE_LABELS[project.meta.type] ?? project.meta.type],
                    ["کارفرما", project.meta.client || "—"],
                    ["پیمانکار", project.meta.contractor || "—"],
                    ["مشاور / دستگاه نظارت", project.meta.consultant || "—"],
                    ["مدیر پروژه", project.meta.manager || "—"],
                    ["موقعیت", project.meta.location || "—"],
                    ["تاریخ شروع", formatJalali(a.schedule.startDate)],
                    ["تاریخ پایان پیش‌بینی‌شده", formatJalali(a.schedule.finishDate)],
                    [
                      "تاریخ هدف پایان (قراردادی)",
                      a.schedule.deadline
                        ? `${formatJalali(a.schedule.deadline)} — ${
                            a.schedule.deadlineMet
                              ? `قابل تحقق (${toPersianDigits(a.schedule.deadlineVarianceDays ?? 0)} روز کاری پیش‌نمونه)`
                              : `غیرقابل تحقق (${toPersianDigits(Math.abs(a.schedule.deadlineVarianceDays ?? 0))} روز کاری تأخیر)`
                          }`
                        : "—",
                    ],
                    ["تاریخ وضعیت (Data Date)", formatJalali(project.meta.statusDate)],
                    ["مدت پروژه", `${toPersianDigits(a.schedule.workingDays)} روز کاری / ${toPersianDigits(a.schedule.calendarDays)} روز تقویمی`],
                    ["تقویم کاری", `${toPersianDigits(a.schedule.workDayCount)} روز در هفته · ${toPersianDigits(a.schedule.hoursPerDay)} ساعت در روز · ${toPersianDigits(a.schedule.holidayCount)} روز تعطیل`],
                    ["واحد پول", currency === "IRR" ? "ریال (IRR)" : currency === "USD" ? "دلار (USD)" : "یورو (EUR)"],
                    ["بودجه مصوب", project.meta.budget ? money(project.meta.budget) : "—"],
                    ["تعداد فاز / فعالیت", `${toPersianDigits(a.schedule.phases.length)} فاز / ${toPersianDigits(a.activities.length)} فعالیت`],
                    ["نقاط کنترل (Milestone)", toPersianDigits(a.milestones.length)],
                    ["منابع تعریف‌شده", toPersianDigits(a.resources.length)],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="k">{label}</td>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {has("kpis") ? (
            <div className="rpt-section">
              <SectionTitle index={sectionNumber("kpis")} title="شاخص‌های کلیدی عملکرد (KPIs)" />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {a.kpis.map((kpi) => (
                  <div
                    key={kpi.key}
                    className="rpt-avoid-break rounded-lg border p-3"
                    style={{
                      borderColor: kpi.status === "good" ? "#a7f3d0" : kpi.status === "watch" ? "#fde68a" : "#fecaca",
                      background: kpi.status === "good" ? "#f0fdf4" : kpi.status === "watch" ? "#fffbeb" : "#fef2f2",
                    }}
                  >
                    <p className="text-[9.5px] font-semibold text-slate-500">{kpi.label}</p>
                    <p className="mt-1 text-[15px] font-extrabold text-ink-900">
                      {kpi.key === "finish" ? formatJalali(kpi.value, { withMonthName: false }) : kpi.value}
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-slate-500">{kpi.hint}</p>
                  </div>
                ))}
              </div>
              <p className="rpt-note">
                شاخص‌ها بر پایه روش تحلیل ارزش کسب‌شده (Earned Value Management) و الگوریتم مسیر بحرانی (CPM) محاسبه شده‌اند.
              </p>
            </div>
          ) : null}
          <div className="rpt-sheet-number">
            <span>صفحه ۲ از {toPersianDigits(totalSheets)}</span>
            <span>خلاصه مدیریتی و مشخصات پروژه</span>
          </div>
        </section>

        {/* -------------------- SHEET 3: planning -------------------- */}
        <section className="report-sheet">
          {has("wbs") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("wbs")} title="ساختار شکست کار (WBS)" subtitle="سلسله‌مراتب فازها و فعالیت‌های پروژه" />
              <table className="rpt-table">
                <thead>
                  <tr>
                    <th style={{ width: "12%" }}>کد WBS</th>
                    <th>شرح</th>
                    <th style={{ width: "9%" }}>مدت (روز)</th>
                    <th style={{ width: "12%" }}>شروع</th>
                    <th style={{ width: "12%" }}>پایان</th>
                    <th style={{ width: "10%" }}>پیشرفت</th>
                    <th style={{ width: "14%" }}>بودجه</th>
                  </tr>
                </thead>
                <tbody>
                  {a.wbs.map((phase) => (
                    [
                      <tr key={phase.id} style={{ background: "#e8eef4", fontWeight: 700 }}>
                        <td>
                          <strong>{phase.wbs}</strong>
                        </td>
                        <td>
                          <strong>{phase.name}</strong>
                        </td>
                        <td>{toPersianDigits(phase.duration ?? 0)}</td>
                        <td>{formatJalali(phase.startDate ?? a.schedule.startDate, { withMonthName: false })}</td>
                        <td>{formatJalali(phase.finishDate ?? a.schedule.finishDate, { withMonthName: false })}</td>
                        <td>{formatPercent(phase.progress ?? 0, 0)}</td>
                        <td>{number(phase.budget ?? 0)}</td>
                      </tr>,
                      ...phase.children.map((child) => (
                        <tr key={child.id}>
                          <td style={{ paddingInlineStart: "22px" }}>{child.wbs}</td>
                          <td style={{ paddingInlineStart: "22px" }}>{child.name}</td>
                          <td>{toPersianDigits(child.duration ?? 0)}</td>
                          <td>{formatJalali(child.startDate ?? "", { withMonthName: false })}</td>
                          <td>{formatJalali(child.finishDate ?? "", { withMonthName: false })}</td>
                          <td>{formatPercent(child.progress ?? 0, 0)}</td>
                          <td>{number(child.budget ?? 0)}</td>
                        </tr>
                      )),
                    ]
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {has("activities") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("activities")} title="فهرست فعالیت‌ها (Activity List)" />
              <DataTable
                headers={["کد", "عنوان فعالیت", "فاز", "مدت", "تاریخ شروع", "تاریخ پایان", "پیشرفت اعلامی", "محدودیت", "منابع", "بودجه"]}
                rows={a.activities.map((act) => [
                  act.code,
                  act.name,
                  act.phase,
                  toPersianDigits(act.duration),
                  formatJalali(act.startDate, { withMonthName: false }),
                  formatJalali(act.finishDate, { withMonthName: false }),
                  formatPercent(act.progress, 0),
                  constraintCell(act),
                  act.resourceNames.join("، ") || "—",
                  number(act.budgetCost),
                ])}
                footer={["", "جمع کل", `${toPersianDigits(a.activities.length)} فعالیت`, toPersianDigits(a.schedule.workingDays), "", "", formatPercent(a.progress.overall, 1), "", "", number(a.costs.budget)]}
              />
              {options.includeNotes && a.activities.some((act) => act.milestone) ? (
                <p className="rpt-note">فعالیت‌های با مدت صفر، نقاط کنترل (Milestone) پروژه هستند.</p>
              ) : null}
            </div>
          ) : null}

          {has("schedule") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("schedule")} title="زمان‌بندی و شناوری فعالیت‌ها (Schedule & Float)" subtitle="محاسبه‌شده بر اساس الگوریتم CPM با تقویم کاری پروژه" />
              <DataTable
                headers={["کد", "فعالیت", "زودترین شروع", "زودترین پایان", "دیرترین شروع", "دیرترین پایان", "شناوری کل", "شناوری آزاد", "بحرانی", "محدودیت"]}
                rows={a.activities.map((act) => [
                  act.code,
                  act.name,
                  formatJalali(act.startDate, { withMonthName: false }),
                  formatJalali(act.finishDate, { withMonthName: false }),
                  formatJalali(act.lateStartDate, { withMonthName: false }),
                  formatJalali(act.lateFinishDate, { withMonthName: false }),
                  act.totalFloat < 0
                    ? `${toPersianDigits(act.totalFloat)} (پشت برنامه)`
                    : act.totalFloat === 0
                      ? "۰ (بحرانی)"
                      : toPersianDigits(act.totalFloat),
                  toPersianDigits(act.freeFloat),
                  act.critical ? "● بله" : "خیر",
                  constraintCell(act),
                ])}
              />
              <p className="rpt-note">
                شناوری کل (Total Float) حداکثر تأخیر مجاز بدون جابه‌جایی پایان پروژه است. فعالیت‌های بحرانی شناوری صفر دارند و هر تأخیر در آن‌ها مستقیماً پایان پروژه را به تأخیر می‌اندازد.
              </p>
            </div>
          ) : null}

          {has("gantt") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("gantt")} title="نمودار گانت (Gantt Chart)" subtitle="زمان‌بندی پروژه بر اساس تقویم کاری، همراه با مسیر بحرانی و خط تاریخ وضعیت" />
              <div className="thin-scroll rounded-lg border border-slate-200 p-2">
                <GanttChart
                  gantt={a.gantt}
                  links={options.includeGanttDependencyArrows ? links : []}
                  showArrows={options.includeGanttDependencyArrows}
                  statusDate={project.meta.statusDate}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[9.5px] text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-6 rounded-sm border border-blue-500 bg-blue-100" /> فعالیت عادی
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-6 rounded-sm border border-red-600 bg-red-200" /> فعالیت بحرانی
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rotate-45 bg-brand-800" /> نقطه کنترل
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-6 border-t-2 border-dashed border-amber-600" /> تاریخ وضعیت
                </span>
              </div>
            </div>
          ) : null}

          {has("critical") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("critical")} title="مسیر بحرانی (Critical Path)" subtitle={`${toPersianDigits(a.criticalPath.length)} فعالیت بحرانی · ${toPersianDigits(a.criticalPathRatio)}٪ از کل ماندهزمان پروژه`} />
              <div className="rpt-callout mb-3 text-[10.5px] leading-6">
                مسیر بحرانی زنجیره‌ای از فعالیت‌های وابسته است که هیچ شناوری زمانی ندارد؛ هرگونه تأخیر در آن‌ها باعث تأخیر مستقیم در پایان پروژه می‌شود. تمرکز منابع و پایش مدیریتی باید بر این فعالیت‌ها باشد.
              </div>
              <DataTable
                headers={["#", "کد", "فعالیت بحرانی", "مدت", "شروع", "پایان", "شناوری"]}
                rows={a.criticalPath.map((item, index) => {
                  const act = a.activities.find((x) => x.id === item.id);
                  return [
                    toPersianDigits(index + 1),
                    item.code,
                    item.name,
                    toPersianDigits(act?.duration ?? 0),
                    formatJalali(act?.startDate ?? "", { withMonthName: false }),
                    formatJalali(act?.finishDate ?? "", { withMonthName: false }),
                    "۰",
                  ];
                })}
              />
            </div>
          ) : null}

          {has("milestones") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("milestones")} title="نقاط کنترل (Milestones)" />
              <DataTable
                headers={["عنوان نقطه کنترل", "فاز", "تاریخ تحقق", "وضعیت", "فعالیت مرتبط"]}
                rows={a.milestones.map((m) => [
                  m.name,
                  m.phase,
                  m.date ? formatJalali(m.date) : "بدون تاریخ",
                  m.status === "reached"
                    ? "محقق‌شده"
                    : m.status === "late"
                      ? "در تأخیر"
                      : m.status === "unscheduled"
                        ? "زمان‌بندی‌نشده"
                        : "در پیش رو",
                  m.linkedActivityCode ?? "—",
                ])}
              />
            </div>
          ) : null}

          {has("network") ? (
            <div className="rpt-section">
              <SectionTitle index={sectionNumber("network")} title="نمودار شبکه‌ای (Network Diagram)" subtitle="گراف وابستگی فعالیت‌ها به روش Activity-on-Node" />
              <div className="thin-scroll rounded-lg border border-slate-200 p-2">
                <NetworkDiagram
                  nodes={a.activities.map((act) => ({
                    id: act.id,
                    code: act.code,
                    name: act.name,
                    es: act.es,
                    duration: act.duration,
                    critical: act.critical,
                    phaseIndex: a.schedule.phases.findIndex((p) => p.name === act.phase),
                  }))}
                  links={links}
                />
              </div>
            </div>
          ) : null}
          <div className="rpt-sheet-number">
            <span>صفحه ۳ از {toPersianDigits(totalSheets)}</span>
            <span>برنامه‌ریزی و زمان‌بندی پروژه</span>
          </div>
        </section>

        {/* -------------------- SHEET 4: monitoring -------------------- */}
        <section className="report-sheet">
          {has("progress") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("progress")} title="پیشرفت پروژه و تحلیل ارزش کسب‌شده (EVM)" />
              <div className="grid gap-3 md:grid-cols-2">
                <table className="rpt-kv">
                  <tbody>
                    {[
                      ["بودجه در تکمیل (BAC)", money(a.evm.bac)],
                      ["ارزش برنامه‌ریزی‌شده تا تاریخ وضعیت (PV)", money(a.evm.pv)],
                      ["ارزش کسب‌شده (EV)", money(a.evm.ev)],
                      ["هزینه واقعی (AC)", a.evm.ac === null ? "ثبت نشده" : money(a.evm.ac)],
                      ["انحراف زمان‌بندی (SV = EV − PV)", money(a.evm.sv)],
                      ["انحراف هزینه (CV = EV − AC)", a.evm.cv === null ? "قابل محاسبه نیست" : money(a.evm.cv)],
                      ["شاخص عملکرد زمان‌بندی (SPI)", a.evm.spi === null ? "قابل محاسبه نیست" : toPersianDigits(a.evm.spi)],
                      ["شاخص عملکرد هزینه (CPI)", a.evm.cpi === null ? "قابل محاسبه نیست" : toPersianDigits(a.evm.cpi)],
                      ["برآورد هزینه در پایان (EAC = BAC ÷ CPI)", a.evm.eac === null ? "قابل محاسبه نیست" : money(a.evm.eac)],
                      ["برآورد هزینه باقی‌مانده (ETC = EAC − AC)", a.evm.etc === null ? "—" : money(a.evm.etc)],
                      ["انحراف در پایان (VAC = BAC − EAC)", a.evm.vac === null ? "—" : money(a.evm.vac)],
                      ["پوشش داده هزینه واقعی", `${toPersianDigits(a.evm.costDataCoverage)}٪ از بودجه`],
                      ["پیشرفت زمان‌محور (مدت‌وزنی)", formatPercent(a.progress.timeBased, 1)],
                      ["پیشرفت فیزیکی (مقدار اجرا)", a.progress.physical === null ? "ثبت نشده" : formatPercent(a.progress.physical, 1)],
                      ["پوشش پیشرفت فیزیکی", `${toPersianDigits(a.progress.physicalCoverage)}٪ از بودجه`],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td className="k">{label}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  {a.evm.notes.length ? (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-6 text-amber-900">
                      {a.evm.notes.map((note) => (
                        <p key={note}>• {note}</p>
                      ))}
                    </div>
                  ) : null}
                  <p className="mb-2 text-[10.5px] font-bold text-slate-600">پیشرفت فازها</p>
                  <BarChart
                    data={a.schedule.phases.map((p) => ({ label: p.name, value: p.progress, tone: "info" }))}
                    formatter={(v) => formatPercent(v, 1)}
                  />
                  <p className="mt-3 mb-1 text-[10.5px] font-bold text-slate-600">وضعیت فعالیت‌ها</p>
                  <DataTable
                    headers={["وضعیت", "تعداد"]}
                    rows={[
                      ["تکمیل‌شده", toPersianDigits(a.progress.completed)],
                      ["در حال اجرا", toPersianDigits(a.progress.started - a.progress.completed)],
                      ["شروع‌نشده", toPersianDigits(a.progress.notStarted)],
                      ["دارای تأخیر", toPersianDigits(a.progress.late)],
                    ]}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {has("resources") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("resources")} title="منابع و تخصیص (Resources & Allocation)" />
              <DataTable
                headers={["منبع", "نوع", "ظرفیت مجاز", "واحد-روز تخصیص", "اوج تخصیص", "تاریخ اوج", "بهره‌وری", "هزینه"]}
                rows={a.resources.map((r) => [
                  r.name,
                  r.type === "labor" ? "نیروی انسانی" : r.type === "equipment" ? "ماشین‌آلات" : r.type === "material" ? "مصالح" : "هزینه",
                  toPersianDigits(r.capacity),
                  toPersianDigits(r.totalUnits),
                  r.overallocated ? `${toPersianDigits(r.peakUnits)} ⚠` : toPersianDigits(r.peakUnits),
                  formatJalali(r.peakDate, { withMonthName: false }),
                  formatPercent(r.utilization, 0),
                  number(r.cost),
                ])}
                footer={["جمع", "", "", "", "", "", "", number(a.resources.reduce((s, r) => s + r.cost, 0))]}
              />
              {a.overallocatedResources > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[10.5px] leading-6 text-amber-800">
                  ⚠ در {toPersianDigits(a.overallocatedResources)} منبع، میزان تخصیص از ظرفیت مجاز روزانه بیشتر است. این موتور فقط «مصرف و ظرفیت» را محاسبه می‌کند و تسطیح خودکار منابع انجام نمی‌دهد؛ رفع آن نیازمند تصمیم برنامه‌ریز است (افزایش ظرفیت، تخصیص منبع دیگر یا جابه‌جایی فعالیت غیربحرانی در محدوده شناوری).
                </div>
              ) : null}
              {a.resources.find((r) => r.demand.length) ? (
                <div className="mt-3">
                  <p className="mb-1 text-[10.5px] font-bold text-slate-600">
                    نمودار بار منبع: {a.resources[0].name}
                  </p>
                  <ResourceHistogram series={a.resources[0].demand} capacity={a.resources[0].capacity} />
                </div>
              ) : null}
            </div>
          ) : null}

          {has("costs") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("costs")} title="هزینه‌ها و بودجه (Cost & Budget)" />
              <DataTable
                headers={["فاز", "تعداد فعالیت", "بودجه (BAC)", "هزینه واقعی (AC)", "پیشرفت", "ارزش کسب‌شده"]}
                rows={a.costs.byPhase.map((p) => [
                  p.phase,
                  toPersianDigits(a.schedule.phases.find((x) => x.name === p.phase)?.activityCount ?? 0),
                  number(p.budget),
                  number(p.actual),
                  formatPercent(p.progress, 1),
                  number(p.budget * (p.progress / 100)),
                ])}
                footer={["جمع کل", toPersianDigits(a.activities.length), number(a.costs.budget), number(a.costs.actual), formatPercent(a.progress.overall, 1), number(a.costs.earned)]}
              />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10.5px] font-bold text-slate-600">سهم فازها از بودجه</p>
                  <BarChart data={a.costs.byPhase.map((p) => ({ label: p.phase, value: p.budget, tone: "info" }))} formatter={number} />
                </div>
                <table className="rpt-kv">
                  <tbody>
                    {[
                      ["بودجه مصوب پروژه", project.meta.budget ? money(project.meta.budget) : "—"],
                      ["بودجه تجمیعی فعلی (BAC)", money(a.costs.budget)],
                      ["هزینه واقعی تا تاریخ وضعیت", money(a.costs.actual)],
                      ["برآورد هزینه در پایان (EAC)", money(a.costs.estimateAtCompletion)],
                      ["انحراف از بودجه (VAC)", money(a.costs.varianceAtCompletion)],
                      ["وضعیت هزینه", a.progress.costPerformanceIndex >= 1 ? "در محدوده بودجه" : "بیش از بودجه"],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td className="k">{label}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {has("pricing") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("pricing")} title="نرخ‌های مرجع، سناریوی افزایش هزینه و برآورد نهایی" subtitle={`مبنای نرخ: ${a.pricing.seriesLabel} — منطقه ${a.pricing.regionLabel} — تاریخ نرخ: ${a.pricing.asOfJalali}`} />
              <table className="rpt-kv mb-3">
                <tbody>
                  {[
                    ["مبنای دستمزد و ماشین‌آلات", a.pricing.seriesLabel],
                    ["منطقه اجرا", `${a.pricing.regionLabel} (ضریب منطقه‌ای اعمال‌شده)`],
                    ["تاریخ مرجع نرخ بازار", `${a.pricing.asOfJalali} (${a.pricing.asOf})`],
                    ["ضریب تعدیل عمومی", `${toPersianDigits(a.pricing.indexFactor)}٪`],
                    ["نرخ سناریوی افزایش هزینه (ماهانه)", a.pricing.escalationEnabled ? `${toPersianDigits(a.pricing.escalationRatePerMonth)}٪ در ماه (مرکب)` : "سناریو غیرفعال"],
                    ["منابع داده", a.pricing.sources.join(" • ")],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="k">{label}</td>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mb-2 text-[10.5px] font-bold text-slate-600">ساختار برآورد هزینه (مطابق روش فهرست‌بهای)</p>
              <DataTable
                headers={["شرح", "مبنای محاسبه", "مبلغ"]}
                rows={[
                  ["هزینه‌های مستقیم (کار، ماشین، مصالح)", "مجموع فعالیت‌ها", money(a.pricing.breakdown.direct)],
                  ["هزینه‌های بالاسری", `${toPersianDigits(project.pricing?.overheadPercent ?? 17)}٪ مستقیم`, money(a.pricing.breakdown.overhead)],
                  ["سود پیمانکار", `${toPersianDigits(project.pricing?.profitPercent ?? 10)}٪ (مستقیم + بالاسری)`, money(a.pricing.breakdown.profit)],
                  ["ذخیره احتیاطی", `${toPersianDigits(project.pricing?.contingencyPercent ?? 5)}٪ مستقیم`, money(a.pricing.breakdown.contingency)],
                  ["سناریوی افزایش هزینه (نه تعدیل قراردادی)", `${toPersianDigits(a.pricing.escalationRatePerMonth)}٪ ماهانه مرکب بر کارکرد`, money(a.pricing.breakdown.escalation)],
                ]}
                footer={["جمع برآورد نهایی پروژه", "—", money(a.pricing.breakdown.total)]}
              />

              {a.pricing.escalation.months.length ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10.5px] font-bold text-slate-600">جدول سناریوی افزایش هزینه بر پایه کارکرد ماهانه</p>
                  <DataTable
                    headers={["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب افزایش هزینه", "هزینه افزایش‌یافته", "مبلغ افزایش"]}
                    rows={a.pricing.escalation.months.map((m) => [
                      m.label,
                      toPersianDigits(m.workingDays),
                      money(m.plannedValue),
                      toPersianDigits(m.factor),
                      money(m.adjustedValue),
                      money(m.escalation),
                    ])}
                    footer={["جمع", toPersianDigits(a.pricing.escalation.months.reduce((s2, m) => s2 + m.workingDays, 0)), money(a.pricing.escalation.baseValue), "—", "—", money(a.pricing.escalation.total)]}
                  />
                </div>
              ) : null}

              <div className="mt-3">
                <p className="mb-1.5 text-[10.5px] font-bold text-slate-600">نرخ‌های اعمال‌شده روی منابع پروژه</p>
                <DataTable
                  headers={["منبع", "واحد", "نرخ اعمال‌شده", "مبنای نرخ", "تاریخ مرجع", "سند / پیوند", "اعتبار منبع"]}
                  rows={a.pricing.rates.map((rate) => [
                    rate.name,
                    rate.unit ?? "—",
                    money(rate.rate),
                    rate.source,
                    rate.provenance?.asOfIso
                      ? formatJalali(rate.provenance.asOfIso, { withMonthName: false })
                      : a.pricing.asOfJalali,
                    rate.provenance?.sourceRef || rate.provenance?.sourceUrl
                      ? [rate.provenance.sourceRef, rate.provenance.sourceUrl].filter(Boolean).join(" · ")
                      : "سند ثبت نشده",
                    rate.verified ? "تأییدشده" : "تأییدنشده (داده مرجع)",
                  ])}
                />
              </div>
              <p className="rpt-note">
                نرخ نمایش‌داده‌شده در ستون «نرخ» همان نرخی است که در محاسبات این پروژه اعمال شده است. مبنای نرخ (ستون آخر) و وضعیت اعتبارسنجی آن ذکر شده است. این ارقام «داده مرجع» هستند و سند رسمی هر ردیف در سامانه نگهداری نمی‌شود؛ برای برآورد قراردادی باید با فهرست‌بهای سال مربوطه و نرخ‌های مصوب پروژه جایگزین شوند.
              </p>
            </div>
          ) : null}

          {has("risks") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("risks")} title="ریسک‌های پروژه (Risk Register)" subtitle={`ارزش در معرض ریسک: ${number(a.riskExposure)}`} />
              <div className="mb-4 grid grid-cols-[auto_repeat(5,1fr)] gap-1 text-[9px]">
                <div />
                {["اثر ۱", "اثر ۲", "اثر ۳", "اثر ۴", "اثر ۵"].map((label) => (
                  <div key={label} className="text-center font-bold text-slate-500">
                    {label}
                  </div>
                ))}
                {[5, 4, 3, 2, 1].map((probability) => (
                  <div key={probability} className="contents">
                    <div className="flex items-center justify-end pe-1 font-bold text-slate-500">احتمال {toPersianDigits(probability)}</div>
                    {[1, 2, 3, 4, 5].map((impact) => {
                      const score = probability * impact;
                      const count = a.risks.filter((r) => r.probability === probability && r.impact === impact).length;
                      const bg = score >= 20 ? "#fecaca" : score >= 12 ? "#fde68a" : score >= 6 ? "#fef3c7" : "#dcfce7";
                      return (
                        <div
                          key={impact}
                          className="flex h-8 items-center justify-center rounded border border-white font-bold text-ink-900"
                          style={{ background: bg }}
                        >
                          {count ? toPersianDigits(count) : "—"}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <DataTable
                headers={["ریسک", "دسته", "احتمال", "اثر", "امتیاز", "سطح", "اثر زمانی", "اثر مالی", "راهکار کاهش", "مسئول"]}
                rows={a.risks.map((r) => [
                  r.title,
                  r.category,
                  toPersianDigits(r.probability),
                  toPersianDigits(r.impact),
                  toPersianDigits(r.score),
                  r.level === "critical" ? "بحرانی" : r.level === "high" ? "بالا" : r.level === "medium" ? "متوسط" : "کم",
                  `${toPersianDigits(r.scheduleImpact)} روز`,
                  number(r.costImpact),
                  r.mitigation ?? "—",
                  r.owner ?? "—",
                ])}
              />
            </div>
          ) : null}

          {has("delays") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("delays")} title="تأخیرها و انحراف زمانی (Delays)" />
              {a.delays.length ? (
                <DataTable
                  headers={["کد", "فعالیت", "فاز", "پایان برنامه‌ای", "پیشرفت واقعی", "پیشرفت برنامه‌ای", "تأخیر", "بحرانی"]}
                  rows={a.delays.map((d) => [
                    d.code,
                    d.name,
                    d.phase,
                    formatJalali(d.plannedFinish, { withMonthName: false }),
                    formatPercent(d.progress, 0),
                    formatPercent(d.plannedProgress, 0),
                    `${toPersianDigits(d.slipDays)} روز`,
                    d.critical ? "● بله" : "خیر",
                  ])}
                />
              ) : (
                <div className="rpt-callout text-[11px]">تا تاریخ وضعیت گزارش، هیچ فعالیتی تأخیر زمانی نسبت به برنامه ندارد.</div>
              )}
            </div>
          ) : null}

          {has("baseline") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionNumber("baseline")} title="مقایسه با مبنای برنامه (Baseline Comparison)" />
              {a.baseline.available ? (
                <>
                  <table className="rpt-kv mb-3">
                    <tbody>
                      <tr>
                        <td className="k">نام مبنا</td>
                        <td>{a.baseline.name ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="k">حداکثر تأخیر پایان نسبت به مبنا</td>
                        <td>{toPersianDigits(a.baseline.maxFinishSlipDays)} روز کاری</td>
                      </tr>
                      <tr>
                        <td className="k">حداکثر تأخیر شروع نسبت به مبنا</td>
                        <td>{toPersianDigits(a.baseline.maxStartSlipDays)} روز کاری</td>
                      </tr>
                      <tr>
                        <td className="k">انحراف تجمیعی هزینه</td>
                        <td>{money(a.baseline.costVariance)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <DataTable
                    headers={["کد", "فعالیت", "شروع مبنا", "شروع فعلی", "انحراف شروع", "پایان مبنا", "پایان فعلی", "انحراف پایان", "تغییر مدت", "وضعیت", "بودجه فعلی"]}
                    rows={a.baseline.changedActivities.map((c) => [
                      c.code,
                      c.name,
                      formatJalali(c.baselineStart, { withMonthName: false }),
                      formatJalali(c.currentStart, { withMonthName: false }),
                      signedDays(c.startVarianceDays),
                      formatJalali(c.baselineFinish, { withMonthName: false }),
                      formatJalali(c.currentFinish, { withMonthName: false }),
                      signedDays(c.finishVarianceDays),
                      signedDays(c.durationChange),
                      c.status === "later" ? "عقب‌تر" : c.status === "earlier" ? "زودتر" : c.status === "unknown" ? "نامشخص" : "مطابق برنامه",
                      number(c.currentCost),
                    ])}
                  />
                </>
              ) : (
                <div className="rpt-callout text-[11px]">
                  برای این پروژه Baseline ثبت نشده است. با ثبت Baseline در مرحله تقویم و محدودیت‌ها، امکان مقایسه برنامه جاری با مبنای تأییدشده فراهم می‌شود.
                </div>
              )}
            </div>
          ) : null}

          {has("status") ? (
            <div className="rpt-section">
              <SectionTitle index={sectionNumber("status")} title="وضعیت و سلامت پروژه (Project Status)" />
              <DataTable
                headers={["حوزه", "وضعیت", "توضیح"]}
                rows={a.health.signals.map((s) => [
                  s.label,
                  s.status === "good" ? "✔ مطلوب" : s.status === "watch" ? "⚠ قابل پایش" : "✖ بحرانی",
                  s.detail,
                ])}
              />
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-bold text-brand-900">جمع‌بندی وضعیت</p>
                <p className="mt-1 text-[10.5px] leading-6 text-slate-700">
                  امتیاز کلی سلامت پروژه {toPersianDigits(a.health.score)} از ۱۰۰ ارزیابی شده و وضعیت کلی پروژه «{statusText}» است.
                  {a.health.status !== "good"
                    ? " لازم است اقدامات اصلاحی بر روی حوزه‌های علامت‌گذاری‌شده انجام و در گزارش دوره بعدی پایش شود."
                    : " روند اجرا مطابق برنامه است و پایش دوره‌ای توصیه می‌شود."}
                </p>
              </div>
            </div>
          ) : null}
          <div className="rpt-sheet-number">
            <span>صفحه ۴ از {toPersianDigits(totalSheets)}</span>
            <span>پایش، کنترل و تحلیل پروژه</span>
          </div>
        </section>

        {/* -------------------- SHEET 5: signature -------------------- */}
        {has("signature") ? (
          <section className="report-sheet">
            {has("standards") ? (
              <div className="rpt-section mb-6">
                <SectionTitle index={sectionNumber("standards")} title="مبنای استانداردها و متدهای محاسباتی" subtitle="استانداردهای ملی و بین‌المللی مبنای محاسبات و ساختار این گزارش" />
                <DataTable
                  headers={["کد", "عنوان استاندارد", "سطح", "شرح"]}
                  rows={a.standards.map((item) => [
                    item.code,
                    item.title,
                    item.scope === "national" ? "ملی" : "بین‌المللی",
                    item.body,
                  ])}
                />
                <p className="rpt-note">
                  روش‌های محاسباتی: مسیر بحرانی با شبکه پیش‌نیازی (CPM/PDM)، مدیریت ارزش کسب‌شده (EVM)، تخصیص و مصرف منابع (بدون تسطیح خودکار)، سناریوی افزایش هزینه بر پایه کارکرد ماهانه و ارزیابی ریسک به روش احتمال–اثر.
                </p>
              </div>
            ) : null}
            <SectionTitle index={sectionNumber("signature")} title="تأیید و امضا (Approval)" />
            <p className="mb-4 text-[10.5px] leading-6 text-slate-600">
              این گزارش بر اساس اطلاعات ثبت‌شده در پلتفرم HERMIPLAN و محاسبات استاندارد مدیریت پروژه (CPM و EVM) تهیه شده است. صحت داده‌های ورودی بر عهده تهیه‌کننده گزارش است.
            </p>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>سمت</th>
                  <th>نام و نام خانوادگی</th>
                  <th style={{ width: "26%" }}>امضا</th>
                  <th style={{ width: "16%" }}>تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["تهیه‌کننده / برنامه‌ریز", project.meta.manager ?? ""],
                  ["کنترل پروژه", ""],
                  ["دستگاه نظارت / مشاور", project.meta.consultant ?? ""],
                  ["کارفرما", project.meta.client ?? ""],
                ].map(([role, name]) => (
                  <tr key={role}>
                    <td>
                      <strong>{role}</strong>
                    </td>
                    <td>{name || "—"}</td>
                    <td style={{ height: 34 }} />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-8 rounded-lg border border-slate-200 p-4">
              <p className="text-[11px] font-bold text-brand-900">HERMIPLAN</p>
              <p className="mt-1 text-[10px] leading-6 text-slate-500">
                تولید گزارش با موتور محاسباتی اختصاصی مدیریت پروژه؛ شامل زمان‌بندی CPM، تحلیل ارزش کسب‌شده، تخصیص منابع و ارزیابی ریسک.
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="flex items-center gap-2 text-[10px] text-slate-500">
                  <LogoMark size="xs" /> HERMIPLAN
                </span>
                <span className="text-[10px] text-slate-500">
                  Created by Mohammad Shirmardi · {formatJalali(project.meta.statusDate)}
                </span>
              </div>
            </div>
            <div className="rpt-sheet-number">
              <span>صفحه ۵ از {toPersianDigits(totalSheets)}</span>
              <span>تأیید و امضا</span>
            </div>
          </section>
        ) : null}

        {!ordered.length ? (
          <section className="report-sheet">
            <p className="py-20 text-center text-[13px] text-slate-500">هیچ بخشی برای گزارش انتخاب نشده است.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
