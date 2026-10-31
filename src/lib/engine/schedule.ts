import {
  addCalendarDays,
  alignStart,
  dateFromOffset,
  isIsoDate,
  isWorkday,
  offsetFromDate,
  nextWorkday,
  previousWorkday,
} from "./calendar";
import type {
  ActivityConstraintResult as ConstraintState,
  ActivityInput,
  Diagnostic,
  ProjectInput,
  WorkCalendar,
} from "./types";
import type { UnschedulableActivity } from "./types";

/* ------------------------------------------------------------------ */
/* Re-exported domain types (defined in ./types to avoid cycles)        */
/* ------------------------------------------------------------------ */

export type {
  AnalysisStatus as ScheduleStatus,
  Diagnostic,
  DiagnosticKind,
  DiagnosticSeverity,
  UnschedulableActivity,
  ActivityConstraintResult as ConstraintState,
} from "./types";

/* ------------------------------------------------------------------ */
/* Schedule data structures                                            */
/* ------------------------------------------------------------------ */

export interface ScheduledActivity {
  input: ActivityInput;
  es: number;
  ee: number;
  ls: number;
  le: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  constraint: ConstraintState;
}

export interface ScheduleResult {
  anchor: string;
  start: string;
  finish: string;
  duration: number;
  activities: Map<string, ScheduledActivity>;
  order: string[];
  errors: string[];
  warnings: string[];
  diagnostics: Diagnostic[];
  status: "valid" | "warning" | "inconsistent" | "invalid";
  unschedulable: UnschedulableActivity[];
}

interface Edge {
  id: string;
  type: string;
  lag: number;
}

interface Node {
  id: string;
  duration: number;
  /** edges where this node is the SUCCESSOR */
  predecessors: Edge[];
  /** edges where this node is the PREDECESSOR */
  successors: Edge[];
}

/* ------------------------------------------------------------------ */
/* Constraint date mapping                                             */
/* ------------------------------------------------------------------ */

/**
 * Maps a constraint date to a working-day offset.
 *
 * Constraint dates may fall on a non-working day (holiday / weekend). A start
 * constraint moves forward to the next working day, a finish constraint moves
 * backward to the previous working day, so the constraint never silently
 * disappears. The caller reports the adjustment as a warning.
 */
export function constraintOffset(
  cal: WorkCalendar,
  anchor: string,
  date: string,
  mode: "start" | "finish",
): { offset: number; alignedDate: string; adjusted: boolean } {
  const isWork = isWorkday(cal, date);
  const aligned = isWork ? date : mode === "start" ? nextWorkday(cal, date) : previousWorkday(cal, date);
  return {
    offset: offsetFromDate(cal, anchor, aligned),
    alignedDate: aligned,
    adjusted: !isWork,
  };
}

/** Converts a "no later than" finish date into an exclusive end offset. */
function finishCapOffset(offset: number): number {
  // Offsets are exclusive-end based: an activity that finishes on working day
  // `k` has ee = k + 1.
  return offset + 1;
}

/* ------------------------------------------------------------------ */
/* Relation arithmetic                                                 */
/* ------------------------------------------------------------------ */

function earliestStartFor(relation: { type: string; lag: number }, pred: ScheduledActivity, succDuration: number): number {
  switch (relation.type) {
    case "SS":
      return pred.es + relation.lag;
    case "FF":
      return pred.ee + relation.lag - succDuration;
    case "SF":
      return pred.es + relation.lag - succDuration;
    case "FS":
    default:
      return pred.ee + relation.lag;
  }
}

/**
 * Latest allowable finish of a PREDECESSOR implied by one of its successors.
 *
 * Derivation (P = predecessor, S = successor):
 *   FS: S.ES ≥ P.EF + lag  ⇒  P.LF ≤ S.LS − lag
 *   SS: S.ES ≥ P.ES + lag  ⇒  P.LS ≤ S.LS − lag ⇒ P.LF ≤ S.LS − lag + P.duration
 *   FF: S.EF ≥ P.EF + lag  ⇒  P.LF ≤ S.LE − lag
 *   SF: S.EF ≥ P.ES + lag  ⇒  P.LS ≤ S.LE − lag ⇒ P.LF ≤ S.LE − lag + P.duration
 *
 * Note that the SS/SF conversions add the PREDECESSOR's own duration, not the
 * successor's — using the successor duration silently corrupts total float.
 */
