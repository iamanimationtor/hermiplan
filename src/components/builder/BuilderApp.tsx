"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Modal, ProgressBar, StatTile } from "@/components/ui";
import { GanttChart } from "@/components/charts";
import { loadDraft, useProject } from "./useProject";
import { AuthMenu } from "./AuthMenu";
import { HelpDialog } from "./HelpGlossary";
import { ImportDialog } from "./QuickCapture";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";
import {
  StepActivities,
  StepBasics,
  StepCalendar,
  StepMilestonesRisks,
  StepOutput,
  StepResources,
} from "./steps";
import { buildProjectFromTemplate } from "@/lib/templates";
import { DEFAULT_REPORT_SECTIONS } from "@/lib/validation";
import { buildProjectFile, parseProjectFile, serializeProjectFile } from "@/lib/project-file";
import { formatCompact, formatJalali, formatPercent, toPersianDigits } from "@/lib/date-fa";
import type { ProjectInput } from "@/lib/engine/types";

const STEPS = [
  { id: 0, label: "نوع پروژه و مشخصات", icon: "🧩" },
  { id: 1, label: "فعالیت‌ها و WBS", icon: "🧱" },
  { id: 2, label: "منابع و هزینه", icon: "👷" },
  { id: 3, label: "تقویم و محدودیت‌ها", icon: "🗓️" },
  { id: 4, label: "نقاط کنترل و ریسک", icon: "🚩" },
  { id: 5, label: "خروجی گزارش", icon: "📄" },
];

interface SavedProject {
  id: string;
  name: string;
  projectType: string;
  updatedAt: string;
  /** Capability key for the report page — see `lib/server/view-key.ts`. */
  viewKey?: string;
}

/**
 * Report URL for a project the server just confirmed we own.
 *
 * The `k` parameter is the capability key, so the report opens even when the
 * browser does not send our cookie back (third-party cookie blocking, embedded
 * preview, or the same link opened in another browser). Without it the owner
 * could create a project and immediately be told it does not exist.
 */
function reportUrl(projectId: string, viewKey?: string): string {
  const base = `/report/${projectId}?deliver=1`;
  return viewKey ? `${base}&k=${encodeURIComponent(viewKey)}` : base;
}

