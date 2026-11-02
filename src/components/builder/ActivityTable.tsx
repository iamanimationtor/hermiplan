"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import type { ActivityInput, ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import { formatCompact, formatJalali, toPersianDigits } from "@/lib/date-fa";
import type { ProjectApi } from "./useProject";

const DEP_LABELS: Record<string, string> = {
  FS: "پایان به شروع",
  SS: "شروع به شروع",
  FF: "پایان به پایان",
  SF: "شروع به پایان",
};

const PAGE_SIZE = 40;

function StatusCell({ activity }: { activity: ProjectAnalysis["activities"][number] }) {
  if (activity.milestone) return <Badge tone="accent">نقطه کنترل</Badge>;
  if (activity.status === "completed") return <Badge tone="ok">تکمیل‌شده</Badge>;
  if (activity.status === "late") return <Badge tone="bad">در تأخیر</Badge>;
  if (activity.status === "in-progress") return <Badge tone="info">در حال اجرا</Badge>;
  return <Badge>شروع‌نشده</Badge>;
}

export function ActivityTable({
  project,
  analysis,
  api,
}: {
  project: ProjectInput;
  analysis: ProjectAnalysis;
  api: ProjectApi;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | "activity" | "milestone">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"schedule" | "float" | "progress" | "cost">("schedule");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const phases = useMemo(
    () => Array.from(new Set(project.activities.map((a) => a.phase))),
    [project.activities],
  );

  const rows = useMemo(() => {
    const result = analysis.activities
      .map((a) => ({ analysis: a, input: project.activities.find((p) => p.id === a.id) }))
      .filter((row) => {
        if (!row.input) return false;
        if (phaseFilter !== "all" && row.input.phase !== phaseFilter) return false;
        if (kindFilter === "activity" && row.analysis.milestone) return false;
        if (kindFilter === "milestone" && !row.analysis.milestone) return false;
        if (resourceFilter === "assigned" && row.input.resources.length === 0) return false;
        if (resourceFilter === "unassigned" && row.input.resources.length > 0) return false;
        if (resourceFilter !== "all" && resourceFilter !== "assigned" && resourceFilter !== "unassigned" && !row.input.resources.some((resource) => resource.resourceId === resourceFilter)) return false;
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const searchable = `${row.input.name} ${row.input.code} ${row.input.phase} ${row.input.deliverable ?? ""} ${row.input.notes ?? ""} ${row.analysis.resourceNames.join(" ")}`.toLocaleLowerCase();
        if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
        if (onlyCritical && !row.analysis.critical) return false;
        if (statusFilter !== "all" && row.analysis.status !== statusFilter) return false;
        return true;
      });

    return result.sort((a, b) => {
      if (sort === "float") return a.analysis.totalFloat - b.analysis.totalFloat || a.analysis.es - b.analysis.es;
      if (sort === "progress") return b.analysis.progress - a.analysis.progress;
      if (sort === "cost") return b.analysis.budgetCost - a.analysis.budgetCost;
      return a.analysis.es - b.analysis.es;
    });
  }, [analysis.activities, project.activities, phaseFilter, query, statusFilter, resourceFilter, kindFilter, sort, onlyCritical]);

  const shown = rows.slice(0, visible);
  const editingActivity = project.activities.find((a) => a.id === editing) ?? null;

  const resetFilters = () => {
    setPhaseFilter("all");
    setStatusFilter("all");
    setResourceFilter("all");
    setKindFilter("all");
    setQuery("");
    setOnlyCritical(false);
    setSort("schedule");
    setVisible(PAGE_SIZE);
  };

  const filtersActive =
    phaseFilter !== "all" || statusFilter !== "all" || resourceFilter !== "all" || kindFilter !== "all" || Boolean(query) || onlyCritical || sort !== "schedule";

  return (
    <div className="space-y-4">
      {/* ------------------------------ filters ------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="جستجوی فعالیت، کد، فاز یا منبع…"
          aria-label="جستجو در فعالیت‌ها"
          className="h-10 w-full max-w-[210px] py-2 sm:w-auto"
        />
        <Select
          value={phaseFilter}
          onChange={(e) => {
            setPhaseFilter(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          aria-label="فیلتر بر اساس فاز"
          className="h-10 w-full max-w-[170px] py-2 sm:w-auto"
        >
          <option value="all">همه فازها</option>
          {phases.map((phase) => (
            <option key={phase} value={phase}>
              {phase}
            </option>
          ))}
        </Select>
        <Select
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value as typeof kindFilter);
            setVisible(PAGE_SIZE);
          }}
          aria-label="فیلتر بر اساس نوع ردیف"
          className="h-10 w-full max-w-[160px] py-2 sm:w-auto"
        >
          <option value="all">فعالیت و نقطه کنترل</option>
          <option value="activity">فعالیت‌ها</option>
          <option value="milestone">نقاط کنترل</option>
        </Select>
        <Select
          value={resourceFilter}
          onChange={(e) => {
            setResourceFilter(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          aria-label="فیلتر بر اساس تخصیص منبع"
          className="h-10 w-full max-w-[190px] py-2 sm:w-auto"
        >
          <option value="all">همه تخصیص‌ها</option>
          <option value="assigned">دارای منبع</option>
          <option value="unassigned">بدون منبع</option>
          {project.resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.name}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          aria-label="فیلتر بر اساس وضعیت"
          className="h-10 w-full max-w-[150px] py-2 sm:w-auto"
        >
          <option value="all">همه وضعیت‌ها</option>
          <option value="not-started">شروع‌نشده</option>
          <option value="in-progress">در حال اجرا</option>
          <option value="completed">تکمیل‌شده</option>
          <option value="late">در تأخیر</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setVisible(PAGE_SIZE);
          }}
          aria-label="مرتب‌سازی فعالیت‌ها"
          className="h-10 w-full max-w-[175px] py-2 sm:w-auto"
        >
          <option value="schedule">مرتب‌سازی: زمان شروع</option>
          <option value="float">مرتب‌سازی: کمترین شناوری</option>
          <option value="progress">مرتب‌سازی: بیشترین پیشرفت</option>
          <option value="cost">مرتب‌سازی: بیشترین هزینه</option>
        </Select>
        <button
          type="button"
          aria-pressed={onlyCritical}
          onClick={() => setOnlyCritical((v) => !v)}
          className={`h-10 rounded-xl border px-3 text-[12.5px] font-semibold transition ${
            onlyCritical
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-red-200"
          }`}
        >
          فقط بحرانی
        </button>
        {filtersActive ? (
          <button
            type="button"
            onClick={resetFilters}
            className="h-10 rounded-xl px-3 text-[12.5px] font-semibold text-slate-500 transition hover:bg-slate-100"
          >
            پاک‌کردن فیلترها
          </button>
        ) : null}
        <div className="flex-1" />
        <span className="text-[11.5px] text-slate-500" role="status" aria-live="polite">
          نمایش {toPersianDigits(shown.length)} از {toPersianDigits(rows.length)} فعالیت
        </span>
      </div>

      {/* --------------------------- desktop table --------------------------- */}
      <div className="thin-scroll hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              {["کد", "عنوان فعالیت", "فاز", "مدت", "پیش‌نیاز", "منابع", "پیشرفت", "شروع", "پایان", "شناوری", "بودجه", "وضعیت", ""].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ analysis: a, input }) => (
              <tr key={a.id} className="border-t border-slate-100 transition hover:bg-brand-50/40">
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{a.code}</td>
                <td className="min-w-[220px] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setEditing(a.id)}
                    className="text-right font-semibold text-ink-900 hover:text-brand-700"
                  >
                    {a.name}
                  </button>
                  {a.critical ? (
                    <span className="ms-2 inline-block size-1.5 rounded-full bg-red-500 align-middle" title="روی مسیر بحرانی" />
                  ) : null}
                </td>
                <td className="max-w-[150px] truncate px-3 py-2 text-slate-500">{a.phase}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    value={input?.duration ?? 0}
                    onChange={(e) => api.updateActivity(a.id, { duration: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-[12px] outline-none focus:border-brand-400"
                    aria-label="مدت فعالیت به روز کاری"
                  />
                </td>
                <td className="px-3 py-2 text-slate-500">{toPersianDigits(input?.predecessors.length ?? 0)}</td>
                <td className="max-w-[150px] truncate px-3 py-2 text-slate-500">
                  {a.resourceNames.length ? a.resourceNames.join("، ") : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={a.progress}
                      onChange={(e) => api.updateActivity(a.id, { progress: Number(e.target.value) })}
                      className="w-16 accent-brand-600"
                      aria-label="درصد پیشرفت"
                    />
                    <span className="w-9 text-[11px] text-slate-500">{toPersianDigits(Math.round(a.progress))}٪</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[11px] text-slate-500">
                  {formatJalali(a.startDate, { withMonthName: false })}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[11px] text-slate-500">
                  {formatJalali(a.finishDate, { withMonthName: false })}
                </td>
                <td className="px-3 py-2">
                  {a.totalFloat < 0 ? (
                    <span className="font-bold text-red-600">پشت برنامه</span>
                  ) : a.totalFloat === 0 ? (
                    <span className="font-bold text-red-600">بحرانی</span>
                  ) : (
                    <span className="text-slate-500">{toPersianDigits(a.totalFloat)} روز</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[11.5px] text-slate-600">
                  {project.meta.currency === "IRR" ? formatCompact(a.budgetCost) : toPersianDigits(a.budgetCost)}
                </td>
                <td className="px-3 py-2">
                  <StatusCell activity={a} />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(a.id)}
                      className="rounded-lg px-2 py-1 text-[11px] text-brand-700 transition hover:bg-brand-50"
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      onClick={() => api.duplicateActivity(a.id)}
                      className="rounded-lg px-2 py-1 text-[11px] text-slate-500 transition hover:bg-slate-100"
                    >
                      کپی
                    </button>
                    <button
                      type="button"
                      onClick={() => api.removeActivity(a.id)}
                      className="rounded-lg px-2 py-1 text-[11px] text-red-500 transition hover:bg-red-50"
                    >
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-[13px] text-slate-500">
                  فعالیتی با این فیلترها یافت نشد.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ---------------------------- mobile cards ---------------------------- */}
      <div className="space-y-2.5 md:hidden">
        {shown.map(({ analysis: a, input }) => (
          <div key={a.id} className="hp-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] text-slate-500">{a.code}</span>
                  {a.critical ? <Badge tone="bad">بحرانی</Badge> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(a.id)}
                  className="mt-1 block text-right text-[13.5px] font-bold leading-6 text-ink-900"
                >
                  {a.name}
                </button>
                <p className="mt-0.5 text-[11px] text-slate-500">{a.phase}</p>
                <p className="mt-1 break-words text-[10.5px] leading-5 text-slate-500">
                  منابع: {a.resourceNames.join("، ") || "—"} · پیش‌نیاز: {toPersianDigits(input?.predecessors.length ?? 0)}
                </p>
              </div>
              <StatusCell activity={a} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["مدت", `${toPersianDigits(a.duration)} روز`],
                ["شروع", formatJalali(a.startDate, { withMonthName: false })],
                ["پایان", formatJalali(a.finishDate, { withMonthName: false })],
                ["شناوری", a.totalFloat < 0 ? "پشت برنامه" : a.totalFloat === 0 ? "بحرانی" : `${toPersianDigits(a.totalFloat)} روز`],
                ["بودجه", formatCompact(a.budgetCost)],
                ["پیشرفت", `${toPersianDigits(Math.round(a.progress))}٪`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 py-1.5">
                  <p className="text-[9.5px] text-slate-500">{label}</p>
                  <p className="text-[11.5px] font-bold text-ink-900">{value}</p>
                </div>
              ))}
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={a.progress}
              onChange={(e) => api.updateActivity(a.id, { progress: Number(e.target.value) })}
              className="mt-3 w-full accent-brand-600"
              aria-label={`پیشرفت ${a.name}`}
            />

            <div className="mt-3 flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(a.id)} className="flex-1">
                ویرایش
              </Button>
              <Button variant="secondary" size="sm" onClick={() => api.duplicateActivity(a.id)}>
                کپی
              </Button>
              <Button variant="danger" size="sm" onClick={() => api.removeActivity(a.id)}>
                حذف
              </Button>
            </div>
          </div>
        ))}
        {!shown.length ? (
          <p className="py-8 text-center text-[13px] text-slate-500">فعالیتی با این فیلترها یافت نشد.</p>
        ) : null}
      </div>

      {rows.length > shown.length ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            نمایش {toPersianDigits(Math.min(PAGE_SIZE, rows.length - shown.length))} فعالیت بیشتر
          </Button>
          <span className="text-[11.5px] text-slate-500">
            {toPersianDigits(shown.length)} از {toPersianDigits(rows.length)}
          </span>
        </div>
      ) : null}

      {/* ------------------------------ editor ------------------------------ */}
      <Modal
        open={Boolean(editingActivity)}
        onClose={() => setEditing(null)}
        title="ویرایش فعالیت"
        wide
        footer={
          <>
            <span className="me-auto text-[11px] text-slate-500">تغییرات به‌صورت زنده ذخیره می‌شوند</span>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              بستن
            </Button>
            <Button onClick={() => setEditing(null)}>پایان ویرایش</Button>
          </>
        }
      >
        {editingActivity ? <ActivityEditor activity={editingActivity} project={project} api={api} /> : null}
      </Modal>
    </div>
  );
}

function ActivityEditor({
  activity,
  project,
  api,
}: {
  activity: ActivityInput;
  project: ProjectInput;
  api: ProjectApi;
}) {
  const phases = Array.from(new Set(project.activities.map((a) => a.phase)));
  const others = project.activities.filter((a) => a.id !== activity.id);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="عنوان فعالیت" className="md:col-span-2">
        <Input value={activity.name} onChange={(e) => api.updateActivity(activity.id, { name: e.target.value })} />
      </Field>
      <Field label="کد فعالیت">
        <Input value={activity.code} onChange={(e) => api.updateActivity(activity.id, { code: e.target.value })} dir="ltr" />
      </Field>
      <Field label="فاز / بسته کاری">
        <Select value={activity.phase} onChange={(e) => api.updateActivity(activity.id, { phase: e.target.value })}>
          {phases.map((phase) => (
            <option key={phase} value={phase}>
              {phase}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="مدت (روز کاری)">
        <Input
          type="number"
          min={0}
          value={activity.duration}
          onChange={(e) => api.updateActivity(activity.id, { duration: Number(e.target.value) })}
        />
      </Field>
      <Field label="درصد پیشرفت">
        <Input
          type="number"
          min={0}
          max={100}
          value={activity.progress}
          onChange={(e) => api.updateActivity(activity.id, { progress: Number(e.target.value) })}
        />
      </Field>

      <div className="md:col-span-2 rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[13px] font-bold text-ink-900">وابستگی‌ها (پیش‌نیازها)</h4>
          <span className="text-[11px] text-slate-500">نوع رابطه و تأخیر (Lag) قابل تنظیم است</span>
        </div>
        <div className="space-y-2">
          {activity.predecessors.map((dep, index) => (
            <div key={`${dep.predecessorId}-${index}`} className="flex flex-wrap items-center gap-2">
              <Select
                value={dep.predecessorId}
                onChange={(e) => {
                  const predecessors = [...activity.predecessors];
                  predecessors[index] = { ...dep, predecessorId: e.target.value };
                  api.updateActivity(activity.id, { predecessors });
                }}
                className="max-w-[220px] flex-1"
              >
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.name}
                  </option>
                ))}
              </Select>
              <Select
                value={dep.type}
                onChange={(e) => {
                  const predecessors = [...activity.predecessors];
                  predecessors[index] = { ...dep, type: e.target.value as typeof dep.type };
                  api.updateActivity(activity.id, { predecessors });
                }}
                className="max-w-[150px]"
              >
                {Object.entries(DEP_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                value={dep.lag}
                onChange={(e) => {
                  const predecessors = [...activity.predecessors];
                  predecessors[index] = { ...dep, lag: Number(e.target.value) };
                  api.updateActivity(activity.id, { predecessors });
                }}
                className="max-w-[90px]"
                aria-label="تأخیر"
              />
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  api.updateActivity(activity.id, {
                    predecessors: activity.predecessors.filter((_, i) => i !== index),
                  })
                }
              >
                حذف
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={!others.length}
            onClick={() =>
              api.updateActivity(activity.id, {
                predecessors: [...activity.predecessors, { predecessorId: others[0]?.id ?? "", type: "FS", lag: 0 }],
              })
            }
          >
            + افزودن پیش‌نیاز
          </Button>
        </div>
      </div>

      <div className="md:col-span-2 rounded-xl border border-slate-200 p-3">
        <h4 className="mb-2 text-[13px] font-bold text-ink-900">منابع اختصاص‌یافته</h4>
        <div className="space-y-2">
          {activity.resources.map((assignment, index) => {
            const resource = project.resources.find((r) => r.id === assignment.resourceId);
            return (
              <div key={`${assignment.resourceId}-${index}`} className="flex flex-wrap items-center gap-2">
                <Select
                  value={assignment.resourceId}
                  onChange={(e) => {
                    const resources = [...activity.resources];
                    resources[index] = { ...assignment, resourceId: e.target.value };
                    api.updateActivity(activity.id, { resources });
                  }}
                  className="max-w-[220px] flex-1"
                >
                  {project.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={assignment.units}
                  onChange={(e) => {
                    const resources = [...activity.resources];
                    resources[index] = { ...assignment, units: Number(e.target.value) };
                    api.updateActivity(activity.id, { resources });
                  }}
                  className="max-w-[110px]"
                  aria-label="تعداد واحد"
                />
                <span className="text-[11px] text-slate-500">
                  {resource ? `${toPersianDigits(resource.rate)} / ${resource.unit ?? "روز"}` : ""}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    api.updateActivity(activity.id, {
                      resources: activity.resources.filter((_, i) => i !== index),
                    })
                  }
                >
                  حذف
                </Button>
              </div>
            );
          })}
          <Button
            variant="secondary"
            size="sm"
            disabled={!project.resources.length}
            onClick={() =>
              api.updateActivity(activity.id, {
                resources: [...activity.resources, { resourceId: project.resources[0]?.id ?? "", units: 1 }],
              })
            }
          >
            + افزودن منبع
          </Button>
        </div>
      </div>

      <Field label="هزینه ثابت (ریال)">
        <Input
          type="number"
          min={0}
          value={activity.fixedCost}
          onChange={(e) => api.updateActivity(activity.id, { fixedCost: Number(e.target.value) })}
        />
      </Field>
      <Field label="هزینه مصالح / مواد (ریال)">
        <Input
          type="number"
          min={0}
          value={activity.materialCost}
          onChange={(e) => api.updateActivity(activity.id, { materialCost: Number(e.target.value) })}
        />
      </Field>
      <Field label="نوع محدودیت زمانی" hint="برای مدیریت تاریخ‌های اجباری کارفرما استفاده می‌شود">
        <Select
          value={activity.constraintType}
          onChange={(e) =>
            api.updateActivity(activity.id, { constraintType: e.target.value as ActivityInput["constraintType"] })
          }
        >
          <option value="ASAP">در اولین زمان ممکن (پیش‌فرض)</option>
          <option value="SNET">شروع نه زودتر از تاریخ</option>
          <option value="MSO">باید در تاریخ مشخص شروع شود</option>
        </Select>
      </Field>
      <Field label="تاریخ محدودیت">
        <Input
          type="date"
          value={activity.constraintDate ?? ""}
          onChange={(e) => api.updateActivity(activity.id, { constraintDate: e.target.value })}
        />
      </Field>
      <Field label="احتمال ریسک (۱ تا ۵)">
        <Input
          type="number"
          min={1}
          max={5}
          value={activity.riskProbability ?? 1}
          onChange={(e) => api.updateActivity(activity.id, { riskProbability: Number(e.target.value) })}
        />
      </Field>
      <Field label="شدت اثر ریسک (۱ تا ۵)">
        <Input
          type="number"
          min={1}
          max={5}
          value={activity.riskImpact ?? 1}
          onChange={(e) => api.updateActivity(activity.id, { riskImpact: Number(e.target.value) })}
        />
      </Field>
      <Field label="توضیحات / خروجی قابل تحویل" className="md:col-span-2">
        <Textarea
          value={activity.notes ?? ""}
          onChange={(e) => api.updateActivity(activity.id, { notes: e.target.value })}
          placeholder="مثلاً: تحویل نقشه‌های تأییدشده توسط دستگاه نظارت"
        />
      </Field>
      <p className="md:col-span-2 text-[11.5px] text-slate-500">
        سیستم به‌صورت خودکار زمان‌بندی، مسیر بحرانی و شناوری این فعالیت را محاسبه می‌کند.
      </p>
    </div>
  );
}
