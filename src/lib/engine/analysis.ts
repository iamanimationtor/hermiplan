import {
  alignStart,
  countWorkingDays,
  dateFromOffset,
  diffCalendarDays,
  ensureViableCalendar,
  isIsoDate,
  offsetFromDate,
  resolveDatePosition,
  workingDaysBetween,
} from "./calendar";
import { computeAllocations, computeSchedule, type Allocation, type ScheduleResult } from "./schedule";
import { normalizeActivityInputs } from "./normalize-input";
import { formatJalali, toPersianDigits } from "@/lib/date-fa";
import { computePricing } from "@/lib/market/engine";
import { standardsFor } from "@/lib/standards";
import type {
  ActivityInput,
  ActivityQuantity,
  AnalysisStatus,
  BaselineVarianceRow,
  Diagnostic,
  EvmResult,
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

/**
 * Planned progress of one activity at the status date.
 *
 * Definition (documented, single source of truth):
 *   planned = clamp01((statusOffset − ES) / duration)
 *
 * `statusOffset` counts the working days from the project anchor to the status
 * date, so the status date is treated as the *beginning* of that working day:
 * work performed on the status date itself is not yet part of "planned". This
 * matches MS Project's status-date convention and keeps `planned = 0` on the
 * project start date instead of reporting a full day of planned work.
 *
 * Milestones (duration 0) are 100 % planned once their date has been reached.
 */
function plannedFraction(statusOffset: number, es: number, duration: number): number {
  if (duration <= 0) return statusOffset >= es ? 1 : 0;
  if (statusOffset <= es) return 0;
  return clamp01((statusOffset - es) / duration);
}

/**
 * Quantity-based progress for one activity: Actual / Planned, per the unit of
 * measure. Deliberately **not** clamped to 100 %: executing more than planned is
 * a real condition that must stay visible.
 */
function quantityProgress(quantity?: ActivityQuantity): {
  physical: number | null;
  detail: NonNullable<AnalysisActivity["quantity"]> | undefined;
} {
  if (!quantity || !quantity.unit) return { physical: null, detail: undefined };
  const planned = quantity.planned;
  const actual = quantity.actual;
  const approved = quantity.approved ?? 0;
  if (!(planned > 0)) {
    return {
      physical: null,
      detail: {
        unit: quantity.unit,
        planned,
        actual,
        approved,
        ratio: 0,
        overrun: false,
        status: "invalid",
        note: "مقدار برنامه‌ریزی‌شده صفر است؛ درصد پیشرفت قابل محاسبه نیست",
      },
    };
  }
  const ratio = actual / planned;
  return {
    physical: round(ratio * 100, 2),
    detail: {
      unit: quantity.unit,
      planned,
      actual,
      approved,
      ratio: round(ratio, 4),
      overrun: ratio > 1,
      status: ratio > 1 ? "over" : "normal",
      note: ratio > 1 ? "مقدار اجراشده از مقدار برنامه‌ریزی‌شده بیشتر است" : undefined,
    },
  };
}

/** Working-day distance between two ISO dates on the project calendar. */
function workingDayDiff(calendar: Parameters<typeof offsetFromDate>[0], from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to)) return 0;
  return offsetFromDate(calendar, from, to);
}

type AnalysisActivity = ActivityResult;

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
/**
 * Public entry point. Any unexpected failure inside the engine is converted into
 * an explicit `internal-error` analysis instead of a stack trace: the UI can then
 * say "the calculation failed" rather than showing zeros that look like real
 * results, and the API never leaks internals.
 */
export function analyzeProject(rawInput: ProjectInput): ProjectAnalysis {
  try {
    return analyzeProjectUnchecked(rawInput);
  } catch (error) {
    console.error("[engine] analysis failed:", error);
    return failedAnalysis(rawInput);
  }
}