export function BuilderApp({
  initial,
  accessBadge = "",
}: {
  initial: ProjectInput;
  /** «نسخهٔ عمومی — همهٔ امکانات رایگان» when access mode is open; empty otherwise. */
  accessBadge?: string;
}) {
  const [project, setProjectState] = useState<ProjectInput | null>(null);
  const api = useProject(project ?? initial);
  const [step, setStep] = useState(0);
  const [reportSections, setReportSections] = useState<string[]>(DEFAULT_REPORT_SECTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<SavedProject[] | null>(null);
  /** the server says whether older projects exist; the UI must never guess */
  const [savedMore, setSavedMore] = useState<{ total: number; nextOffset: number | null } | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedBusy, setSavedBusy] = useState(false);
  const [fileMessage, setFileMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /**
   * The server copy this builder session is working on. "Generate report" used
   * to create a *new* project every time, which meant a second run silently
   * duplicated the project and its history was never updated. Now the same
   * project is revised in place: the revision number is sent with the save so a
   * concurrent edit is refused instead of overwritten.
   */
  const [serverProject, setServerProject] = useState<{ id: string; version: number; viewKey?: string } | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const router = useRouter();

  // keyboard shortcuts: undo / redo (works everywhere except while typing in inputs)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) api.redo();
      else api.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.undo, api.redo]);

  useEffect(() => {
    // Restoring the local draft and opening the first-visit welcome are
    // post-mount synchronisations with browser storage. They must run after
    // hydration, otherwise the server-rendered markup and the client tree would
    // disagree. This runs exactly once.
    const draft = loadDraft();
    if (draft) api.replace(draft);
    if (typeof window !== "undefined" && !window.localStorage.getItem("hermiplan:welcomed")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWelcomeOpen(true);
      window.localStorage.setItem("hermiplan:welcomed", "1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = api.project;
  const analysis = api.analysis;

  const links = useMemo(
    () =>
      current.activities.flatMap((activity) =>
        activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
      ),
    [current.activities],
  );

  async function downloadExport(format: "xlsx" | "xls" | "csv" | "json" | "msproject" | "package") {
    setBusy(true);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: current, format }),
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `HERMIPLAN-${current.meta.name || "project"}.${format === "package" ? "zip" : format === "msproject" ? "xml" : format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("خروجی فایل با خطا مواجه شد.");
    } finally {
      setBusy(false);
    }
  }

  async function generateReport() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: current,
          reportOptions: {
            sections: reportSections,
            includeNotes: true,
            includeGanttDependencyArrows: true,
            ganttScale: "day",
            theme: "print",
            author: current.meta.manager,
          },
        }),
      });
      if (!response.ok) throw new Error("failed");
      const data = (await response.json()) as { id: string; version?: number; viewKey?: string };
      setServerProject({ id: data.id, version: data.version ?? 1, viewKey: data.viewKey });
      router.push(reportUrl(data.id, data.viewKey));
    } catch {
      setError("تولید گزارش ناموفق بود. لطفاً دوباره تلاش کنید.");
      setBusy(false);
    }
  }

  /**
   * Saves the current builder state into the project it came from and opens its
   * report. Falls back to creating a project when there is nothing to update (or
   * the server copy is gone), and reports a 409 honestly instead of overwriting.
   */
  async function saveAndOpenReport() {
    if (!serverProject) return generateReport();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${serverProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: current,
          reportOptions: {
            sections: reportSections,
            includeNotes: true,
            includeGanttDependencyArrows: true,
            ganttScale: "day",
            theme: "print",
            author: current.meta.manager,
          },
          expectedVersion: serverProject.version,
        }),
      });
      if (response.status === 404) {
        setServerProject(null);
        return await generateReport();
      }
      if (response.status === 409) {
        setError("این گزارش از جای دیگری تغییر کرده است. برای جلوگیری از بازنویسی، نسخه تازه را از فهرست پروژه‌ها باز کنید.");
        setServerProject(null);
        return;
      }
      if (!response.ok) throw new Error("failed");
      const data = (await response.json()) as { version?: number; viewKey?: string };
      setServerProject({ id: serverProject.id, version: data.version ?? serverProject.version, viewKey: data.viewKey });
      router.push(reportUrl(serverProject.id, data.viewKey));
    } catch {
      setError("ذخیره پروژه ناموفق بود. لطفاً دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function fetchSavedPage(offset: number) {
    const response = await fetch(`/api/projects?limit=20&offset=${offset}`, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as {
      projects?: SavedProject[];
      total?: number;
      nextOffset?: number | null;
      error?: string;
    };
    if (!response.ok) {
      // A failed listing is *not* "you have no projects": say what happened.
      setSavedError(data.error ?? "خواندن فهرست پروژه‌ها ناموفق بود");
      return null;
    }
    setSavedMore({ total: data.total ?? 0, nextOffset: data.nextOffset ?? null });
    return data.projects ?? [];
  }

  async function openSaved() {
    setSavedList([]);
    setSavedError(null);
    setSavedMore(null);
    setSavedBusy(true);
    try {
      const page = await fetchSavedPage(0);
      setSavedList(page ?? []);
    } catch {
      setSavedError("خواندن فهرست پروژه‌ها ناموفق بود");
      setSavedList([]);
    } finally {
      setSavedBusy(false);
    }
  }

  async function loadMoreSaved() {
    if (!savedMore?.nextOffset) return;
    setSavedBusy(true);
    try {
      const page = await fetchSavedPage(savedMore.nextOffset);
      if (page) setSavedList((current) => [...(current ?? []), ...page]);
    } catch {
      setSavedError("بارگذاری پروژه‌های بیشتر ناموفق بود");
    } finally {
      setSavedBusy(false);
    }
  }

  /**
   * Project file backup.
   *
   * Why a file, not just the database: an anonymous visitor's projects belong to
   * a cookie in *this* browser. A new device, a cleared cookie jar or a new
   * preview origin silently loses access — and the owner then sees a 404 for
   * work that still exists. A portable file is the honest escape hatch, and it
   * contains exactly what the builder holds, validated again on the way back in.
   */
  function downloadProjectFile() {
    const payload = buildProjectFile(current, reportSections);
    const blob = new Blob([serializeProjectFile(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchorEl = document.createElement("a");
    const safeName = (current.meta.name || "project").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40);
    anchorEl.href = url;
    anchorEl.download = `HERMIPLAN-${safeName}.json`;
    document.body.appendChild(anchorEl);
    anchorEl.click();
    anchorEl.remove();
    URL.revokeObjectURL(url);
    setFileMessage({ kind: "ok", text: "فایل پشتیبان ساخته شد." });
  }

  async function restoreProjectFile(file: File) {
    setFileMessage(null);
    try {
      const result = parseProjectFile(await file.text());
      if (!result.ok) {
        setFileMessage({ kind: "error", text: result.reason });
        return;
      }
      api.replace(result.project);
      setReportSections(result.sections);
      // A restored file is a *new* project on the server: saving must create,
      // never overwrite an unrelated project.
      setServerProject(null);
      setSavedList(null);
      setFileMessage({
        kind: "ok",
        text: `پروژه «${result.project.meta.name}» بازگردانی شد؛ برای ذخیره، دکمه «تولید گزارش» را بزنید.`,
      });
    } catch {
      setFileMessage({ kind: "error", text: "خواندن فایل پشتیبان ناموفق بود." });
    }
  }

  async function loadSaved(id: string) {
    try {
      const response = await fetch(`/api/projects/${id}`);
      const data = (await response.json()) as { project: ProjectInput; version?: number };
      if (data.project) {
        api.replace(data.project);
        setServerProject({ id, version: data.version ?? 1 });
        setSavedList(null);
      }
    } catch {
      setError("بارگذاری پروژه ناموفق بود.");
    }
  }

  const healthTone = analysis.health.status === "good" ? "ok" : analysis.health.status === "watch" ? "warn" : "bad";

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      <a
        href="#builder-main"
        className="no-print sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-[13px] focus:font-bold focus:text-white"
      >
        پرش به محتوای اصلی
      </a>
      <header className="no-print sticky top-0 z-30 border-b border-slate-200/70 glass">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="HERMIPLAN" className="shrink-0">
            <span className="hidden sm:inline-flex"><Logo tagline="Project Intelligence" /></span>
            <span className="sm:hidden"><LogoMark size="sm" /></span>
          </Link>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-ink-900">{current.meta.name}</p>
            <p className="text-[11px] text-slate-500">
              {api.isStale ? "در حال محاسبه…" : "ذخیره خودکار فعال"} · برآورد {formatCompact(analysis.pricing.breakdown.total)}
            </p>
            {accessBadge ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {accessBadge}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex"><AuthMenu /></span>
            <span className="hidden items-center gap-1 md:inline-flex">
              <button
                type="button"
                onClick={api.undo}
                disabled={!api.canUndo}
                aria-label="واگردانی"
                title="واگردانی (Undo)"
                className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] text-brand-700 transition hover:bg-brand-50 disabled:opacity-40"
              >
                ↺
              </button>
              <button
                type="button"
                onClick={api.redo}
                disabled={!api.canRedo}
                aria-label="انجام مجدد"
                title="انجام مجدد (Redo)"
                className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] text-brand-700 transition hover:bg-brand-50 disabled:opacity-40"
              >
                ↻
              </button>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                aria-label="درون‌ریزی سریع"
                title="درون‌ریزی فعالیت‌ها از اکسل"
                className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] text-brand-700 transition hover:bg-brand-50"
              >
                📥
              </button>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                aria-label="راهنما"
                title="راهنما و واژه‌نامه"
                className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] text-brand-700 transition hover:bg-brand-50"
              >
                ؟
              </button>
            </span>
            <Button variant="ghost" size="sm" onClick={openSaved} className="hidden sm:inline-flex">
              پروژه‌های من
            </Button>
            <Button variant="secondary" size="sm" onClick={() => downloadExport("xlsx")} disabled={busy} className="hidden xl:inline-flex">
              Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => downloadExport("package")} disabled={busy} className="hidden xl:inline-flex">
              بسته کامل
            </Button>
            <button
              type="button"
              onClick={api.undo}
              disabled={!api.canUndo}
              aria-label="واگردانی"
              className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] text-brand-700 md:hidden disabled:opacity-40"
            >
              ↺
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="راهنما"
              className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[13px] text-brand-700 md:hidden"
            >
              ؟
            </button>
            <Button size="sm" onClick={saveAndOpenReport} disabled={busy}>
              {busy ? "…" : serverProject ? "به‌روزرسانی گزارش" : "تولید گزارش"}
            </Button>
          </div>
        </div>
        <nav className="thin-scroll mx-auto hidden max-w-[1400px] gap-1 overflow-x-auto px-4 pb-2 sm:flex sm:px-6">
          {STEPS.map((item) => {
            const active = step === item.id;
            const done = step > item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStep(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold transition ${
                  active
                    ? "bg-brand-700 text-white shadow-md shadow-brand-900/20"
                    : done
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <span className="flex size-5 items-center justify-center rounded-md bg-black/10 text-[10px]">
                  {done ? "✓" : item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="px-4 pb-3 sm:hidden">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-l from-accent-400 to-brand-500 transition-all duration-500"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-500">
              {toPersianDigits(step + 1)}/{toPersianDigits(STEPS.length)}
            </span>
          </div>
          <p className="mt-1.5 truncate text-[12.5px] font-bold text-ink-900">
            {STEPS[step].icon} {STEPS[step].label}
          </p>
        </div>
      </header>

            <main
        id="builder-main"
        className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 pb-32 sm:px-6 lg:grid-cols-[1fr_320px] lg:pb-8"
      >
        <div className="animate-fade-up space-y-5">
          {/* One h1 per page: the step wizard changes the visible heading level
              per step, so the document title lives here and is hidden visually
              only (still announced by screen readers). */}
          <h1 className="sr-only">ساخت و برنامه‌ریزی پروژه در HERMIPLAN</h1>
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">{error}</div>
          ) : null}

          {step === 0 ? <StepBasics project={current} api={api} /> : null}
          {step === 1 ? <StepActivities project={current} analysis={analysis} api={api} /> : null}
          {step === 2 ? <StepResources project={current} analysis={analysis} api={api} /> : null}
          {step === 3 ? <StepCalendar project={current} api={api} /> : null}
          {step === 4 ? <StepMilestonesRisks project={current} api={api} /> : null}
          {step === 5 ? (
            <StepOutput
              reportSections={reportSections}
              setReportSections={setReportSections}
              analysis={analysis}
              project={current}
              api={api}
            />
          ) : null}

          <div className="hidden items-center justify-between gap-3 pb-4 lg:flex">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              مرحله قبل
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)}>مرحله بعد</Button>
            ) : (
              <Button variant="accent" onClick={saveAndOpenReport} disabled={busy}>
                {busy
                  ? "در حال تولید…"
                  : serverProject
                    ? "ذخیره نسخه تازه و دریافت خروجی"
                    : "ساخت نهایی پروژه و دریافت خروجی"}
              </Button>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-[124px] lg:h-fit">
          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[13.5px] font-bold text-ink-900">داشبورد زنده پروژه</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">به‌روزرسانی خودکار با هر تغییر</p>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="پیشرفت" value={formatPercent(analysis.progress.overall, 1)} tone={analysis.progress.overall >= analysis.progress.planned ? "ok" : "warn"} hint={`برنامه: ${formatPercent(analysis.progress.planned, 1)}`} />
                <StatTile label="مدت" value={`${toPersianDigits(analysis.schedule.workingDays)} روز`} hint={`پایان ${formatJalali(analysis.schedule.finishDate, { withMonthName: false })}`} />
                <StatTile label="SPI" value={String(analysis.progress.schedulePerformanceIndex || "—")} tone={analysis.progress.schedulePerformanceIndex >= 1 ? "ok" : "warn"} />
                <StatTile label="بودجه" value={formatCompact(analysis.costs.budget)} tone="accent" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-slate-500">
                  <span>امتیاز سلامت پروژه</span>
                  <span>{toPersianDigits(analysis.health.score)}/۱۰۰</span>
                </div>
                <ProgressBar value={analysis.health.score} tone={healthTone} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.health.signals.map((signal) => (
                  <Badge key={signal.label} tone={signal.status === "good" ? "ok" : signal.status === "watch" ? "warn" : "bad"}>
                    {signal.label}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[13.5px] font-bold text-ink-900">گانت چارت پیش‌نمایش</h3>
            </div>
            <div className="thin-scroll overflow-x-auto p-3">
              <GanttChart gantt={analysis.gantt} links={links} statusDate={current.meta.statusDate} compact showArrows={false} />
            </div>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[13.5px] font-bold text-ink-900">مسیر بحرانی</h3>
            </div>
            <div className="max-h-[280px] space-y-1.5 overflow-y-auto p-4">
              {analysis.criticalPath.length ? (
                analysis.criticalPath.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg bg-red-50/70 px-2.5 py-2 text-[11.5px]">
                    <span className="font-mono text-[10.5px] text-red-500">{item.code}</span>
                    <span className="truncate text-slate-700">{item.name}</span>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-slate-500">فعالیت بحرانی شناسایی نشد.</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[13.5px] font-bold text-ink-900">برآورد نهایی (مبنای بازار ایران)</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {analysis.pricing.seriesLabel} · منطقه {analysis.pricing.regionLabel} · نرخ مرجع {analysis.pricing.asOfJalali}
              </p>
            </div>
            <div className="space-y-2 p-4 text-[12px]">
              {[
                ["هزینه‌های مستقیم", formatCompact(analysis.pricing.breakdown.direct)],
                ["بالاسری، سود و احتیاط", formatCompact(analysis.pricing.breakdown.overhead + analysis.pricing.breakdown.profit + analysis.pricing.breakdown.contingency)],
                ["تعدیل قیمت", formatCompact(analysis.pricing.breakdown.escalation)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-slate-500">
                  <span>{label}</span>
                  <span className="font-semibold text-ink-900">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[13px]">
                <span className="font-bold text-ink-900">برآورد نهایی پروژه</span>
                <span className="font-extrabold text-brand-700">{formatCompact(analysis.pricing.breakdown.total)}</span>
              </div>
            </div>
          </Card>

          <p className="px-2 text-[10.5px] leading-5 text-slate-500">
            موتور محاسباتی HERMIPLAN به‌صورت مستقل و deterministic عمل می‌کند؛ زمان‌بندی، شناوری و مسیر بحرانی بر پایه الگوریتم CPM محاسبه می‌شود.
          </p>
        </aside>
      </main>

      {/* --------------------- mobile bottom action bar --------------------- */}
      <div className="hp-tabbar no-print fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-2 px-3 pt-2 lg:hidden">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-[16px] text-brand-700 transition active:scale-95 disabled:opacity-40"
          aria-label="مرحله قبل"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => setStepsOpen(true)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-1.5 active:scale-[0.98]"
        >
          <span className="text-[11px] font-bold text-ink-900">
            {STEPS[step].icon} {STEPS[step].label}
          </span>
          <span className="mt-1 text-[10px] text-slate-500">تغییر مرحله</span>
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-[16px] text-white transition active:scale-95"
            aria-label="مرحله بعد"
          >
            ‹
          </button>
        ) : (
          <button
            type="button"
            onClick={saveAndOpenReport}
            disabled={busy}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-500 text-[16px] text-ink-950 transition active:scale-95 disabled:opacity-50"
            aria-label="ساخت نهایی پروژه"
          >
            ⤓
          </button>
        )}
      </div>

      {/* --------------------------- steps sheet --------------------------- */}
      <Modal open={stepsOpen} onClose={() => setStepsOpen(false)} title="مراحل ساخت پروژه">
        <div className="space-y-2">
          {STEPS.map((item, index) => {
            const active = step === item.id;
            const done = step > item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setStep(item.id);
                  setStepsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-right transition active:scale-[0.99] ${
                  active ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-[15px] ${
                    active ? "bg-brand-600 text-white" : done ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {done ? "✓" : item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink-900">{item.label}</span>
                  <span className="block text-[11px] text-slate-500">مرحله {toPersianDigits(index + 1)} از {toPersianDigits(STEPS.length)}</span>
                </span>
                {active ? <span className="text-[10px] font-bold text-brand-700">فعلی</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            📥 درون‌ریزی از اکسل
          </Button>
          <Button variant="secondary" size="sm" onClick={api.undo} disabled={!api.canUndo}>
            ↺ واگردانی
          </Button>
          <Button variant="secondary" size="sm" onClick={api.redo} disabled={!api.canRedo}>
            ↻ انجام مجدد
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setHelpOpen(true)}>
            ؟ راهنما
          </Button>
          <AuthMenu />
          <Button variant="secondary" size="sm" onClick={() => downloadExport("xlsx")} disabled={busy}>
            Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadExport("msproject")} disabled={busy}>
            MS Project
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadExport("package")} disabled={busy}>
            بسته کامل
          </Button>
          <Button variant="secondary" size="sm" onClick={openSaved}>
            پروژه‌های من
          </Button>
        </div>
        <p className="mt-4 flex items-center gap-2 text-[10.5px] text-slate-500">
          <LogoMark size="xs" /> {CREATOR_CREDIT_FULL}
        </p>
      </Modal>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} project={current} api={api} />

      <Modal
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        title="به HERMIPLAN خوش آمدید"
        footer={
          <Button onClick={() => setWelcomeOpen(false)}>شروع کنیم</Button>
        }
      >
        <div className="space-y-3 text-[12.5px] leading-7 text-slate-600">
          <p>
            برای ساخت گزارش حرفه‌ای پروژه لازم نیست چیزی درباره مسیر بحرانی یا شناوری بدانید.
            فقط سه کار ساده:
          </p>
          <div className="space-y-2">
            {[
              ["۱", "در مرحله اول نوع پروژه را انتخاب کنید تا ساختار آماده ساخته شود."],
              ["۲", "در مرحله دوم فعالیت‌ها را با «افزودن سریع» یا درون‌ریزی از اکسل وارد کنید."],
              ["۳", "در مرحله آخر «ساخت نهایی پروژه» را بزنید و گزارش را در ۷ فرمت دریافت کنید."],
            ].map(([step, text]) => (
              <div key={step} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-[12px] font-bold text-white">
                  {step}
                </span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <p className="rounded-xl bg-brand-50/70 p-3 text-[11.5px] text-brand-800">
            پیش‌نویس شما به‌صورت خودکار در همین مرورگر ذخیره می‌شود و هر تغییری را می‌توانید با دکمه «واگردانی» برگردانید.
          </p>
        </div>
      </Modal>

      <Modal open={savedList !== null || savedError !== null} onClose={() => { setSavedList(null); setSavedError(null); }} title="پروژه‌های ذخیره‌شده">
        {savedError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">{savedError}</p>
        ) : null}
        {savedList && savedList.length ? (
          <div className="space-y-2">
            {savedList.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-brand-400 hover:bg-brand-50/40"
              >
                <button
                  type="button"
                  onClick={() => loadSaved(item.id)}
                  className="min-w-0 flex-1 text-right"
                  title="باز کردن در سازنده"
                >
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{item.name}</span>
                  <span className="block text-[11px] text-slate-500">
                    {formatJalali(item.updatedAt.slice(0, 10), { withMonthName: false })}
                  </span>
                </button>
                {/* A direct route to the report: the list already carries the
                    capability key, so opening it never depends on a cookie. */}
                <button
                  type="button"
                  onClick={() => router.push(reportUrl(item.id, item.viewKey))}
                  className="shrink-0 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-brand-800 transition hover:bg-brand-50"
                >
                  گزارش
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-slate-500">
            {savedList === null ? "در حال بارگذاری…" : savedError ? "" : "پروژه ذخیره‌شده‌ای یافت نشد."}
          </p>
        )}
        {savedMore?.nextOffset ? (
          <button
            type="button"
            onClick={() => void loadMoreSaved()}
            disabled={savedBusy}
            className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2 text-[12px] font-semibold text-brand-700 transition hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-50"
          >
            {savedBusy
              ? "در حال بارگذاری…"
              : `نمایش پروژه‌های بیشتر (${toPersianDigits(String(savedMore.total))} پروژه در کل)`}
          </button>
        ) : null}
        <p className="mt-4 text-[11.5px] leading-6 text-slate-500">
          پروژه‌های مهمان به همین مرورگر وابسته‌اند. برای انتقال به دستگاه یا مرورگر دیگر، فایل پشتیبان بگیرید؛
          و برای دیدن گزارش با شخص دیگر، از «لینک اشتراک» در صفحه گزارش استفاده کنید.
        </p>

        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-[12px] font-bold text-ink-900">فایل پشتیبان پروژه</p>
          <p className="text-[11px] leading-6 text-slate-600">
            یک فایل JSON از پروژه جاری و بخش‌های گزارش می‌سازد. همین فایل را می‌توانید در مرورگر دیگر بازگردانی کنید؛
            محتوا هنگام بازگردانی دوباره اعتبارسنجی می‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={downloadProjectFile}>
              دریافت فایل پشتیبان
            </Button>
            <label
              className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-brand-700 transition hover:border-brand-400 hover:bg-brand-50/40"
            >
              بازیابی از فایل
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="بازیابی پروژه از فایل پشتیبان"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void restoreProjectFile(file);
                }}
              />
            </label>
          </div>
          {fileMessage ? (
            <p
              role="status"
              className={`rounded-lg px-3 py-2 text-[11.5px] font-semibold ${
                fileMessage.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
              }`}
            >
              {fileMessage.text}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

export function BuilderFallback() {
  return <BuilderApp initial={buildProjectFromTemplate("general")} />;
}
