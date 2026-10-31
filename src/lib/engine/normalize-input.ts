import type { ActivityInput, Diagnostic } from "./types";

/**
 * Input normalisation — the single place where numeric policy is decided.
 *
 * ## Duration policy (documented decision)
 *
 * The scheduling model is **whole working days**: every offset (es/ee/ls/le),
 * every lag and the calendar axis are integers (`dateFromOffset(offset)` maps an
 * integer index onto a working day). Half-day offsets cannot be represented
 * without turning every date mapping into a rounding decision.
 *
 * Earlier releases accepted `duration: 2.5` in validation, then rounded it in
 * the scheduler (`Math.round`) while *costs* and resource allocation kept using
 * 2.5 — so the budget of a 2.5-day activity was computed for 2.5 days but the
 * calendar reserved 3. That silent inconsistency is removed here: durations and
 * lags are rounded **once**, at the boundary, and every downstream consumer
 * (schedule, allocation, budget, EVM, exports) sees the same integer.
 *
 * The rounding is reported as a warning so the user can correct the input
 * instead of discovering a 0.5-day drift in the budget.
 */
export interface NormalizeResult {
  activities: ActivityInput[];
  diagnostics: Diagnostic[];
}

const MAX_DURATION_DAYS = 3650;

export function normalizeActivityInputs(activities: ActivityInput[]): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const seenResourceAssignments = new Set<string>();

  const normalized = activities.map((activity) => {
    let duration = activity.duration;
    if (!Number.isFinite(duration)) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "invalid-duration",
        message: `مدت «${activity.name}» عدد معتبر نیست؛ صفر روز کاری در نظر گرفته شد`,
        activityIds: [activity.id],
      });
      duration = 0;
    }
    if (duration < 0) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "negative-duration",
        message: `مدت «${activity.name}» منفی بود و به صفر اصلاح شد`,
        activityIds: [activity.id],
      });
      duration = 0;
    }
    if (duration > MAX_DURATION_DAYS) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "duration-too-large",
        message: `مدت «${activity.name}» بیش از حد مجاز (${MAX_DURATION_DAYS} روز کاری) بود و محدود شد`,
        activityIds: [activity.id],
      });
      duration = MAX_DURATION_DAYS;
    }
    const roundedDuration = Math.round(duration);
    if (Math.abs(duration - roundedDuration) > 1e-9) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "fractional-duration",
        message:
          `مدت «${activity.name}» (${duration}) به ${roundedDuration} روز کاری صحیح گرد شد؛ ` +
          "مدل زمان‌بندی روزمحور است و نیم‌روز پشتیبانی نمی‌شود",
        activityIds: [activity.id],
      });
    }

    const progress = Number.isFinite(activity.progress)
      ? Math.min(100, Math.max(0, activity.progress))
      : 0;
    if (progress !== activity.progress) {
      diagnostics.push({
        kind: "data",
        severity: "warning",
        code: "progress-out-of-range",
        message: `درصد پیشرفت «${activity.name}» خارج از بازه ۰ تا ۱۰۰ بود و اصلاح شد`,
        activityIds: [activity.id],
      });
    }

    const predecessors = (activity.predecessors ?? []).map((dep) => ({
      ...dep,
      lag: Number.isFinite(dep.lag) ? Math.round(dep.lag) : 0,
    }));
    for (const dep of activity.predecessors ?? []) {
      if (Number.isFinite(dep.lag) && Math.abs(dep.lag - Math.round(dep.lag)) > 1e-9) {
        diagnostics.push({
          kind: "data",
          severity: "warning",
          code: "fractional-lag",
          message: `تأخیر رابطه «${activity.name}» (${dep.lag}) به ${Math.round(dep.lag)} روز کاری گرد شد`,
          activityIds: [activity.id],
        });
      }
    }

    // One resource row per (activity, resource): duplicated rows would double
    // count cost and capacity usage without any visible reason.
    const resources = [];
    for (const assignment of activity.resources ?? []) {
      const key = `${activity.id}:${assignment.resourceId}`;
      if (seenResourceAssignments.has(key)) {
        diagnostics.push({
          kind: "data",
          severity: "warning",
          code: "duplicate-resource-assignment",
          message: `تخصیص تکراری منبع در «${activity.name}» نادیده گرفته شد`,
          activityIds: [activity.id],
        });
        continue;
      }
      seenResourceAssignments.add(key);
      resources.push({ ...assignment, units: Number.isFinite(assignment.units) ? Math.max(0, assignment.units) : 0 });
    }

    const quantity = activity.quantity
      ? {
          ...activity.quantity,
          planned: Number.isFinite(activity.quantity.planned) ? Math.max(0, activity.quantity.planned) : 0,
          actual: Number.isFinite(activity.quantity.actual) ? Math.max(0, activity.quantity.actual) : 0,
          approved:
            activity.quantity.approved === undefined
              ? undefined
              : Number.isFinite(activity.quantity.approved)
                ? Math.max(0, activity.quantity.approved)
                : 0,
        }
      : undefined;

    return {
      ...activity,
      duration: roundedDuration,
      progress,
      predecessors,
      resources,
      quantity,
      fixedCost: Number.isFinite(activity.fixedCost) ? Math.max(0, activity.fixedCost) : 0,
      materialCost: Number.isFinite(activity.materialCost) ? Math.max(0, activity.materialCost) : 0,
    } satisfies ActivityInput;
  });

  return { activities: normalized, diagnostics };
}
