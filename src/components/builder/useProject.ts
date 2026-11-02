"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { analyzeProject } from "@/lib/engine/analysis";
import { createBaseline } from "@/lib/engine/normalize";
import { buildProjectFromTemplate } from "@/lib/templates";
import { applyMarketRates, DEFAULT_PRICING, effectiveRate } from "@/lib/market/engine";
import { toLatinDigits } from "@/lib/date-fa";
import { RATE_CATALOG, findRate, guessRateKey, resolveRate, SERIES_LABELS } from "@/lib/market/rates";
import type { ProjectAnalysis, ProjectInput, ProjectPricing } from "@/lib/engine/types";

const STORAGE_KEY = "hermiplan:draft:v1";

export function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function loadDraft(): ProjectInput | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectInput;
  } catch {
    return null;
  }
}

const HISTORY_LIMIT = 40;

export function useProject(initial: ProjectInput) {
  const [project, setProject] = useState<ProjectInput>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [past, setPast] = useState<ProjectInput[]>([]);
  const [future, setFuture] = useState<ProjectInput[]>([]);

  /** every mutation funnels through here so undo/redo always works */
  const commit = useCallback((updater: (previous: ProjectInput) => ProjectInput) => {
    setProject((previous) => {
      const next = updater(previous);
      if (next === previous) return previous;
      setPast((history) => [...history.slice(-HISTORY_LIMIT), previous]);
      setFuture([]);
      return next;
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setPast((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setProject((current) => {
        setFuture((upcoming) => [current, ...upcoming].slice(0, HISTORY_LIMIT));
        return previous;
      });
      return history.slice(0, -1);
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setFuture((upcoming) => {
      if (!upcoming.length) return upcoming;
      const next = upcoming[0];
      setProject((current) => {
        setPast((history) => [...history, current]);
        return next;
      });
      return upcoming.slice(1);
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    // only persist after an actual change, so restoring a stored draft can
    // never be overwritten by the pristine template rendered on first paint
    if (!dirty) return;
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSavedAt(new Date());
        setDirty(false);
      } catch {
        /* storage full or unavailable — draft stays in memory */
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [project, dirty]);

  const patch = useCallback(
    (mutate: (draft: ProjectInput) => void) => {
      commit((previous) => {
        const draft = structuredClone(previous) as ProjectInput;
        mutate(draft);
        return draft;
      });
    },
    [commit],
  );

  const api = useMemo(
    () => ({
      replace(next: ProjectInput) {
        commit(() => next);
      },
      undo,
      redo,
      setMeta(meta: Partial<ProjectInput["meta"]>) {
        patch((d) => {
          d.meta = { ...d.meta, ...meta };
        });
      },
      setCalendar(calendar: Partial<ProjectInput["calendar"]>) {
        patch((d) => {
          d.calendar = { ...d.calendar, ...calendar };
        });
      },
      addActivity(phase?: string) {
        const id = newId("a");
        patch((d) => {
          const codes = d.activities.map((a) => Number(a.code.replace(/\D/g, "")) || 0);
          const nextCode = `A${Math.max(10, ...codes) + 10}`;
          d.activities.push({
            id,
            code: nextCode,
            name: "فعالیت جدید",
            phase: phase ?? d.activities[d.activities.length - 1]?.phase ?? "فاز ۱",
            duration: 5,
            predecessors: [],
            progress: 0,
            resources: [],
            fixedCost: 0,
            materialCost: 0,
            constraintType: "ASAP",
            milestone: false,
          });
        });
        return id;
      },
      updateActivity(id: string, changes: Partial<ProjectInput["activities"][number]>) {
        patch((d) => {
          const index = d.activities.findIndex((a) => a.id === id);
          if (index >= 0) d.activities[index] = { ...d.activities[index], ...changes };
        });
      },
      removeActivity(id: string) {
        patch((d) => {
          d.activities = d.activities.filter((a) => a.id !== id);
          d.activities = d.activities.map((a) => ({
            ...a,
            predecessors: a.predecessors.filter((p) => p.predecessorId !== id),
          }));
          d.milestones = d.milestones.filter((m) => m.activityId !== id);
        });
      },
      duplicateActivity(id: string) {
        patch((d) => {
          const source = d.activities.find((a) => a.id === id);
          if (!source) return;
          const codes = d.activities.map((a) => Number(a.code.replace(/\D/g, "")) || 0);
          d.activities.push({
            ...structuredClone(source),
            id: newId("a"),
            code: `A${Math.max(10, ...codes) + 10}`,
            name: `${source.name} (کپی)`,
            predecessors: [],
          });
        });
      },
      addResource() {
        patch((d) => {
          d.resources.push({
            id: newId("r"),
            name: "منبع جدید",
            type: "labor",
            rate: 0,
            capacity: 1,
          });
        });
      },
      updateResource(id: string, changes: Partial<ProjectInput["resources"][number]>) {
        patch((d) => {
          const index = d.resources.findIndex((r) => r.id === id);
          if (index >= 0) d.resources[index] = { ...d.resources[index], ...changes };
        });
      },
      removeResource(id: string) {
        patch((d) => {
          d.resources = d.resources.filter((r) => r.id !== id);
          d.activities = d.activities.map((a) => ({
            ...a,
            resources: a.resources.filter((r) => r.resourceId !== id),
          }));
        });
      },
      addMilestone() {
        patch((d) => {
          d.milestones.push({
            id: newId("m"),
            name: "نقطه کنترل جدید",
            activityId: d.activities[d.activities.length - 1]?.id,
            phase: undefined,
          });
        });
      },
      updateMilestone(id: string, changes: Partial<ProjectInput["milestones"][number]>) {
        patch((d) => {
          const index = d.milestones.findIndex((m) => m.id === id);
          if (index >= 0) d.milestones[index] = { ...d.milestones[index], ...changes };
        });
      },
      removeMilestone(id: string) {
        patch((d) => {
          d.milestones = d.milestones.filter((m) => m.id !== id);
        });
      },
      addRisk() {
        patch((d) => {
          d.risks.push({
            id: newId("k"),
            title: "ریسک جدید",
            category: "عمومی",
            probability: 3,
            impact: 3,
            scheduleImpact: 5,
            costImpact: 0,
            mitigation: "",
          });
        });
      },
      updateRisk(id: string, changes: Partial<ProjectInput["risks"][number]>) {
        patch((d) => {
          const index = d.risks.findIndex((r) => r.id === id);
          if (index >= 0) d.risks[index] = { ...d.risks[index], ...changes };
        });
      },
      removeRisk(id: string) {
        patch((d) => {
          d.risks = d.risks.filter((r) => r.id !== id);
        });
      },
      loadTemplate(templateId: string, keepMeta: boolean) {
        commit((prev) => {
          const next = buildProjectFromTemplate(templateId, keepMeta ? prev.meta : {});
          return keepMeta ? { ...next, meta: prev.meta } : next;
        });
      },
      /** افزودن سریع یک فعالیت با حداقل ورودی (نام + مدت) */
      addQuick(name: string, duration: number, phase?: string) {
        const id = newId("a");
        patch((d) => {
          const codes = d.activities.map((a) => Number(toLatinDigits(a.code).replace(/\D/g, "")) || 0);
          const lastActivity = d.activities[d.activities.length - 1];
          d.activities.push({
            id,
            code: `A${Math.max(10, ...codes) + 10}`,
            name: name.trim().slice(0, 200) || "فعالیت جدید",
            phase: phase || lastActivity?.phase || "فاز ۱",
            duration: Math.max(0, Math.round(duration * 2) / 2) || 1,
            predecessors: lastActivity ? [{ predecessorId: lastActivity.id, type: "FS", lag: 0 }] : [],
            progress: 0,
            resources: [],
            fixedCost: 0,
            materialCost: 0,
            constraintType: "ASAP",
            milestone: false,
          });
        });
        return id;
      },
      /** درون‌ریزی گروهی فعالیت‌ها از متن/اکسل */
      importActivities(activities: ProjectInput["activities"], mode: "append" | "replace") {
        patch((d) => {
          const codes = d.activities.map((a) => Number(toLatinDigits(a.code).replace(/\D/g, "")) || 0);
          const nextCode = Math.max(10, ...codes, 0) + 10;
          const imported = activities.map((activity, index) => ({
            ...activity,
            code: activity.code || `A${nextCode + index * 10}`,
          }));
          d.activities = mode === "replace" ? imported : [...d.activities, ...imported];
        });
      },
      setBaseline(analysis: ProjectAnalysis) {
        commit((prev) => createBaseline(prev, analysis, "Baseline ثبت‌شده"));
      },
      clearBaseline() {
        patch((d) => {
          d.baseline = null;
        });
      },
      setPricing(changes: Partial<ProjectPricing>) {
        patch((d) => {
          d.pricing = { ...DEFAULT_PRICING, ...(d.pricing ?? {}), ...changes };
        });
      },
      /** اعمال نرخ لحظه‌ای بازار ایران روی همه منابع پروژه */
      applyMarketRates() {
        commit((prev) => applyMarketRates(prev, { ...DEFAULT_PRICING, ...(prev.pricing ?? {}) }));
      },
      /** اتصال یک منبع به ردیف مشخصی از فهرست نرخ بازار */
      linkResourceRate(resourceId: string, rateKey: string) {
        patch((d) => {
          const item = findRate(rateKey);
          const index = d.resources.findIndex((r) => r.id === resourceId);
          if (index < 0 || !item) return;
          const pricing = { ...DEFAULT_PRICING, ...(d.pricing ?? {}) };
          const effective = effectiveRate(
            { ...d.resources[index], rateKey: item.key, name: item.name },
            pricing,
          );
          d.resources[index] = {
            ...d.resources[index],
            rateKey: item.key,
            unit: item.unit,
            rate: effective.rate,
            rateSource: effective.source,
          };
        });
      },
    }),
    [patch, commit, undo, redo],
  );

  const deferred = useDeferredValue(project);
  const analysis = useMemo(() => analyzeProject(deferred), [deferred]);
  const isStale = deferred !== project;

  return {
    project,
    analysis,
    isStale,
    savedAt,
    dirty,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    ...api,
  };
}

export function marketCatalog() {
  return RATE_CATALOG.map((item) => ({
    key: item.key,
    name: item.name,
    category: item.category,
    unit: item.unit,
    market: item.market,
    official1405: item.official1405,
    official1404: item.official1404,
    volatility: item.volatility,
    resolved: resolveRate(item, "official-1405"),
  }));
}

export { guessRateKey, SERIES_LABELS };

export type ProjectApi = ReturnType<typeof useProject>;