function latestFinishFor(relation: { type: string; lag: number }, succ: ScheduledActivity, predecessorDuration: number): number {
  switch (relation.type) {
    case "SS":
      return succ.ls - relation.lag + predecessorDuration;
    case "SF":
      return succ.le - relation.lag + predecessorDuration;
    case "FF":
      return succ.le - relation.lag;
    case "FS":
    default:
      return succ.ls - relation.lag;
  }
}

/* ------------------------------------------------------------------ */
/* Cycle detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Finds one concrete cycle among `candidates` and returns the path
 * (A → B → C → A) so the user can see which links to break.
 */
export function findCycle(nodes: Map<string, Node>, candidates: string[]): string[] {
  const candidateSet = new Set(candidates);
  const state = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 on stack, 2 done
  const stack: string[] = [];
  let found: string[] = [];

  const visit = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const edge of nodes.get(id)?.successors ?? []) {
      if (!candidateSet.has(edge.id)) continue;
      const next = state.get(edge.id) ?? 0;
      if (next === 1) {
        const start = stack.indexOf(edge.id);
        found = [...stack.slice(start), edge.id];
        return true;
      }
      if (next === 0 && visit(edge.id)) return true;
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };

  for (const id of candidates) {
    if ((state.get(id) ?? 0) === 0 && visit(id)) break;
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

/**
 * Critical Path Method (precedence diagramming method).
 *
 * Offsets are exclusive-end based: ee = es + duration. A milestone has
 * duration 0, therefore es === ee.
 *
 * Supported constraints (see docs/ENGINE.md → "جدول محدودیت‌ها"):
 *   ASAP  no effect
 *   SNET  earliest start ≥ date
 *   MSO   start = date exactly; LS is pinned, so float is 0 and predecessors
 *         must finish before the forced start
 *   FNLT  latest finish ≤ date; enforced in the backward pass, and a violated
 *         constraint produces negative total float plus an explicit diagnostic
 */
export function computeSchedule(
  activities: ActivityInput[],
  cal: WorkCalendar,
  anchor: string,
  deadlineOffset?: number | null,
): ScheduleResult {
  const diagnostics: Diagnostic[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const unschedulable: UnschedulableActivity[] = [];

  const report = (diagnostic: Diagnostic) => {
    diagnostics.push(diagnostic);
    if (diagnostic.severity === "error") errors.push(diagnostic.message);
    else warnings.push(diagnostic.message);
  };

  const nodes = new Map<string, Node>();
  const byId = new Map<string, ActivityInput>();

  for (const activity of activities) {
    if (nodes.has(activity.id)) {
      report({
        kind: "data",
        severity: "error",
        code: "duplicate-activity-id",
        message: `شناسه فعالیت تکراری است: ${activity.code || activity.id}`,
        activityIds: [activity.id],
      });
      continue;
    }
    nodes.set(activity.id, {
      id: activity.id,
      duration: Math.max(0, Math.round(activity.duration)),
      successors: [],
      predecessors: [],
    });
    byId.set(activity.id, activity);
  }

  const idByCode = new Map<string, string>();
  for (const activity of activities) {
    if (activity.code) idByCode.set(activity.code, activity.id);
  }

  const resolve = (ref: string): string | null => {
    if (nodes.has(ref)) return ref;
    const byCode = idByCode.get(ref);
    if (byCode) return byCode;
    return null;
  };

  const seenEdges = new Set<string>();
  for (const activity of activities) {
    const node = nodes.get(activity.id);
    if (!node) continue;
    for (const dep of activity.predecessors ?? []) {
      const predId = resolve(dep.predecessorId);
      if (!predId) {
        // A dangling predecessor is a data error: silently ignoring it would
        // produce a schedule that looks valid but ignores a real link.
        report({
          kind: "data",
          severity: "error",
          code: "unknown-predecessor",
          message: `پیش‌نیاز نامعتبر برای «${activity.name}»: شناسه ${dep.predecessorId} وجود ندارد`,
          activityIds: [activity.id],
        });
        continue;
      }
      if (predId === activity.id) {
        report({
          kind: "data",
          severity: "error",
          code: "self-dependency",
          message: `فعالیت «${activity.name}» به خودش وابسته است`,
          activityIds: [activity.id],
        });
        continue;
      }
      const key = `${predId}->${activity.id}:${dep.type}:${dep.lag}`;
      if (seenEdges.has(key)) {
        report({
          kind: "data",
          severity: "warning",
          code: "duplicate-dependency",
          message: `رابطه تکراری «${dep.type}» بین «${byId.get(predId)?.name ?? predId}» و «${activity.name}» نادیده گرفته شد`,
          activityIds: [predId, activity.id],
        });
        continue;
      }
      seenEdges.add(key);
      node.predecessors.push({ id: predId, type: dep.type, lag: dep.lag });
      nodes.get(predId)?.successors.push({ id: activity.id, type: dep.type, lag: dep.lag });
    }
  }

  // ---------------- topological ordering (Kahn) ----------------
  const indegree = new Map<string, number>();
  for (const [id, node] of nodes) indegree.set(id, node.predecessors.length);
  const queue: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) queue.push(id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift() as string;
    order.push(id);
    for (const succ of nodes.get(id)?.successors ?? []) {
      const next = (indegree.get(succ.id) ?? 0) - 1;
      indegree.set(succ.id, next);
      if (next === 0) queue.push(succ.id);
    }
  }

  const cyclic = [...nodes.keys()].filter((id) => !order.includes(id));
  if (cyclic.length) {
    const path = findCycle(nodes, cyclic);
    const label = (id: string) => byId.get(id)?.name ?? id;
    const readable = path.length ? path.map(label).join(" → ") : cyclic.slice(0, 5).map(label).join("، ");
    report({
      kind: "cycle",
      severity: "error",
      code: "circular-dependency",
      message: `حلقه وابستگی شناسایی شد: ${readable}`,
      activityIds: path.length ? path : cyclic,
    });
    for (const id of cyclic) {
      unschedulable.push({
        id,
        code: byId.get(id)?.code ?? id,
        name: byId.get(id)?.name ?? id,
        reason: "عضو یک حلقه وابستگی است و زمان‌بندی معتبری ندارد",
      });
    }
  }

  const anchorWorkday = alignStart(cal, anchor);
  const result = new Map<string, ScheduledActivity>();

  /* ---------------- forward pass ---------------- */
  for (const id of order) {
    const node = nodes.get(id);
    const input = byId.get(id);
    if (!node || !input) continue;

    let es = 0;
    for (const pred of node.predecessors) {
      const predSched = result.get(pred.id);
      if (!predSched) continue;
      const candidate = earliestStartFor(pred, predSched, node.duration);
      if (candidate > es) es = candidate;
    }
    const dependencyStart = es;

    const constraint: ConstraintState = { type: input.constraintType ?? "ASAP", applied: false };

    if (input.constraintDate && !isIsoDate(input.constraintDate)) {
      report({
        kind: "data",
        severity: "warning",
        code: "invalid-constraint-date",
        message: `تاریخ محدودیت «${input.name}» معتبر نیست و نادیده گرفته شد`,
        activityIds: [input.id],
      });
    } else if (input.constraintDate && input.constraintType !== "ASAP") {
      const mode = input.constraintType === "FNLT" ? "finish" : "start";
      const mapped = constraintOffset(cal, anchorWorkday, input.constraintDate, mode);
      constraint.date = input.constraintDate;
      constraint.offset = mapped.offset;

      if (mapped.adjusted) {
        report({
          kind: "constraint",
          severity: "warning",
          code: "constraint-non-working-day",
          message: `تاریخ محدودیت «${input.name}» روی روز غیرکاری (${input.constraintDate}) است؛ تاریخ مؤثر ${mapped.alignedDate} در نظر گرفته شد`,
          activityIds: [input.id],
        });
      }

      if (input.constraintType === "SNET") {
        if (mapped.offset > es) {
          es = mapped.offset;
          constraint.applied = true;
        }
      } else if (input.constraintType === "MSO") {
        if (mapped.offset < 0) {
          constraint.conflict =
            "تاریخ اجباری پیش از شروع پروژه است؛ فعالیت روی اولین روز کاری پروژه قرار گرفت";
          report({
            kind: "constraint",
            severity: "error",
            code: "mso-before-project-start",
            message: `محدودیت «باید در تاریخ مشخص شروع شود» برای «${input.name}» پیش از شروع پروژه است`,
            activityIds: [input.id],
          });
          es = 0;
          constraint.offset = 0;
          constraint.applied = true;
        } else if (dependencyStart > mapped.offset) {
          // Honouring the forced date would break a real logic link, so the
          // network stays feasible and the conflict is reported loudly.
          constraint.conflict =
            "وابستگی‌ها شروع را به تاریخی پس از تاریخ اجباری منتقل می‌کنند؛ محدودیت قابل اجرا نیست";
          report({
            kind: "dependency",
            severity: "error",
            code: "mso-conflicts-with-logic",
            message:
              `محدودیت «باید در تاریخ مشخص شروع شود» برای «${input.name}» با وابستگی‌ها در تضاد است ` +
              `(شروع وابسته‌محور: ${dateFromOffset(cal, anchorWorkday, dependencyStart)} — تاریخ اجباری: ${mapped.alignedDate})`,
            activityIds: [input.id],
          });
          constraint.applied = false;
        } else {
          es = mapped.offset;
          constraint.applied = true;
        }
      } else if (input.constraintType === "FNLT") {
        // Finish constraints never move the early dates; they only cap the late
        // dates in the backward pass. Applied status is therefore decided there.
        if (finishCapOffset(mapped.offset) < node.duration) {
          constraint.conflict = "تاریخ پایان مجاز پیش از مدت لازم برای انجام فعالیت است";
        }
      }
    } else if (input.constraintType && input.constraintType !== "ASAP" && !input.constraintDate) {
      report({
        kind: "constraint",
        severity: "warning",
        code: "constraint-without-date",
        message: `برای «${input.name}» نوع محدودیت انتخاب شده اما تاریخ محدودیت ثبت نشده است`,
        activityIds: [input.id],
      });
    }

    if (es < 0) {
      report({
        kind: "dependency",
        severity: "warning",
        code: "negative-early-start",
        message: `وابستگی‌ها شروع «${input.name}» را پیش از شروع پروژه قرار می‌دهند؛ به اولین روز کاری منتقل شد`,
        activityIds: [input.id],
      });
      es = 0;
    }

    const safeEs = Number.isFinite(es) ? Math.round(es) : 0;
    result.set(id, {
      input,
      es: safeEs,
      ee: safeEs + node.duration,
      ls: safeEs,
      le: safeEs + node.duration,
      totalFloat: 0,
      freeFloat: 0,
      critical: false,
      constraint,
    });
  }

  /* ---------------- project finish ---------------- */
  let projectFinishOffset = 0;
  for (const sched of result.values()) projectFinishOffset = Math.max(projectFinishOffset, sched.ee);

  const naturalFinish = projectFinishOffset;
  // A contractual deadline earlier than the natural finish caps the backward
  // pass — that is what produces genuine negative total float.
  let backwardFinish = naturalFinish;
  if (typeof deadlineOffset === "number" && Number.isFinite(deadlineOffset) && deadlineOffset < backwardFinish) {
    backwardFinish = deadlineOffset;
  }

  /* ---------------- backward pass ---------------- */
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const sched = result.get(id);
    const node = nodes.get(id);
    if (!sched || !node) continue;

    let le = backwardFinish;
    for (const succ of node.successors) {
      const succSched = result.get(succ.id);
      if (!succSched) continue;
      const candidate = latestFinishFor(succ, succSched, node.duration);
      if (candidate < le) le = candidate;
    }

    const type = sched.input.constraintType;
    const constraint = sched.constraint;

    if (type === "MSO" && constraint.offset !== undefined && !constraint.conflict) {
      // Must Start On pins both late dates: the activity has no float of its own.
      sched.es = constraint.offset;
      sched.ls = constraint.offset;
      sched.le = constraint.offset + node.duration;
      sched.ee = sched.es + node.duration;
      const successorLatestStart = le - node.duration;
      if (successorLatestStart < constraint.offset) {
        report({
          kind: "dependency",
          severity: "warning",
          code: "mso-later-than-successors",
          message: `تاریخ اجباری شروع «${sched.input.name}» پس از دیرترین زمان مجاز جانشین‌ها است`,
          activityIds: [sched.input.id],
        });
      }
      sched.totalFloat = 0;
    } else {
      if (type === "FNLT" && constraint.offset !== undefined) {
        const cap = finishCapOffset(constraint.offset);
        if (cap < le) {
          le = cap;
          constraint.applied = true;
        }
        const overrun = sched.ee - cap;
        if (overrun > 0) {
          report({
            kind: "constraint",
            severity: "error",
            code: "fnlt-violated",
            message:
              `محدودیت «پایان نه دیرتر از» برای «${sched.input.name}» نقض شده است: ` +
              `پایان محاسبه‌شده ${dateFromOffset(cal, anchorWorkday, sched.ee - 1)} در برابر تاریخ مجاز ` +
              `${dateFromOffset(cal, anchorWorkday, cap - 1)} (${overrun} روز کاری تأخیر)`,
            activityIds: [sched.input.id],
          });
        }
      }

      sched.le = le;
      sched.ls = le - node.duration;
      sched.totalFloat = sched.ls - sched.es;
    }

    // Free float: how much this activity can slip before ANY successor's early
    // dates move. Per relation type the comparison is:
    //   FS: ES(S) − lag − EF(P)     SS: ES(S) − lag − ES(P)
    //   FF: EF(S) − lag − EF(P)     SF: EF(S) − lag − ES(P)
    // A terminal activity's free float equals its float against the natural
    // project finish.
    if (node.successors.length === 0) {
      sched.freeFloat = Math.max(0, naturalFinish - sched.ee);
    } else {
      let freeLimit = Infinity;
      for (const succ of node.successors) {
        const succSched = result.get(succ.id);
        if (!succSched) continue;
        let limit: number;
        switch (succ.type) {
          case "SS":
            limit = succSched.es - succ.lag - sched.es;
            break;
          case "FF":
            limit = succSched.ee - succ.lag - sched.ee;
            break;
          case "SF":
            limit = succSched.ee - succ.lag - sched.es;
            break;
          case "FS":
          default:
            limit = succSched.es - succ.lag - sched.ee;
            break;
        }
        if (limit < freeLimit) freeLimit = limit;
      }
      sched.freeFloat = Math.max(0, freeLimit === Infinity ? naturalFinish - sched.ee : freeLimit);
    }
    sched.critical = sched.totalFloat <= 0.001;
  }

  // Anything that never received dates (cycle members) must not leak NaN.
  for (const scheduled of result.values()) {
    if (!Number.isFinite(scheduled.totalFloat)) scheduled.totalFloat = 0;
    if (!Number.isFinite(scheduled.freeFloat)) scheduled.freeFloat = 0;
  }

  const startDate = dateFromOffset(cal, anchorWorkday, 0);
  const finishDate = dateFromOffset(cal, anchorWorkday, Math.max(0, naturalFinish - 1)) || startDate;

  const hasDataError = diagnostics.some(
    (d) => d.severity === "error" && (d.kind === "data" || d.kind === "cycle" || d.kind === "calendar"),
  );
  const hasConstraintConflict = diagnostics.some(
    (d) => d.severity === "error" && (d.kind === "constraint" || d.kind === "dependency"),
  );
  const negativeFloat = [...result.values()].some((s) => s.totalFloat < -0.001);
  const status: ScheduleResult["status"] = hasDataError
    ? "invalid"
    : hasConstraintConflict || negativeFloat
      ? "inconsistent"
      : diagnostics.length
        ? "warning"
        : "valid";

  return {
    anchor: anchorWorkday,
    start: startDate,
    finish: naturalFinish > 0 ? finishDate : startDate,
    duration: naturalFinish,
    activities: result,
    order,
    errors,
    warnings,
    diagnostics,
    status,
    unschedulable,
  };
}