function analyzeProjectUnchecked(rawInput: ProjectInput): ProjectAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Numeric policy (integer durations, clamped progress) is applied once, here.
  const normalized = normalizeActivityInputs(rawInput.activities ?? []);
  const diagnostics: Diagnostic[] = [...normalized.diagnostics];
  const input: ProjectInput = { ...rawInput, activities: normalized.activities };

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
  /**
   * Status-date position — one shared resolver (see `resolveDatePosition`).
   * The four boundary cases are classified and, where the user's date could be
   * misread, disclosed as a diagnostic instead of being silently snapped.
   */
  const statusPosition = resolveDatePosition(
    calendar,
    schedule.anchor,
    input.meta.statusDate,
    schedule.duration,
  );
  const statusOffset = statusPosition.offset;
  const statusEffective = statusPosition.effectiveDate;
  if (statusPosition.zone === "before-start") {
    diagnostics.push({
      kind: "calendar",
      severity: "warning",
      code: "status-date-before-start",
      message:
        `تاریخ وضعیت (${input.meta.statusDate}) پیش از شروع پروژه (${schedule.start}) است؛ ` +
        `پیشرفت برنامه‌ای صفر در نظر گرفته شد و باقی‌مانده مدت برابر کل برنامه است`,
    });
  } else if (statusPosition.zone === "after-finish") {
    diagnostics.push({
      kind: "calendar",
      severity: "warning",
      code: "status-date-after-finish",
      message:
        `تاریخ وضعیت (${input.meta.statusDate}) پس از پایان برنامه (${schedule.finish}) است؛ ` +
        `پیشرفت برنامه‌ای ۱۰۰٪ و «مانده مدت» صفر در نظر گرفته شد`,
    });
  }
  if (!statusPosition.isWorkday) {
    diagnostics.push({
      kind: "calendar",
      severity: "warning",
      code: "status-date-non-working",
      message:
        `تاریخ وضعیت (${input.meta.statusDate}) روز غیرکاری است؛ موقعیت زمانی آن با ابتدای روز کاری ` +
        `${statusEffective} محاسبه شد`,
    });
  }

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
    // see plannedFraction(): the status date is the beginning of that workday
    const plannedFrac = plannedFraction(statusOffset, sched.es, duration);
    const plannedValue = round(budget * plannedFrac);
    // When the user recorded no actual cost, earned value is used as a proxy and
    // the fact is surfaced (see the EVM block and `costs.actual`).
    const actualCost = activity.actualCost ?? earned;
    const quantity = quantityProgress(activity.quantity);

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
      constraint: {
        type: sched.constraint.type,
        date: sched.constraint.date,
        offset: sched.constraint.offset,
        applied: sched.constraint.applied,
        conflict: sched.constraint.conflict,
      },
      // the progress reported for this activity, aggregated duration-weighted
      timeProgress: progress,
      physicalProgress: quantity.physical,
      quantity: quantity.detail,
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
  /**
   * A milestone is "reached" when its own date is on/before the status date.
   * Nothing is inferred from internal offsets or default values:
   *  • standalone milestone → compare its date with the status date
   *  • milestone linked to an activity → compare that activity's forecast finish,
   *    and mark it "late" when the date passed while the work is unfinished
   *  • milestone with neither a date nor a link → "unscheduled" (never a
   *    fabricated date borrowed from the last activity)
   */
  const milestones: MilestoneResult[] = [];
  for (const milestone of input.milestones) {
    const linkedActivity =
      milestone.activityId && activityById.has(milestone.activityId)
        ? (activityById.get(milestone.activityId) as ActivityResult)
        : undefined;

    let date = milestone.date && isIsoDate(milestone.date) ? milestone.date : "";
    if (linkedActivity) date = linkedActivity.finishDate;

    if (!date) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "milestone-without-date",
        message: `نقطه کنترل «${milestone.name}» نه تاریخ دارد و نه به فعالیتی متصل است؛ زمان‌بندی نشده در نظر گرفته شد`,
        activityIds: milestone.activityId ? [milestone.activityId] : undefined,
      });
      milestones.push({
        id: milestone.id,
        name: milestone.name,
        phase: milestone.phase ?? "—",
        date: "",
        status: "unscheduled",
        linkedActivityCode: undefined,
      });
      continue;
    }

    let status: MilestoneResult["status"];
    if (linkedActivity) {
      if (linkedActivity.progress >= 100) status = "reached";
      else if (date <= input.meta.statusDate) status = "late";
      else status = "upcoming";
    } else {
      status = date <= input.meta.statusDate ? "reached" : "upcoming";
    }

    milestones.push({
      id: milestone.id,
      name: milestone.name,
      phase: milestone.phase ?? linkedActivity?.phase ?? "—",
      date,
      status,
      linkedActivityCode: linkedActivity?.code,
    });
  }

  for (const activity of activities.filter((a) => a.milestone)) {
    if (input.milestones.some((m) => m.activityId === activity.id)) continue;
    milestones.push({
      id: `act-${activity.id}`,
      name: activity.name,
      phase: activity.phase,
      date: activity.finishDate,
      status:
        activity.progress >= 100
          ? "reached"
          : activity.finishDate <= input.meta.statusDate
            ? "late"
            : "upcoming",
      linkedActivityCode: activity.code,
    });
  }
  milestones.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

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
    // This engine computes resource USAGE only. It does not level resources, so
    // the warning must not promise levelling.
    warnings.push(
      `${overallocatedResources} منبع بیش از ظرفیت تعریف‌شده تخصیص یافته‌اند (تسطیح خودکار منابع انجام نشده است؛ نیازمند تصمیم برنامه‌ریز)`,
    );
  }

  /* ------------------------------- costs ----------------------------- */
  /**
   * EVM definitions used throughout the application (also documented in
   * docs/ENGINE.md):
   *   PV  = Σ BAC_i × planned fraction at the status date
   *   EV  = Σ BAC_i × reported progress
   *   AC  = Σ recorded actual costs (+ EV as a proxy where none was recorded)
   *   SV  = EV − PV        CV  = EV − AC
   *   SPI = EV / PV        CPI = EV / AC
   *   EAC = BAC / CPI      ETC = EAC − AC      VAC = BAC − EAC
   * Every division is guarded: an undefined index is `null`, never 0, Infinity
   * or NaN.
   */
  const budget = round(activities.reduce((s2, a) => s2 + a.budgetCost, 0));
  const earned = round(activities.reduce((s2, a) => s2 + a.earnedValue, 0));
  const actual = round(activities.reduce((s2, a) => s2 + a.actualCost, 0));
  const plannedToDate = round(activities.reduce((s2, a) => s2 + a.plannedValue, 0));

  const withRecordedCost = input.activities.filter((a) => typeof a.actualCost === "number");
  const recordedBudget = withRecordedCost.reduce((s2, a) => s2 + activityBudget(a, rateById), 0);
  const costDataCoverage = budget > 0 ? round((recordedBudget / budget) * 100, 1) : 0;

  const ac = actual;
  const spi = plannedToDate > 0 ? round(earned / plannedToDate, 3) : null;
  const cpi = ac > 0 ? round(earned / ac, 3) : null;
  const eac = cpi !== null && cpi > 0 ? round(budget / cpi) : null;
  const etc = eac !== null ? round(eac - ac) : null;
  const evmNotes: string[] = [];
  if (costDataCoverage < 100) {
    evmNotes.push(
      costDataCoverage === 0
        ? "برای هیچ فعالیتی هزینه واقعی ثبت نشده است؛ AC برابر ارزش کسب‌شده در نظر گرفته شده و CPI=۱ نتیجه‌گیری معتبری نیست"
        : `برای ${round(100 - costDataCoverage, 1)}٪ از بودجه، هزینه واقعی ثبت نشده و ارزش کسب‌شده به‌عنوان هزینه فرض شده است؛ CPI تقریبی است`,
    );
  }
  if (plannedToDate === 0) {
    evmNotes.push("PV تا تاریخ وضعیت صفر است؛ SPI قابل محاسبه نیست");
  }

  const evm: EvmResult = {
    pv: plannedToDate,
    ev: earned,
    ac: ac > 0 ? ac : null,
    sv: round(earned - plannedToDate),
    cv: ac > 0 ? round(earned - ac) : null,
    spi,
    cpi,
    bac: budget,
    eac,
    etc,
    vac: eac !== null ? round(budget - eac) : null,
    eacMethod: "bac-cpi",
    costDataCoverage,
    notes: evmNotes,
  };

  const costs: CostResult = {
    currency: input.meta.currency,
    budget,
    plannedToDate,
    earned,
    actual,
    // CostResult keeps plain numbers for the report/export layer; when CPI is
    // undefined the documented fallback is EAC = BAC (no inferred overrun).
    estimateAtCompletion: eac ?? budget,
    varianceAtCompletion: round(budget - (eac ?? budget)),
    byPhase: phases.map((p) => ({
      phase: p.name,
      budget: p.budget,
      actual: p.actual,
      progress: p.progress,
    })),
  };

  /* ------------------------------ progress --------------------------- */
  /**
   * Time-based progress = duration-weighted progress of the schedule.
   * It is NOT physical progress: physical progress comes from measured
   * quantities (Actual / Planned) and is reported separately.
   */
  const overall = round(
    safeDiv(activities.reduce((s2, a) => s2 + (a.duration * a.timeProgress) / 100, 0), totalDuration) * 100,
    1,
  );
  const planned = round(
    safeDiv(
      activities.reduce((s2, a) => s2 + a.duration * plannedFraction(statusOffset, a.es, a.duration), 0),
      totalDuration,
    ) * 100,
    1,
  );

  const measured = activities.filter((a) => a.physicalProgress !== null && a.quantity?.status !== "invalid");
  const measuredBudget = measured.reduce((s2, a) => s2 + a.budgetCost, 0);
  const physical =
    measuredBudget > 0
      ? round(
          measured.reduce((s2, a) => s2 + (a.physicalProgress as number) * a.budgetCost, 0) / measuredBudget,
          1,
        )
      : null;
  const physicalCoverage = budget > 0 ? round((measuredBudget / budget) * 100, 1) : 0;

  /**
   * Elapsed working days, clamped to [0, schedule.duration]. `statusOffset` may
   * be negative (status date before the project) or larger than the plan
   * (after it); the clamp keeps `elapsedDays`/`remainingDays` meaningful while
   * the diagnostics above state what happened.
   */
  const elapsedDays = Math.min(Math.max(Math.round(statusOffset), 0), schedule.duration);

  const progress: ProgressResult = {
    overall,
    timeBased: overall,
    physical,
    physicalCoverage,
    planned,
    scheduleVariance: round(earned - plannedToDate),
    costVariance: round(earned - actual),
    schedulePerformanceIndex: spi ?? 0,
    costPerformanceIndex: cpi ?? 0,
    started: activities.filter((a) => a.progress > 0).length,
    completed: activities.filter((a) => a.progress >= 100).length,
    notStarted: activities.filter((a) => a.progress === 0).length,
    late: activities.filter((a) => a.status === "late").length,
    // Clamped to the real project window: a status date outside it must not
    // produce negative "elapsed" or an elapsed time beyond the plan.
    remainingDays: Math.max(0, schedule.duration - elapsedDays),
    elapsedDays,
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
  /**
   * Baseline variance is reported per dimension. The previous implementation
   * subtracted the start deviation from the finish deviation, so moving an
   * activity by two days without changing its duration produced a variance of
   * ZERO — a two-day delay reported as on-plan. Each deviation is now computed
   * independently, in working days of the current project calendar.
   */
  const baselineActivities = input.baseline?.activities ?? [];
  const changedActivities: BaselineVarianceRow[] = [];
  if (baselineActivities.length > 0) {
    for (const b of baselineActivities) {
      const current = activityById.get(b.activityId);
      if (!current) continue;
      const startVarianceDays = workingDayDiff(calendar, b.startDate, current.startDate);
      const finishVarianceDays = workingDayDiff(calendar, b.finishDate, current.finishDate);
      // Forecast finish for unfinished work equals the scheduled finish.
      const completionVarianceDays = finishVarianceDays;
      const status: BaselineVarianceRow["status"] =
        !isIsoDate(b.startDate) || !isIsoDate(b.finishDate)
          ? "unknown"
          : finishVarianceDays > 0 || startVarianceDays > 0
            ? "later"
            : finishVarianceDays < 0 || startVarianceDays < 0
              ? "earlier"
              : "on-plan";
      changedActivities.push({
        activityId: current.id,
        code: current.code,
        name: current.name,
        baselineStart: b.startDate,
        currentStart: current.startDate,
        baselineFinish: b.finishDate,
        currentFinish: current.finishDate,
        startVarianceDays,
        finishVarianceDays,
        durationChange: round(current.duration - b.duration, 2),
        completionVarianceDays,
        status,
        varianceDays: finishVarianceDays,
        baselineCost: b.cost,
        currentCost: current.budgetCost,
      });
    }
    changedActivities.sort((a, b) => b.finishVarianceDays - a.finishVarianceDays);
  }

  const trackedActivities = changedActivities.filter(
    (c) => c.finishVarianceDays !== 0 || c.startVarianceDays !== 0 || c.baselineCost !== c.currentCost,
  );
  const baselineScheduleVariance = changedActivities.length
    ? Math.max(0, ...changedActivities.map((c) => c.finishVarianceDays))
    : 0;
  const baselineCostVariance = changedActivities.length
    ? round(changedActivities.reduce((s2, c) => s2 + (c.currentCost - c.baselineCost), 0))
    : 0;
  const maxFinishSlipDays = changedActivities.length
    ? Math.max(0, ...changedActivities.map((c) => c.finishVarianceDays))
    : 0;
  const maxStartSlipDays = changedActivities.length
    ? Math.max(0, ...changedActivities.map((c) => c.startVarianceDays))
    : 0;

  /* ------------------------------- gantt ----------------------------- */
  const ganttRows: GanttRow[] = [];
  phases.forEach((phase, index) => {
    // A phase may contain only unschedulable activities (dependency cycle); the
    // row must then fall back to zero instead of Math.min() of an empty array,
    // which would leak Infinity into the Gantt model and the JSON export.
    const phaseActivities = activities.filter((a) => a.phase === phase.name);
    const startOffset = phaseActivities.length ? Math.min(...phaseActivities.map((a) => a.es)) : 0;
    const endOffset = phaseActivities.length ? Math.max(...phaseActivities.map((a) => a.ee)) : 0;
    ganttRows.push({
      id: `phase-${index}`,
      code: phase.wbs,
      name: phase.name,
      wbs: phase.wbs,
      kind: "phase",
      level: 0,
      startOffset,
      endOffset,
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
      value: spi !== null ? spi.toFixed(2) : "—",
      hint:
        spi === null
          ? "PV تا تاریخ وضعیت صفر است؛ شاخص قابل محاسبه نیست"
          : spi >= 1
            ? "پیشرفت هم‌راستا یا جلوتر از برنامه"
            : "عقب‌ماندگی نسبت به برنامه",
      status: spi === null ? "watch" : spi >= 0.95 ? "good" : spi >= 0.85 ? "watch" : "critical",
    },
    {
      key: "cpi",
      label: "شاخص عملکرد هزینه (CPI)",
      value: cpi !== null ? cpi.toFixed(2) : "—",
      hint:
        costDataCoverage === 0
          ? "هزینه واقعی ثبت نشده است؛ CPI معتبر نیست"
          : cpi !== null && cpi >= 1
            ? "هزینه در محدوده بودجه"
            : "بیش‌هزینه نسبت به بودجه",
      status:
        costDataCoverage === 0 ? "watch" : cpi === null ? "watch" : cpi >= 0.95 ? "good" : cpi >= 0.85 ? "watch" : "critical",
    },
    {
      key: "progress",
      label: "پیشرفت زمان‌محور (مدت‌وزنی)",
      value: `${overall.toFixed(1)}٪`,
      hint: `پیشرفت برنامه‌ریزی‌شده تا تاریخ وضعیت: ${planned.toFixed(1)}٪`,
      status: overall >= planned - 2 ? "good" : overall >= planned - 10 ? "watch" : "critical",
    },
    {
      key: "physical",
      label: "پیشرفت فیزیکی (مقدار اجرا)",
      value: physical !== null ? `${physical.toFixed(1)}٪` : "—",
      hint:
        physical !== null
          ? `مبنای محاسبه: مقدار اجراشده / مقدار برنامه‌ریزی‌شده — پوشش ${toPersianDigits(physicalCoverage)}٪ بودجه`
          : "مقدار اجرایی برای فعالیت‌ها ثبت نشده است؛ پیشرفت مقداری قابل محاسبه نیست",
      status: physical === null ? "watch" : physical >= 100 ? "good" : "watch",
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
        spi === null
          ? "شاخص SPI قابل محاسبه نیست (PV صفر است)."
          : spi >= 1
            ? "پروژه طبق برنامه یا جلوتر از برنامه پیش می‌رود."
            : `پیشرفت زمان‌محور ${Math.abs(round(planned - overall, 1))} واحد از برنامه عقب‌تر است.`,
    },
    {
      label: "هزینه",
      status: kpis.find((k) => k.key === "cpi")?.status ?? "watch",
      detail:
        cpi === null || costDataCoverage === 0
          ? "هزینه واقعی برای محاسبه CPI ثبت نشده است."
          : cpi >= 1
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
          ? `${overallocatedResources} منبع بیش از ظرفیت است؛ موتور فقط مصرف را محاسبه می‌کند و تسطیح خودکار انجام نمی‌دهد.`
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
    `پیشرفت زمان‌محور (مدت‌وزنی) ${overall.toFixed(1)}٪ در برابر ${planned.toFixed(1)}٪ برنامه، با ${activities.length} فعالیت در ${phases.length} فاز و ${milestones.length} نقطه کنترل (Milestone).`,
    `مسیر بحرانی شامل ${criticalActivities.length} فعالیت است و ${criticalPathRatio}٪ ماندهزمان پروژه را در بر می‌گیرد؛ هرگونه تأخیر در این فعالیت‌ها مستقیماً پایان پروژه را جابه‌جا می‌کند.`,
    `بودجه تجمیعی پروژه ${budget.toLocaleString("en-US")} ${currencyLabel(input.meta.currency)} و هزینه پیش‌بینی‌شده تا پایان (EAC) ${
      eac === null
        ? "قابل محاسبه نیست (هزینه واقعی ثبت نشده است)"
        : eac.toLocaleString("en-US")
    } است.`,
  ];
  if (overallocatedResources > 0) {
    bullets.push(
      `${overallocatedResources} منبع بیش از ظرفیت مجاز تخصیص یافته است؛ موتور فعلی تسطیح خودکار منابع ندارد و رفع آن نیازمند تصمیم برنامه‌ریز است.`,
    );
  }
  if (physical !== null) {
    bullets.push(
      `پیشرفت فیزیکی مبتنی بر مقدار اجرا ${physical.toFixed(1)}٪ است (پوشش ${physicalCoverage}٪ از بودجه پروژه).`,
    );
  }
  if (delays.length > 0) {
    bullets.push(`${delays.length} فعالیت دارای تأخیر است که مهم‌ترین آن «${delays[0].name}» با ${delays[0].slipDays} روز تأخیر است.`);
  }
  if (risks.length > 0 && risks[0]) {
    bullets.push(`بزرگ‌ترین ریسک پروژه «${risks[0].title}» با امتیاز ${risks[0].score} از ۲۵ است.`);
  }
  bullets.push(`وضعیت کلان پروژه بر اساس شاخص‌های زمان‌بندی، هزینه، منابع و ریسک: ${statusText}.`);

  /* --------------------------- diagnostics --------------------------- */
  diagnostics.push(...schedule.diagnostics);
  const uniqueDiagnostics = dedupeDiagnostics(diagnostics);

  const hasDataError = uniqueDiagnostics.some(
    (d) => d.severity === "error" && (d.kind === "data" || d.kind === "cycle" || d.kind === "calendar"),
  );
  const hasConstraintConflict = uniqueDiagnostics.some(
    (d) => d.severity === "error" && (d.kind === "constraint" || d.kind === "dependency"),
  );
  const hasNegativeFloat = activities.some((a) => a.totalFloat < -0.001);
  const analysisStatus: AnalysisStatus = hasDataError
    ? "invalid"
    : hasConstraintConflict || hasNegativeFloat
      ? "inconsistent"
      : uniqueDiagnostics.length > 0
        ? "warning"
        : "valid";

  const pricingBasis = { costs, gantt, activities };
  const pricing = computePricing(input, pricingBasis, input.pricing);
  const basis = standardsFor(input.meta.type);

  return {
    generatedAt: new Date().toISOString(),
    errors,
    warnings,
    diagnostics: uniqueDiagnostics,
    status: analysisStatus,
    unschedulable: schedule.unschedulable,
    schedule: {
      status: analysisStatus,
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
      naturalWorkingDays: schedule.duration,
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
    evm,
    progress,
    risks,
    riskExposure,
    delays,
    baseline: {
      available: baselineActivities.length > 0,
      name: input.baseline?.name,
      scheduleVarianceDays: baselineScheduleVariance,
      costVariance: baselineCostVariance,
      changedActivities: trackedActivities,
      maxFinishSlipDays,
      maxStartSlipDays,
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

/** Collapses identical diagnostics (the same warning can be produced twice). */
function dedupeDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const item of items) {
    const key = `${item.kind}|${item.severity}|${item.code}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function currencyLabel(currency: "IRR" | "USD" | "EUR"): string {
  return currency === "IRR" ? "ریال" : currency === "USD" ? "دلار" : "یورو";
}

/**
 * Minimal, honest analysis used when the engine throws. Every number is zero,
 * the status is `internal-error`, and the reason is surfaced as a diagnostic so
 * no consumer can mistake this for a valid schedule.
 */
function failedAnalysis(input: ProjectInput): ProjectAnalysis {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = isIsoDate(input?.meta?.startDate ?? "") ? (input.meta.startDate as string) : today;
  const emptyCosts: CostResult = {
    currency: input?.meta?.currency ?? "IRR",
    budget: 0,
    plannedToDate: 0,
    earned: 0,
    actual: 0,
    estimateAtCompletion: 0,
    varianceAtCompletion: 0,
    byPhase: [],
  };
  const emptyEvm: EvmResult = {
    pv: 0,
    ev: 0,
    ac: null,
    sv: 0,
    cv: null,
    spi: null,
    cpi: null,
    bac: 0,
    eac: null,
    etc: null,
    vac: null,
    eacMethod: "bac-cpi",
    costDataCoverage: 0,
    notes: ["محاسبه انجام نشده است"],
  };
  const diagnostic: Diagnostic = {
    kind: "data",
    severity: "error",
    code: "internal-error",
    message: "محاسبه تحلیل با خطای داخلی متوقف شد؛ اعداد این گزارش قابل استناد نیستند",
  };

  return {
    generatedAt: new Date().toISOString(),
    errors: [diagnostic.message],
    warnings: [],
    diagnostics: [diagnostic],
    status: "internal-error",
    unschedulable: (input?.activities ?? []).map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      reason: "خطای داخلی محاسبات",
    })),
    schedule: {
      status: "invalid",
      startDate,
      finishDate: startDate,
      workingDays: 0,
      calendarDays: 0,
      hoursPerDay: input?.calendar?.hoursPerDay ?? 8,
      workDayCount: input?.calendar?.workDays?.length ?? 0,
      holidayCount: input?.calendar?.holidays?.length ?? 0,
      deadline: input?.meta?.deadline,
      deadlineMet: null,
      deadlineVarianceDays: null,
      naturalWorkingDays: 0,
      phases: [],
    },
    activities: [],
    wbs: [],
    criticalPath: [],
    criticalPathRatio: 0,
    milestones: [],
    resources: [],
    overallocatedResources: 0,
    costs: emptyCosts,
    evm: emptyEvm,
    progress: {
      overall: 0,
      timeBased: 0,
      physical: null,
      physicalCoverage: 0,
      planned: 0,
      scheduleVariance: 0,
      costVariance: 0,
      schedulePerformanceIndex: 0,
      costPerformanceIndex: 0,
      started: 0,
      completed: 0,
      notStarted: 0,
      late: 0,
      remainingDays: 0,
      elapsedDays: 0,
    },
    risks: [],
    riskExposure: 0,
    delays: [],
    baseline: {
      available: false,
      scheduleVarianceDays: 0,
      costVariance: 0,
      changedActivities: [],
      maxFinishSlipDays: 0,
      maxStartSlipDays: 0,
    },
    gantt: { rows: [], totalOffsets: 1, dates: [startDate], criticalPath: [] },
    kpis: [],
    pricing: {
      series: "official-1405",
      seriesLabel: "—",
      region: "tehran",
      regionLabel: "—",
      indexFactor: 100,
      asOf: startDate,
      asOfJalali: "—",
      sources: [],
      escalationEnabled: false,
      escalationRatePerMonth: 0,
      escalation: { months: [], total: 0, baseValue: 0, scenario: true, note: "محاسبه انجام نشده است" },
      breakdown: { direct: 0, overhead: 0, profit: 0, contingency: 0, escalation: 0, total: 0 },
      rates: [],
    },
    standards: [],
    health: { score: 0, status: "critical", signals: [] },
    summary: {
      headline: `${input?.meta?.name ?? "پروژه"} — خطای داخلی محاسبات`,
      bullets: [diagnostic.message],
    },
  };
}
