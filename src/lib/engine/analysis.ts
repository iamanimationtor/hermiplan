import {
  alignStart,
  countWorkingDays,
  dateFromOffset,
  diffCalendarDays,
  ensureViableCalendar,
  isIsoDate,
  isWorkday,
  offsetFromDate,
  workingDaysBetween,
} from "./calendar";
import { computeAllocations, computeSchedule, type Allocation, type ScheduleResult } from "./schedule";
import { formatJalali, toPersianDigits } from "@/lib/date-fa";
import { computePricing } from "@/lib/market/engine";
import { standardsFor } from "@/lib/standards";
import type {
  ActivityInput,
  ActivityResult,
  CostResult,
  DailyDemand,
  DelayResult,
  GanttModel,
  GanttRow,
  HealthSignal,
  KpiResult,
  MilestoneResult,
  PhaseResult,
  ProgressResult,
  ProjectAnalysis,
  ProjectInput,
  ResourceResult,
  RiskResult,
  Status,
  WbsNode,
} from "./types";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);
const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

function activityBudget(activity: ActivityInput, rateById: Map<string, number>): number {
  const resourceCost = activity.resources.reduce((sum, assignment) => {
    const rate = rateById.get(assignment.resourceId) ?? 0;
    return sum + rate * assignment.units * activity.duration;
  }, 0);
  return round(activity.fixedCost + activity.materialCost + resourceCost);
}

function riskLevel(score: number): RiskResult["level"] {
  if (score >= 20) return "critical";
  if (score >= 12) return "high";
  if (score >= 6) return "medium";
  return "low";
}

function statusFromScore(score: number): Status {
  if (score >= 75) return "good";
  if (score >= 50) return "watch";
  return "critical";
}

/**
 * The single deterministic entry point of the HERMIPLAN engine.
 * Takes a validated project input and returns a full engineering analysis.
 */
