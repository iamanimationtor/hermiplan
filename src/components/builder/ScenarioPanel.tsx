"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Badge, Card, CardHeader, StatTile } from "@/components/ui";
import { runScenario } from "@/lib/engine/normalize";
import { DEFAULT_PRICING } from "@/lib/market/engine";
import { formatCompact, formatJalali, toPersianDigits } from "@/lib/date-fa";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

/**
 * تحلیل سناریو / What-if — با یک تغییر ساده، اثر آن روی تاریخ پایان و
 * برآورد هزینه پروژه به‌صورت زنده محاسبه می‌شود (بدون تغییر داده اصلی پروژه).
 */
export function ScenarioPanel({
  project,
  analysis,
}: {
  project: ProjectInput;
  analysis: ProjectAnalysis;
}) {
  const [criticalSlip, setCriticalSlip] = useState(3);
  const [paceFactor, setPaceFactor] = useState(100);
  const [inflation, setInflation] = useState(project.pricing?.escalationRatePerMonth ?? 3);
  const deferred = useDeferredValue({ criticalSlip, paceFactor, inflation });
  const busy =
    deferred.criticalSlip !== criticalSlip || deferred.paceFactor !== paceFactor || deferred.inflation !== inflation;

  const scenarios = useMemo(() => {
    const { criticalSlip: slip, paceFactor, inflation: rate } = deferred;

    const slipScenario = runScenario(project, (draft) => {
      draft.activities = draft.activities.map((activity) =>
        analysis.activities.find((a) => a.id === activity.id && a.critical)
          ? { ...activity, duration: activity.duration + slip }
          : activity,
      );
    });

    const paceScenario = runScenario(project, (draft) => {
      draft.activities = draft.activities.map((activity) => ({
        ...activity,
        duration: Math.max(0, Math.round((activity.duration * paceFactor) / 100)),
      }));
    });

    const costScenario = runScenario(project, (draft) => {
      draft.pricing = { ...DEFAULT_PRICING, ...(draft.pricing ?? {}), escalationEnabled: true, escalationRatePerMonth: rate };
    });

    return { slipScenario, paceScenario, costScenario };
  }, [project, analysis.activities, deferred]);

  const rows: { label: string; base: string; what: string; delta: string; tone: "ok" | "warn" | "bad" }[] = [
    {
      label: `تأخیر ${toPersianDigits(deferred.criticalSlip)} روزه در فعالیت‌های بحرانی`,
      base: formatJalali(analysis.schedule.finishDate, { withMonthName: false }),
      what: formatJalali(scenarios.slipScenario.schedule.finishDate, { withMonthName: false }),
      delta:
        scenarios.slipScenario.schedule.workingDays - analysis.schedule.workingDays > 0
          ? `+${toPersianDigits(scenarios.slipScenario.schedule.workingDays - analysis.schedule.workingDays)} روز`
          : "بدون تغییر",
      tone: scenarios.slipScenario.schedule.workingDays > analysis.schedule.workingDays ? "bad" : "ok",
    },
    {
      label: `سرعت اجرا ${toPersianDigits(deferred.paceFactor)}٪ (منابع/کارایی)`,
      base: `${toPersianDigits(analysis.schedule.workingDays)} روز`,
      what: `${toPersianDigits(scenarios.paceScenario.schedule.workingDays)} روز`,
      delta:
        scenarios.paceScenario.schedule.workingDays !== analysis.schedule.workingDays
          ? `${scenarios.paceScenario.schedule.workingDays > analysis.schedule.workingDays ? "+" : ""}${toPersianDigits(
              scenarios.paceScenario.schedule.workingDays - analysis.schedule.workingDays,
            )} روز`
          : "بدون تغییر",
      tone: scenarios.paceScenario.schedule.workingDays > analysis.schedule.workingDays ? "warn" : "ok",
    },
    {
      label: `نرخ تعدیل ماهانه ${toPersianDigits(deferred.inflation)}٪`,
      base: formatCompact(analysis.pricing.breakdown.total),
      what: formatCompact(scenarios.costScenario.pricing.breakdown.total),
      delta: formatCompact(scenarios.costScenario.pricing.breakdown.total - analysis.pricing.breakdown.total),
      tone: scenarios.costScenario.pricing.breakdown.total > analysis.pricing.breakdown.total ? "warn" : "ok",
    },
  ];

  return (
    <Card>
      <CardHeader
        title="تحلیل سناریو (What-if)"
        subtitle="اثر هر تغییر را روی تاریخ پایان و برآورد هزینه ببینید — بدون اینکه برنامه اصلی پروژه دست بخورد."
        icon={<span className="text-lg">🔮</span>}
        action={<Badge tone={busy ? "warn" : "ok"}>{busy ? "در حال محاسبه…" : "به‌روز"}</Badge>}
      />
      <div className="space-y-5 p-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
              تأخیر در فعالیت‌های بحرانی: {toPersianDigits(deferred.criticalSlip)} روز
            </label>
            <input
              type="range"
              min={0}
              max={30}
              value={criticalSlip}
              onChange={(e) => setCriticalSlip(Number(e.target.value))}
              className="w-full accent-brand-600"
              aria-label="تأخیر در فعالیت‌های بحرانی"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              اگر هر فعالیت بحرانی این مقدار دیرتر تمام شود، پایان پروژه چقدر جابه‌جا می‌شود؟
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
              سرعت اجرا: {toPersianDigits(deferred.paceFactor)}٪
            </label>
            <input
              type="range"
              min={50}
              max={150}
              step={5}
              value={paceFactor}
              onChange={(e) => setPaceFactor(Number(e.target.value))}
              className="w-full accent-brand-600"
              aria-label="سرعت اجرا"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              با منابع بیشتر (کمتر از ۱۰۰) یا کمبود نیرو (بیشتر از ۱۰۰) مدت فعالیت‌ها تغییر می‌کند.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">
              نرخ تعدیل ماهانه: {toPersianDigits(deferred.inflation)}٪
            </label>
            <input
              type="range"
              min={0}
              max={15}
              step={0.5}
              value={inflation}
              onChange={(e) => setInflation(Number(e.target.value))}
              className="w-full accent-brand-600"
              aria-label="نرخ تعدیل ماهانه"
            />
            <p className="mt-1 text-[11px] text-slate-500">اثر تورم بر برآورد نهایی پروژه.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {rows.map((row) => (
            <StatTile key={row.label} label={row.label} value={row.what} hint={`مقدار فعلی: ${row.base} · تغییر: ${row.delta}`} tone={row.tone} />
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                {["سناریو", "مقدار فعلی", "با تغییر", "اختلاف"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-right font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-ink-900">{row.label}</td>
                  <td className="px-3 py-2 text-slate-500">{row.base}</td>
                  <td className="px-3 py-2 font-bold text-ink-900">{row.what}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.tone}>{row.delta}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] leading-6 text-slate-500">
          محاسبات این بخش با همان موتور اصلی پروژه (CPM و تعدیل کارکرد ماهانه) انجام می‌شود و هیچ تغییری در داده پروژه شما ایجاد نمی‌کند.
          برای اعمال دائمی یک سناریو، مدت فعالیت‌ها یا نرخ تعدیل را در مراحل قبل تغییر دهید.
        </p>
      </div>
    </Card>
  );
}