/* ------------------------------------------------------------------ */
/* Resource allocation (usage only — no levelling)                     */
/* ------------------------------------------------------------------ */

export interface AllocationCell {
  offset: number;
  date: string;
  units: number;
}

export interface Allocation {
  resourceId: string;
  cells: Map<number, number>;
  peak: number;
  peakOffset: number;
  /** sum of units over all working days (unit-days) */
  total: number;
}

/**
 * Daily resource usage. This is **allocation**, not levelling: it reports what
 * the schedule demands, it never moves activities to flatten the profile.
 */
export function computeAllocations(input: ProjectInput, schedule: ScheduleResult): Map<string, Allocation> {
  const allocations = new Map<string, Allocation>();
  for (const resource of input.resources) {
    allocations.set(resource.id, {
      resourceId: resource.id,
      cells: new Map(),
      peak: 0,
      peakOffset: 0,
      total: 0,
    });
  }

  for (const activity of input.activities) {
    const sched = schedule.activities.get(activity.id);
    if (!sched) continue;
    for (const assignment of activity.resources ?? []) {
      const allocation = allocations.get(assignment.resourceId);
      if (!allocation) continue;
      for (let offset = sched.es; offset < sched.ee; offset += 1) {
        const current = allocation.cells.get(offset) ?? 0;
        const next = current + assignment.units;
        allocation.cells.set(offset, next);
        allocation.total += assignment.units;
        if (next > allocation.peak) {
          allocation.peak = next;
          allocation.peakOffset = offset;
        }
      }
    }
  }
  return allocations;
}

export function addWorkingDays(cal: WorkCalendar, date: string, days: number): string {
  return dateFromOffset(cal, date, days);
}

export { addCalendarDays };