export function analyzeProject(input: ProjectInput): ProjectAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];

  // defensive normalisation: a malformed calendar must never hang the scheduler
  const calendar = ensureViableCalendar(input.calendar);
  if (calendar.workDays.join() !== input.calendar.workDays.join()) {
    warnings.push("تقویم کاری نامعتبر بود و به تقویم پیش‌فرض (شنبه تا چهارشنبه) اصلاح شد");
  }
  const anchor = alignStart(calendar, input.meta.startDate);
  const deadline = input.meta.deadline && isIsoDate(input.meta.deadline) ? input.meta.deadline : null;
  const deadlineOffset = deadline ? offsetFromDate(calendar, anchor, deadline) : null;
  const schedule: ScheduleResult = computeSchedule(input.activities, calendar, anchor, deadlineOffset);
  errors.push(...schedule.errors);
  warnings.push(...schedule.warnings);

  const deadlineVarianceDays =
    deadlineOffset !== null ? round(deadlineOffset - schedule.duration) : null;
  if (deadlineOffset !== null && deadlineVarianceDays !== null && deadlineVarianceDays < 0) {
    warnings.push(
      `با برنامه فعلی، پروژه ${toPersianDigits(Math.abs(deadlineVarianceDays))} روز کاری پس از تاریخ هدف پایان (${formatJalali(deadline as string)}) به پایان می‌رسد`,
    );
  }

  const rateById = new Map(input.resources.map((r) => [r.id, r.rate]));
  const resourceById = new Map(input.resources.map((r) => [r.id, r]));
  const statusOffset = offsetFromDate(calendar, schedule.anchor, input.meta.statusDate);
  // When the status date is a working day, that day's work counts as performed.
  const statusDayCredit = isWorkday(calendar, input.meta.statusDate) ? 1 : 0;

  const phaseOrder: string[] = [];
  for (const activity of input.activities) {
    if (!phaseOrder.includes(activity.phase)) phaseOrder.push(activity.phase);
  }

  /* ---------------------------- activities --------------------------- */
  const successorMap = new Map<string, string[]>();
  for (const activity of input.activities) {
    for (const dep of activity.predecessors) {
      const list = successorMap.get(dep.predecessorId) ?? [];
      if (!list.includes(activity.id)) list.push(activity.id);
      successorMap.set(dep.predecessorId, list);
    }
  }

  const activities: ActivityResult[] = [];
  const wbsCounter = new Map<string, number>();
  const phaseIndex = new Map(phaseOrder.map((p, i) => [p, i + 1]));

  const orderedActivities = [...input.activities].sort((a, b) => {
    const sa = schedule.activities.get(a.id);
    const sb = schedule.activities.get(b.id);
    if (!sa || !sb) return 0;
    if (sa.es !== sb.es) return sa.es - sb.es;
    return sa.ee - sb.ee;
  });

  for (const activity of orderedActivities) {
    const sched = schedule.activities.get(activity.id);
    if (!sched) continue;

    const phaseNo = phaseIndex.get(activity.phase) ?? 1;
    const next = (wbsCounter.get(activity.phase) ?? 0) + 1;
    wbsCounter.set(activity.phase, next);
    const wbs = `${phaseNo}.${next}`;

    const budget = activityBudget(activity, rateById);
    const duration = Math.max(activity.duration, 0);
    const progress = Math.min(100, Math.max(0, activity.progress));
    const earned = round((budget * progress) / 100);
    // elapsed working days INCLUDING the status day itself: a status date at the
    // end of the 5th working day of a 10-day activity means 50% planned, not 40%
    const plannedFrac =
      duration > 0
        ? statusOffset < sched.es
          ? 0
          : clamp01((statusOffset - sched.es + statusDayCredit) / duration)
        : statusOffset >= sched.es
          ? 1
          : 0;
    const plannedValue = round(budget * plannedFrac);
    const actualCost = activity.actualCost ?? earned;

    let slipDays = 0;
    if (progress < 100 && statusOffset > sched.ee) {
      slipDays = statusOffset - sched.ee;
    } else if (progress < plannedFrac * 100 - 5 && duration > 0) {
      slipDays = Math.max(1, Math.round((plannedFrac - progress / 100) * duration));
    }

    let activityStatus: ActivityResult["status"] = "not-started";
    if (progress >= 100) activityStatus = "completed";
    else if (slipDays > 0) activityStatus = "late";
    else if (progress > 0) activityStatus = "in-progress";

    activities.push({
      id: activity.id,
      code: activity.code,
      name: activity.name,
      phase: activity.phase,
      wbs,
      duration,
      es: sched.es,
      ee: sched.ee,
      ls: sched.ls,
      le: sched.le,
      // negative float is meaningful: it means the activity cannot meet its
      // constraint and the schedule is infeasible without change
      totalFloat: round(sched.totalFloat, 2),
      freeFloat: round(sched.freeFloat, 2),
      critical: sched.critical,
      startDate: dateFromOffset(calendar, schedule.anchor, sched.es),
      finishDate:
        duration === 0
          ? dateFromOffset(calendar, schedule.anchor, sched.es)
          : dateFromOffset(calendar, schedule.anchor, sched.ee - 1),
      lateStartDate: dateFromOffset(calendar, schedule.anchor, sched.ls),
      lateFinishDate: dateFromOffset(calendar, schedule.anchor, Math.max(sched.ls, sched.le - 1)),
      progress,
      plannedProgress: round(plannedFrac * 100, 1),
      budgetCost: budget,
      actualCost: round(actualCost),
      earnedValue: earned,
      plannedValue,
      resourceNames: activity.resources
        .map((r) => resourceById.get(r.resourceId)?.name ?? r.resourceId)
        .filter(Boolean),
      milestone: activity.milestone || duration === 0,
      status: activityStatus,
      slipDays,
      riskScore: (activity.riskProbability ?? 0) * (activity.riskImpact ?? 0),
      level: 2,
      successors: successorMap.get(activity.id) ?? [],
    });
  }

  const activityById = new Map(activities.map((a) => [a.id, a]));

  /* ------------------------------ phases ----------------------------- */
  const phases: PhaseResult[] = phaseOrder.map((phase, index) => {
    const items = activities.filter((a) => a.phase === phase);
    const start = items.length ? Math.min(...items.map((a) => a.es)) : 0;
    const end = items.length ? Math.max(...items.map((a) => a.ee)) : 0;
    const totalDuration = items.reduce((s, a) => s + a.duration, 0);
    const budget = items.reduce((s, a) => s + a.budgetCost, 0);
    const actual = items.reduce((s, a) => s + a.actualCost, 0);
    return {
      name: phase,
      wbs: `${index + 1}`,
      duration: totalDuration,
      startDate: dateFromOffset(calendar, schedule.anchor, start),
      finishDate: dateFromOffset(calendar, schedule.anchor, Math.max(start, end - 1)),
      progress: round(safeDiv(items.reduce((s, a) => s + (a.duration * a.progress) / 100, 0), totalDuration) * 100, 1),
      budget: round(budget),
      actual: round(actual),
      activityCount: items.length,
      critical: items.some((a) => a.critical),
    };
  });

  /* ------------------------------- WBS ------------------------------- */
  const wbs: WbsNode[] = phaseOrder.map((phase, index) => {
    const items = activities.filter((a) => a.phase === phase);
    const phaseResult = phases[index];
    return {
      id: `phase-${index}`,
      wbs: `${index + 1}`,
      name: phase,
      kind: "phase",
      level: 1,
      duration: phaseResult.duration,
      startDate: phaseResult.startDate,
      finishDate: phaseResult.finishDate,
      progress: phaseResult.progress,
      budget: phaseResult.budget,
      children: items.map((item) => ({
        id: item.id,
        wbs: item.wbs,
        name: item.name,
        kind: "activity" as const,
        level: 2,
        duration: item.duration,
        startDate: item.startDate,
        finishDate: item.finishDate,
        progress: item.progress,
        budget: item.budgetCost,
        children: [],
      })),
    };
  });

  /* --------------------------- critical path ------------------------- */
  const criticalActivities = activities.filter((a) => a.critical);
  const criticalPath = criticalActivities.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const totalDuration = activities.reduce((s, a) => s + a.duration, 0);
  const criticalDuration = criticalActivities.reduce((s, a) => s + a.duration, 0);
  const criticalPathRatio = round(safeDiv(criticalDuration, totalDuration) * 100, 1);

  /* ---------------------------- milestones --------------------------- */
  const milestones: MilestoneResult[] = [];
  for (const milestone of input.milestones) {
    let date = milestone.date && isIsoDate(milestone.date) ? milestone.date : undefined;
    let linkedCode: string | undefined;
    if (milestone.activityId && activityById.has(milestone.activityId)) {
      const linked = activityById.get(milestone.activityId) as ActivityResult;
      date = linked.finishDate;
      linkedCode = linked.code;
    }
    if (!date) {
      const last = activities[activities.length - 1];
      date = last?.finishDate ?? schedule.finish;
      linkedCode = last?.code;
    }
    milestones.push({
      id: milestone.id,
      name: milestone.name,
      phase: milestone.phase ?? "—",
      date,
      status:
        statusOffset >= (schedule.activities.get(milestone.activityId ?? "")?.ee ?? 0)
          ? "reached"
          : "upcoming",
      linkedActivityCode: linkedCode,
    });
  }
  for (const activity of activities.filter((a) => a.milestone)) {
    if (input.milestones.some((m) => m.activityId === activity.id)) continue;
    milestones.push({
      id: `act-${activity.id}`,
      name: activity.name,
      phase: activity.phase,
      date: activity.finishDate,
      status: activity.progress >= 100 ? "reached" : statusOffset >= activity.ee ? "late" : "upcoming",
      linkedActivityCode: activity.code,
    });
  }
  milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /* ----------------------------- resources --------------------------- */
  const allocations = computeAllocations(input, schedule);
  const resources: ResourceResult[] = input.resources.map((resource) => {
    const allocation: Allocation | undefined = allocations.get(resource.id);
    const demand: DailyDemand[] = [];
    if (allocation) {
      for (const [offset, units] of [...allocation.cells.entries()].sort((a, b) => a[0] - b[0])) {
        demand.push({
          offset,
          date: dateFromOffset(calendar, schedule.anchor, offset),
          units: round(units, 2),
        });
      }
    }
    const peak = allocation?.peak ?? 0;
    const capacity = Math.max(resource.capacity, 0);
    const usedDays = demand.length;
    const allocatedDays = demand.filter((d) => d.units > 0).length;
    const utilization =
      capacity > 0 && allocatedDays > 0
        ? round(
            (demand.reduce((s, d) => s + d.units, 0) / (capacity * Math.max(usedDays, 1))) * 100,
            1,
          )
        : 0;
    return {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      rate: resource.rate,
      capacity,
      totalUnits: round(allocation?.total ?? 0, 2),
      peakUnits: peak,
      peakDate: allocation ? dateFromOffset(calendar, schedule.anchor, allocation.peakOffset) : schedule.start,
      overallocated: capacity > 0 && peak > capacity,
      utilization,
      cost: round((allocation?.total ?? 0) * resource.rate),
      demand,
    };
  });
  const overallocatedResources = resources.filter((r) => r.overallocated).length;
  if (overallocatedResources > 0) {
    warnings.push(
      `${overallocatedResources} منبع بیش از ظرفیت تعریف‌شده تخصیص یافته‌اند (نیاز به Resource Leveling دارد)`,
    );
  }

  /* ------------------------------- costs ----------------------------- */
  const budget = round(activities.reduce((s, a) => s + a.budgetCost, 0));
  const earned = round(activities.reduce((s, a) => s + a.earnedValue, 0));
  const actual = round(activities.reduce((s, a) => s + a.actualCost, 0));
  const plannedToDate = round(activities.reduce((s, a) => s + a.plannedValue, 0));
  const cpi = round(safeDiv(earned, actual), 3);
  const eac = cpi > 0 ? round(safeDiv(budget, cpi)) : budget;
  const costs: CostResult = {
    currency: input.meta.currency,
    budget,
    plannedToDate,
    earned,
    actual,
    estimateAtCompletion: eac,
    varianceAtCompletion: round(budget - eac),
    byPhase: phases.map((p) => ({
      phase: p.name,
      budget: p.budget,
      actual: p.actual,
      progress: p.progress,
    })),
  };

  /* ------------------------------ progress --------------------------- */
  const overall = round(safeDiv(activities.reduce((s, a) => s + (a.duration * a.progress) / 100, 0), totalDuration) * 100, 1);
  const planned = round(
    safeDiv(
      activities.reduce(
        (sum, a) =>
          sum +
          a.duration *
            (statusOffset < a.es ? 0 : clamp01((statusOffset - a.es + statusDayCredit) / Math.max(a.duration, 1))),
        0,
      ),
      totalDuration,
    ) * 100,
    1,
  );
  const spi = round(safeDiv(earned, plannedToDate), 3);
  const progress: ProgressResult = {
    overall,
    planned,
    scheduleVariance: round(earned - plannedToDate),
    costVariance: round(earned - actual),
    schedulePerformanceIndex: spi,
    costPerformanceIndex: cpi,
    started: activities.filter((a) => a.progress > 0).length,
    completed: activities.filter((a) => a.progress >= 100).length,
    notStarted: activities.filter((a) => a.progress === 0).length,
    late: activities.filter((a) => a.status === "late").length,
    remainingDays: Math.max(0, schedule.duration - Math.round(statusOffset)),
    elapsedDays: Math.round(statusOffset),
  };

  /* ------------------------------- risks ----------------------------- */
  const risks: RiskResult[] = input.risks
    .map((risk) => {
      const score = risk.probability * risk.impact;
      return {
        id: risk.id,
        title: risk.title,
        category: risk.category,
        probability: risk.probability,
        impact: risk.impact,
        score,
        level: riskLevel(score),
        scheduleImpact: risk.scheduleImpact,
        costImpact: risk.costImpact,
        mitigation: risk.mitigation,
        owner: risk.owner,
      };
    })
    .sort((a, b) => b.score - a.score);
  const riskExposure = round(
    risks.reduce((s, r) => s + (r.costImpact * r.probability) / 5, 0),
  );

  /* ------------------------------ delays ----------------------------- */
  const delays: DelayResult[] = activities
    .filter((a) => a.slipDays > 0)
    .sort((a, b) => b.slipDays - a.slipDays)
    .map((a) => ({
      activityId: a.id,
      code: a.code,
      name: a.name,
      phase: a.phase,
      plannedFinish: a.finishDate,
      progress: a.progress,
      plannedProgress: a.plannedProgress,
      slipDays: a.slipDays,
      critical: a.critical,
    }));

  /* ----------------------------- baseline ---------------------------- */
  const baselineActivities = input.baseline?.activities ?? [];
  const baselineMap = new Map(baselineActivities.map((b) => [b.activityId, b]));
  const changedActivities =
    baselineActivities.length > 0
      ? baselineActivities
          .map((b) => {
            const current = activityById.get(b.activityId);
            if (!current) return null;
            return {
              code: current.code,
              name: current.name,
              baselineStart: b.startDate,
              currentStart: current.startDate,
              baselineFinish: b.finishDate,
              currentFinish: current.finishDate,
              varianceDays:
                diffCalendarDays(b.finishDate, current.finishDate) -
                diffCalendarDays(b.startDate, current.startDate),
              baselineCost: b.cost,
              currentCost: current.budgetCost,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .filter((x) => x.varianceDays !== 0 || x.baselineCost !== x.currentCost)
      : [];

  const baselineScheduleVariance = changedActivities.length
    ? Math.max(
        0,
        ...changedActivities.map((c) => Math.max(0, diffCalendarDays(c.baselineFinish, c.currentFinish))),
      )
    : 0;
  const baselineCostVariance = changedActivities.length
    ? round(changedActivities.reduce((s, c) => s + (c.currentCost - c.baselineCost), 0))
    : 0;

  /* ------------------------------- gantt ----------------------------- */
  const ganttRows: GanttRow[] = [];
  phases.forEach((phase, index) => {
    ganttRows.push({
      id: `phase-${index}`,
      code: phase.wbs,
      name: phase.name,
      wbs: phase.wbs,
      kind: "phase",
      level: 0,
      startOffset: Math.min(...activities.filter((a) => a.phase === phase.name).map((a) => a.es)),
      endOffset: Math.max(...activities.filter((a) => a.phase === phase.name).map((a) => a.ee)),
      progress: phase.progress,
      critical: phase.critical,
    });
    for (const activity of activities.filter((a) => a.phase === phase.name)) {
      ganttRows.push({
        id: activity.id,
        code: activity.code,
        name: activity.name,
        wbs: activity.wbs,
        kind: activity.milestone ? "milestone" : "activity",
        level: 1,
        startOffset: activity.es,
        endOffset: activity.ee,
        progress: activity.progress,
        critical: activity.critical,
      });
    }
  });

  const timelineDates = workingDaysBetween(calendar, schedule.start, schedule.finish);
  const gantt: GanttModel = {
    rows: ganttRows,
    totalOffsets: Math.max(schedule.duration, 1),
    dates: timelineDates.length ? timelineDates : [schedule.start],
    criticalPath: criticalActivities.map((a) => a.id),
  };

  /* -------------------------------- KPIs ----------------------------- */
  const kpis: KpiResult[] = [
    {
      key: "spi",
      label: "شاخص عملکرد زمان‌بندی (SPI)",
      value: spi ? spi.toFixed(2) : "—",
      hint: spi >= 1 ? "پیشرفت هم‌راستا یا جلوتر از برنامه" : "عقب‌ماندگی نسبت به برنامه",
      status: spi === 0 ? "watch" : spi >= 0.95 ? "good" : spi >= 0.85 ? "watch" : "critical",
    },
    {
      key: "cpi",
      label: "شاخص عملکرد هزینه (CPI)",
      value: cpi ? cpi.toFixed(2) : "—",
      hint: cpi >= 1 ? "هزینه در محدوده بودجه" : "بیش‌هزینه نسبت به بودجه",
      status: cpi === 0 ? "watch" : cpi >= 0.95 ? "good" : cpi >= 0.85 ? "watch" : "critical",
    },
    {
      key: "progress",
      label: "پیشرفت فیزیکی",
      value: `${overall.toFixed(1)}٪`,
      hint: `پیشرفت برنامه‌ریزی‌شده تا تاریخ وضعیت: ${planned.toFixed(1)}٪`,
      status: overall >= planned - 2 ? "good" : overall >= planned - 10 ? "watch" : "critical",
    },
    {
      key: "deadline",
      label: "تاریخ هدف پایان",
      value: deadline ? formatJalali(deadline, { withMonthName: false }) : "—",
      hint:
        deadline === null
          ? "تاریخ هدفی ثبت نشده است"
          : deadlineVarianceDays === null
            ? ""
            : deadlineVarianceDays >= 0
              ? `${toPersianDigits(deadlineVarianceDays)} روز کاری پیش از موعد`
              : `${toPersianDigits(Math.abs(deadlineVarianceDays))} روز کاری تأخیر نسبت به هدف`,
      status: deadline === null ? "good" : (deadlineVarianceDays ?? 0) >= 0 ? "good" : "critical",
    },
    {
      key: "duration",
      label: "مدت پروژه",
      value: `${schedule.duration} روز کاری`,
      hint: `${countWorkingDays(calendar, schedule.start, schedule.finish)} روز کاری مؤثر`,
      status: "good",
    },
    {
      key: "finish",
      label: "تاریخ پایان",
      value: schedule.finish,
      hint: `شروع: ${schedule.start}`,
      status: "good",
    },
    {
      key: "critical",
      label: "فعالیت‌های مسیر بحرانی",
      value: `${criticalActivities.length} از ${activities.length}`,
      hint: `${criticalPathRatio}٪ از کل ماندهزمان پروژه روی مسیر بحرانی است`,
      status: criticalPathRatio >= 80 ? "watch" : "good",
    },
    {
      key: "resources",
      label: "بهره‌وری منابع",
      value: resources.length
        ? `${round(resources.reduce((s, r) => s + r.utilization, 0) / resources.length, 0)}٪`
        : "—",
      hint: overallocatedResources
        ? `${overallocatedResources} منبع بیش از ظرفیت`
        : "تخصیص منابع در محدوده ظرفیت",
      status: overallocatedResources > 0 ? "critical" : "good",
    },
    {
      key: "risk",
      label: "ریسک‌های فعال",
      value: `${risks.filter((r) => r.level === "high" || r.level === "critical").length} ریسک بالا`,
      hint: `ارزش در معرض ریسک: ${riskExposure.toLocaleString("en-US")}`,
      status: risks.some((r) => r.level === "critical")
        ? "critical"
        : risks.some((r) => r.level === "high")
          ? "watch"
          : "good",
    },
  ];

  /* ------------------------------- health ---------------------------- */
  const signals: HealthSignal[] = [
    {
      label: "زمان‌بندی",
      status: kpis.find((k) => k.key === "spi")?.status ?? "watch",
      detail:
        spi >= 1
          ? "پروژه طبق برنامه یا جلوتر از برنامه پیش می‌رود."
          : `پیشرفت واقعی ${Math.abs(round(planned - overall, 1))} واحد از برنامه عقب‌تر است.`,
    },
    {
      label: "هزینه",
      status: kpis.find((k) => k.key === "cpi")?.status ?? "watch",
      detail:
        cpi >= 1
          ? "مصرف هزینه در محدوده بودجه تأییدشده است."
          : `انحراف هزینه: ${progress.costVariance.toLocaleString("en-US")} (منفی = بیش‌هزینه)`,
    },
    {
      label: "مسیر بحرانی",
      status: criticalPathRatio >= 80 ? "watch" : "good",
      detail: `${criticalActivities.length} فعالیت بحرانی با شناوری صفر روز کاری.`,
    },
    {
      label: "منابع",
      status: overallocatedResources > 0 ? "critical" : "good",
      detail:
        overallocatedResources > 0
          ? `${overallocatedResources} منبع نیازمند هموارسازی (Leveling) است.`
          : "ظرفیت منابع برای اجرای برنامه کافی است.",
    },
    {
      label: "ریسک",
      status:
        risks.some((r) => r.level === "critical")
          ? "critical"
          : risks.some((r) => r.level === "high")
            ? "watch"
            : "good",
      detail: `${risks.length} ریسک شناسایی‌شده؛ مهم‌ترین: ${risks[0]?.title ?? "—"}`,
    },
    {
      label: "تأخیر",
      status: delays.filter((d) => d.critical).length > 0 ? "critical" : delays.length > 0 ? "watch" : "good",
      detail:
        delays.length > 0
          ? `${delays.length} فعالیت با تأخیر؛ حداکثر ${Math.max(...delays.map((d) => d.slipDays))} روز کاری.`
          : "هیچ تأخیر فعلی در فعالیت‌ها ثبت نشده است.",
    },
  ];

  const signalScore = signals.reduce((sum, s) => sum + (s.status === "good" ? 100 : s.status === "watch" ? 60 : 20), 0);
  const healthScore = Math.round(signalScore / Math.max(signals.length, 1));

  /* ---------------------------- summary ------------------------------ */
  const statusLabel = statusFromScore(healthScore);
  const statusText =
    statusLabel === "good" ? "در وضعیت مطلوب" : statusLabel === "watch" ? "نیازمند پایش" : "در وضعیت بحرانی";
  const bullets: string[] = [
    `پروژه «${input.meta.name}» از ${schedule.start} آغاز می‌شود و پایان آن ${schedule.finish} برآورد شده است؛ مدت اجرا ${schedule.duration} روز کاری (${diffCalendarDays(schedule.start, schedule.finish) + 1} روز تقویمی) است.`,
    `پیشرفت فیزیکی فعلی ${overall.toFixed(1)}٪ در برابر ${planned.toFixed(1)}٪ برنامه، با ${activities.length} فعالیت در ${phases.length} فاز و ${milestones.length} نقطه کنترل (Milestone).`,
    `مسیر بحرانی شامل ${criticalActivities.length} فعالیت است و ${criticalPathRatio}٪ ماندهزمان پروژه را در بر می‌گیرد؛ هرگونه تأخیر در این فعالیت‌ها مستقیماً پایان پروژه را جابه‌جا می‌کند.`,
    `بودجه تجمیعی پروژه ${budget.toLocaleString("en-US")} ${currencyLabel(input.meta.currency)} و هزینه پیش‌بینی‌شده تا پایان (EAC) ${eac.toLocaleString("en-US")} است.`,
  ];
  if (overallocatedResources > 0) {
    bullets.push(`${overallocatedResources} منبع بیش از ظرفیت مجاز تخصیص یافته و نیازمند هموارسازی منابع است.`);
  }
  if (delays.length > 0) {
    bullets.push(`${delays.length} فعالیت دارای تأخیر است که مهم‌ترین آن «${delays[0].name}» با ${delays[0].slipDays} روز تأخیر است.`);
  }
  if (risks.length > 0 && risks[0]) {
    bullets.push(`بزرگ‌ترین ریسک پروژه «${risks[0].title}» با امتیاز ${risks[0].score} از ۲۵ است.`);
  }
  bullets.push(`وضعیت کلان پروژه بر اساس شاخص‌های زمان‌بندی، هزینه، منابع و ریسک: ${statusText}.`);

  const pricingBasis = { costs, gantt, activities };
  const pricing = computePricing(input, pricingBasis, input.pricing);
  const basis = standardsFor(input.meta.type);

  return {
    generatedAt: new Date().toISOString(),
    errors,
    warnings,
    schedule: {
      startDate: schedule.start,
      finishDate: schedule.finish,
      workingDays: schedule.duration,
      calendarDays: diffCalendarDays(schedule.start, schedule.finish) + 1,
      hoursPerDay: calendar.hoursPerDay,
      workDayCount: calendar.workDays.length,
      holidayCount: calendar.holidays.length,
      deadline: deadline ?? undefined,
      deadlineMet: deadline === null ? null : (deadlineVarianceDays ?? 0) >= 0,
      deadlineVarianceDays,
      phases,
    },
    activities,
    wbs,
    criticalPath,
    criticalPathRatio,
    milestones,
    resources,
    overallocatedResources,
    costs,
    progress,
    risks,
    riskExposure,
    delays,
    baseline: {
      available: baselineActivities.length > 0,
      name: input.baseline?.name,
      scheduleVarianceDays: baselineScheduleVariance,
      costVariance: baselineCostVariance,
      changedActivities,
    },
    gantt,
    kpis,
    pricing,
    standards: basis.standards,
    health: { score: healthScore, status: statusLabel, signals },
    summary: {
      headline: `${input.meta.name} — ${statusText} (امتیاز سلامت ${healthScore} از ۱۰۰)`,
      bullets,
    },
  };
}

function currencyLabel(currency: "IRR" | "USD" | "EUR"): string {
  return currency === "IRR" ? "ریال" : currency === "USD" ? "دلار" : "یورو";
}
