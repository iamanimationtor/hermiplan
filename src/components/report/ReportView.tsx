"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart, GanttChart, HealthGauge, NetworkDiagram, ResourceHistogram } from "@/components/charts";
import { Badge, Button } from "@/components/ui";
import { EXPORT_FORMATS, REPORT_SECTIONS, type ReportOptions } from "@/lib/validation";
import { Modal } from "@/components/ui";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import { formatCompact, formatCurrency, formatJalali, formatNumber, formatPercent, toPersianDigits } from "@/lib/date-fa";

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

/**
 * Fixed document order of the report sections (the order the sheets render
 * in). Section numbers count only the sections the viewer has enabled.
 */
const SECTION_DOCUMENT_ORDER = [
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
];

/** Makes an untrusted project name safe for use in a download filename. */
function safeFileName(name: string): string {
  return (name || "project").replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 60);
}

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
  isPublic = true,
  canManage = false,
}: {
  projectId: string;
  project: ProjectInput;
  analysis: ProjectAnalysis;
  options: ReportOptions;
  isPublic?: boolean;
  canManage?: boolean;
}) {
  const [sections, setSections] = useState<string[]>(options.sections);
  const has = (key: string) => sections.includes(key);
  const ordered = REPORT_SECTIONS.filter((s) => sections.includes(s.key));
  const [printing, setPrinting] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [publicLink, setPublicLink] = useState(isPublic);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleVisibility() {
    if (!canManage) return;
    setVisibilityBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !publicLink }),
      });
      if (response.ok) {
        setPublicLink((value) => !value);
      } else {
        setActionError("تغییر وضعیت لینک انجام نشد. لطفاً دوباره تلاش کنید.");
      }
    } catch {
      setActionError("تغییر وضعیت لینک انجام نشد. لطفاً دوباره تلاش کنید.");
    } finally {
      setVisibilityBusy(false);
    }
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
    if (params.get("deliver") !== "1") return;
    // open the download centre after mount (post-paint) instead of
    // synchronously inside the effect
    const frame = window.requestAnimationFrame(() => setDownloadOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function download(formatId: string) {
    setBusyFormat(formatId);
    setActionError(null);
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
      if (!response.ok) {
        let message = "دریافت فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.";
        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* keep the generic message */
        }
        setActionError(message);
        return;
      }
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
      anchor.download = `HERMIPLAN-${safeFileName(project.meta.name)}.${format?.ext ?? "txt"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setActionError("دریافت فایل با خطا مواجه شد. لطفاً دوباره تلاش کنید.");
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
  // Section numbers follow the fixed document order and count only enabled
  // sections — computed fresh each render without mutating render-scoped state.
  const sectionIndex = new Map<string, number>(
    SECTION_DOCUMENT_ORDER.filter((key) => sections.includes(key)).map(
      (key: string, index: number): [string, number] => [key, index + 1],
    ),
  );

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
              onClick={toggleVisibility}
              disabled={visibilityBusy}
              title={publicLink ? "این گزارش برای هر دارنده لینک قابل مشاهده است" : "فقط شما می‌توانید این گزارش را ببینید"}
            >
              {publicLink ? "🔓 لینک عمومی" : "🔒 لینک خصوصی"}
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

      {/* -------------------------- download center -------------------------- */}
      {actionError ? (
        <div
          role="alert"
          className="no-print mx-auto mt-3 flex max-w-[1180px] items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] text-red-700"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="بستن پیام"
            className="shrink-0 rounded-lg px-2 py-1 text-red-500 transition hover:bg-red-100"
          >
            ✕
          </button>
        </div>
      ) : null}
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
                  ["پیشرفت فیزیکی", formatPercent(a.progress.overall, 1)],
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
              <SectionTitle index={sectionIndex.get("executive") ?? 0} title="خلاصه مدیریتی (Executive Summary)" subtitle="جمع‌بندی خودکار وضعیت پروژه بر اساس شاخص‌های محاسباتی" />
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
              <SectionTitle index={sectionIndex.get("info") ?? 0} title="مشخصات پروژه (Project Information)" />
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
              <SectionTitle index={sectionIndex.get("kpis") ?? 0} title="شاخص‌های کلیدی عملکرد (KPIs)" />
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
              <SectionTitle index={sectionIndex.get("wbs") ?? 0} title="ساختار شکست کار (WBS)" subtitle="سلسله‌مراتب فازها و فعالیت‌های پروژه" />
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
              <SectionTitle index={sectionIndex.get("activities") ?? 0} title="فهرست فعالیت‌ها (Activity List)" />
              <DataTable
                headers={["کد", "عنوان فعالیت", "فاز", "مدت", "تاریخ شروع", "تاریخ پایان", "پیشرفت", "منابع", "بودجه"]}
                rows={a.activities.map((act) => [
                  act.code,
                  act.name,
                  act.phase,
                  toPersianDigits(act.duration),
                  formatJalali(act.startDate, { withMonthName: false }),
                  formatJalali(act.finishDate, { withMonthName: false }),
                  formatPercent(act.progress, 0),
                  act.resourceNames.join("، ") || "—",
                  number(act.budgetCost),
                ])}
                footer={["", "جمع کل", `${toPersianDigits(a.activities.length)} فعالیت`, toPersianDigits(a.schedule.workingDays), "", "", formatPercent(a.progress.overall, 1), "", number(a.costs.budget)]}
              />
              {options.includeNotes && a.activities.some((act) => act.milestone) ? (
                <p className="rpt-note">فعالیت‌های با مدت صفر، نقاط کنترل (Milestone) پروژه هستند.</p>
              ) : null}
            </div>
          ) : null}

          {has("schedule") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionIndex.get("schedule") ?? 0} title="زمان‌بندی و شناوری فعالیت‌ها (Schedule & Float)" subtitle="محاسبه‌شده بر اساس الگوریتم CPM با تقویم کاری پروژه" />
              <DataTable
                headers={["کد", "فعالیت", "زودترین شروع", "زودترین پایان", "دیرترین شروع", "دیرترین پایان", "شناوری کل", "شناوری آزاد", "بحرانی"]}
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
                ])}
              />
              <p className="rpt-note">
                شناوری کل (Total Float) حداکثر تأخیر مجاز بدون جابه‌جایی پایان پروژه است. فعالیت‌های بحرانی شناوری صفر دارند و هر تأخیر در آن‌ها مستقیماً پایان پروژه را به تأخیر می‌اندازد.
              </p>
            </div>
          ) : null}

          {has("gantt") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionIndex.get("gantt") ?? 0} title="نمودار گانت (Gantt Chart)" subtitle="زمان‌بندی پروژه بر اساس تقویم کاری، همراه با مسیر بحرانی و خط تاریخ وضعیت" />
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
              <SectionTitle index={sectionIndex.get("critical") ?? 0} title="مسیر بحرانی (Critical Path)" subtitle={`${toPersianDigits(a.criticalPath.length)} فعالیت بحرانی · ${toPersianDigits(a.criticalPathRatio)}٪ از کل ماندهزمان پروژه`} />
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
              <SectionTitle index={sectionIndex.get("milestones") ?? 0} title="نقاط کنترل (Milestones)" />
              <DataTable
                headers={["عنوان نقطه کنترل", "فاز", "تاریخ تحقق", "وضعیت", "فعالیت مرتبط"]}
                rows={a.milestones.map((m) => [
                  m.name,
                  m.phase,
                  formatJalali(m.date),
                  m.status === "reached" ? "محقق‌شده" : m.status === "late" ? "در تأخیر" : "در پیش رو",
                  m.linkedActivityCode ?? "—",
                ])}
              />
            </div>
          ) : null}

          {has("network") ? (
            <div className="rpt-section">
              <SectionTitle index={sectionIndex.get("network") ?? 0} title="نمودار شبکه‌ای (Network Diagram)" subtitle="گراف وابستگی فعالیت‌ها به روش Activity-on-Node" />
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
              <SectionTitle index={sectionIndex.get("progress") ?? 0} title="پیشرفت پروژه و تحلیل ارزش کسب‌شده (EVM)" />
              <div className="grid gap-3 md:grid-cols-2">
                <table className="rpt-kv">
                  <tbody>
                    {[
                      ["بودجه در تکمیل (BAC)", money(a.costs.budget)],
                      ["ارزش برنامه‌ریزی‌شده تا امروز (PV)", money(a.costs.plannedToDate)],
                      ["ارزش کسب‌شده (EV)", money(a.costs.earned)],
                      ["هزینه واقعی (AC)", money(a.costs.actual)],
                      ["انحراف زمان‌بندی (SV)", money(a.progress.scheduleVariance)],
                      ["انحراف هزینه (CV)", money(a.progress.costVariance)],
                      ["شاخص عملکرد زمان‌بندی (SPI)", toPersianDigits(a.progress.schedulePerformanceIndex)],
                      ["شاخص عملکرد هزینه (CPI)", toPersianDigits(a.progress.costPerformanceIndex)],
                      ["برآورد هزینه در پایان (EAC)", money(a.costs.estimateAtCompletion)],
                      ["انحراف در پایان (VAC)", money(a.costs.varianceAtCompletion)],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td className="k">{label}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
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
              <SectionTitle index={sectionIndex.get("resources") ?? 0} title="منابع و تخصیص (Resources & Allocation)" />
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
                  ⚠ در {toPersianDigits(a.overallocatedResources)} منبع، میزان تخصیص از ظرفیت مجاز روزانه بیشتر است. پیشنهاد: افزایش ظرفیت، تخصیص موازی منابع دیگر یا جابه‌جایی فعالیت‌های غیربحرانی در محدوده شناوری آن‌ها (Resource Leveling).
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
              <SectionTitle index={sectionIndex.get("costs") ?? 0} title="هزینه‌ها و بودجه (Cost & Budget)" />
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
              <SectionTitle index={sectionIndex.get("pricing") ?? 0} title="قیمت‌گذاری بازار، تعدیل و برآورد نهایی" subtitle={`مبنای نرخ: ${a.pricing.seriesLabel} — منطقه ${a.pricing.regionLabel} — تاریخ نرخ: ${a.pricing.asOfJalali}`} />
              <table className="rpt-kv mb-3">
                <tbody>
                  {[
                    ["مبنای دستمزد و ماشین‌آلات", a.pricing.seriesLabel],
                    ["منطقه اجرا", `${a.pricing.regionLabel} (ضریب منطقه‌ای اعمال‌شده)`],
                    ["تاریخ مرجع نرخ بازار", `${a.pricing.asOfJalali} (${a.pricing.asOf})`],
                    ["ضریب تعدیل عمومی", `${toPersianDigits(a.pricing.indexFactor)}٪`],
                    ["نرخ تعدیل ماهانه", a.pricing.escalationEnabled ? `${toPersianDigits(a.pricing.escalationRatePerMonth)}٪ در ماه` : "تعدیل غیرفعال"],
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
                  ["تعدیل قیمت (Escalation)", `${toPersianDigits(a.pricing.escalationRatePerMonth)}٪ ماهانه بر کارکرد`, money(a.pricing.breakdown.escalation)],
                ]}
                footer={["جمع برآورد نهایی پروژه", "—", money(a.pricing.breakdown.total)]}
              />

              {a.pricing.escalation.months.length ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10.5px] font-bold text-slate-600">جدول تعدیل بر پایه کارکرد ماهانه</p>
                  <DataTable
                    headers={["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب تعدیل", "هزینه تعدیل‌شده", "مبلغ تعدیل"]}
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
                  headers={["منبع", "واحد", "نرخ", "مبنای نرخ"]}
                  rows={a.pricing.rates.map((rate) => [
                    rate.name,
                    rate.unit ?? "—",
                    money(rate.rate),
                    rate.source,
                  ])}
                />
              </div>
              <p className="rpt-note">
                نرخ‌ها بر مبنای مصوبات رسمی دستمزد و میانگین بازار مصالح ایران تنظیم شده‌اند؛ در صورت نیاز، ضریب تعدیل عمومی یا نرخ هر منبع در پنل قیمت‌گذاری قابل اصلاح است.
              </p>
            </div>
          ) : null}

          {has("risks") ? (
            <div className="rpt-section mb-6">
              <SectionTitle index={sectionIndex.get("risks") ?? 0} title="ریسک‌های پروژه (Risk Register)" subtitle={`ارزش در معرض ریسک: ${number(a.riskExposure)}`} />
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
              <SectionTitle index={sectionIndex.get("delays") ?? 0} title="تأخیرها و انحراف زمانی (Delays)" />
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
              <SectionTitle index={sectionIndex.get("baseline") ?? 0} title="مقایسه با مبنای برنامه (Baseline Comparison)" />
              {a.baseline.available ? (
                <>
                  <table className="rpt-kv mb-3">
                    <tbody>
                      <tr>
                        <td className="k">نام مبنا</td>
                        <td>{a.baseline.name ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="k">حداکثر انحراف زمان‌بندی</td>
                        <td>{toPersianDigits(a.baseline.scheduleVarianceDays)} روز کاری</td>
                      </tr>
                      <tr>
                        <td className="k">انحراف تجمیعی هزینه</td>
                        <td>{money(a.baseline.costVariance)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <DataTable
                    headers={["کد", "فعالیت", "شروع مبنا", "شروع فعلی", "پایان مبنا", "پایان فعلی", "انحراف (روز)", "بودجه مبنا", "بودجه فعلی"]}
                    rows={a.baseline.changedActivities.map((c) => [
                      c.code,
                      c.name,
                      formatJalali(c.baselineStart, { withMonthName: false }),
                      formatJalali(c.currentStart, { withMonthName: false }),
                      formatJalali(c.baselineFinish, { withMonthName: false }),
                      formatJalali(c.currentFinish, { withMonthName: false }),
                      toPersianDigits(c.varianceDays),
                      number(c.baselineCost),
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
              <SectionTitle index={sectionIndex.get("status") ?? 0} title="وضعیت و سلامت پروژه (Project Status)" />
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
                <SectionTitle index={sectionIndex.get("standards") ?? 0} title="مبنای استانداردها و متدهای محاسباتی" subtitle="استانداردهای ملی و بین‌المللی مبنای محاسبات و ساختار این گزارش" />
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
                  روش‌های محاسباتی: مسیر بحرانی با شبکه پیش‌نیازی (CPM/PDM)، مدیریت ارزش کسب‌شده (EVM)، تخصیص و هموارسازی منابع، تعدیل قیمت بر پایه کارکرد ماهانه و ارزیابی ریسک به روش احتمال–اثر.
                </p>
              </div>
            ) : null}
            <SectionTitle index={sectionIndex.get("signature") ?? 0} title="تأیید و امضا (Approval)" />
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
