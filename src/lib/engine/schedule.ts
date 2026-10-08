import {
  addCalendarDays,
  alignStart,
  dateFromOffset,
  isIsoDate,
  offsetFromDate,
} from "./calendar";
import type { ActivityInput, ProjectInput, WorkCalendar } from "./types";

export interface ScheduledActivity {
  input: ActivityInput;
  es: number;
  ee: number;
  ls: number;
  le: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  constrained: boolean;
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
}

interface Node {
  id: string;
  duration: number;
  successors: { id: string; type: string; lag: number }[];
  predecessors: { id: string; type: string; lag: number }[];
}

/** Minimal working-day difference applied for SS/FF/SF relations. */
function earliestStartFor(
  relation: { type: string; lag: number },
  pred: ScheduledActivity,
  succDuration: number,
): number {
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
function latestFinishFor(
  relation: { type: string; lag: number },
  succ: ScheduledActivity,
  predecessorDuration: number,
): number {
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

/**
 * Critical Path Method (precedence diagramming method).
 *
 * Offsets are exclusive-end based: ee = es + duration. A milestone has
 * duration 0, therefore es === ee.
 */
export function computeSchedule(
  activities: ActivityInput[],
  cal: WorkCalendar,
  anchor: string,
  /** optional contractual finish date, expressed in working-day offset */
  deadlineOffset?: number | null,
): ScheduleResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = new Map<string, Node>();

  for (const activity of activities) {
    if (nodes.has(activity.id)) {
      errors.push(`شناسه فعالیت تکراری است: ${activity.code || activity.id}`);
      continue;
    }
    nodes.set(activity.id, {
      id: activity.id,
      duration: Math.max(0, Math.round(activity.duration)),
      successors: [],
      predecessors: [],
    });
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

  for (const activity of activities) {
    for (const dep of activity.predecessors ?? []) {
      const predId = resolve(dep.predecessorId);
      if (!predId) {
        warnings.push(`پیش‌نیاز نامعتبر برای «${activity.name}»: ${dep.predecessorId}`);
        continue;
      }
      if (predId === activity.id) {
        errors.push(`فعالیت «${activity.name}» به خودش وابسته است`);
        continue;
      }
      // `activity` is the SUCCESSOR and `predId` its predecessor:
      // the edge must be stored as pred -> successor, never the other way round.
      nodes.get(activity.id)?.predecessors.push({ id: predId, type: dep.type, lag: dep.lag });
      nodes.get(predId)?.successors.push({ id: activity.id, type: dep.type, lag: dep.lag });
    }
  }

  // Kahn topological ordering (head-pointer queue: O(V + E), no O(n) shift())
  const indegree = new Map<string, number>();
  for (const [id, node] of nodes) indegree.set(id, node.predecessors.length);
  const queue: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) queue.push(id);
  const order: string[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    order.push(id);
    for (const succ of nodes.get(id)?.successors ?? []) {
      const next = (indegree.get(succ.id) ?? 0) - 1;
      indegree.set(succ.id, next);
      if (next === 0) queue.push(succ.id);
    }
  }

  if (order.length !== nodes.size) {
    const cyclic = [...nodes.keys()].filter((id) => !order.includes(id));
    errors.push(
      `حلقه وابستگی (Circular Dependency) در فعالیت‌ها شناسایی شد: ${cyclic
        .slice(0, 5)
        .map((id) => nodes.get(id) ? activities.find((a) => a.id === id)?.name ?? id : id)
        .join("، ")}`,
    );
  }

  const result = new Map<string, ScheduledActivity>();
  const anchorWorkday = alignStart(cal, anchor);

  // ---------------- forward pass ----------------
  for (const id of order) {
    const node = nodes.get(id);
    const input = activities.find((a) => a.id === id);
    if (!node || !input) continue;

    let es = 0;
    for (const pred of node.predecessors) {
      const predSched = result.get(pred.id);
      if (!predSched) continue;
      const candidate = earliestStartFor(pred, predSched, node.duration);
      if (candidate > es) es = candidate;
    }

    let constrained = false;
    if (input.constraintDate && isIsoDate(input.constraintDate)) {
      const offset = offsetFromDate(cal, anchorWorkday, input.constraintDate);
      if (input.constraintType === "SNET" && offset > es) {
        es = offset;
        constrained = true;
      } else if (input.constraintType === "MSO" && offset > es) {
        if (es > 0) {
          warnings.push(
            `محدودیت «باید در تاریخ مشخص شروع شود» برای «${input.name}» با وابستگی‌ها در تضاد است`,
          );
        }
        es = Math.max(es, offset);
        constrained = true;
      }
    }

    result.set(id, {
      input,
      es,
      ee: es + node.duration,
      ls: es,
      le: es + node.duration,
      totalFloat: 0,
      freeFloat: 0,
      critical: false,
      constrained,
    });
  }

  // ---------------- project finish ----------------
  let projectFinishOffset = 0;
  for (const sched of result.values()) projectFinishOffset = Math.max(projectFinishOffset, sched.ee);

  // ---------------- backward pass ----------------
  // A deadline earlier than the natural finish caps the backward pass, which is
  // what produces genuine (negative) total float on the critical path.
  let backwardFinish = projectFinishOffset;
  if (typeof deadlineOffset === "number" && Number.isFinite(deadlineOffset) && deadlineOffset < backwardFinish) {
    backwardFinish = deadlineOffset;
  }

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

    if (sched.input.constraintType === "MSO" && sched.input.constraintDate) {
      const offset = offsetFromDate(cal, anchorWorkday, sched.input.constraintDate);
      if (offset > le - sched.input.duration) {
        le = offset + sched.input.duration;
      }
    }

    sched.le = le;
    sched.ls = le - sched.input.duration;
    sched.totalFloat = sched.ls - sched.es;

    // Free float: how much this activity can slip before ANY successor's early
    // dates move. Per relation type the comparison is:
    //   FS: ES(S) − lag − EF(P)     SS: ES(S) − lag − ES(P)
    //   FF: EF(S) − lag − EF(P)     SF: EF(S) − lag − ES(P)
    // A terminal activity's free float equals its float against the natural
    // project finish.
    if (node.successors.length === 0) {
      sched.freeFloat = Math.max(0, projectFinishOffset - sched.ee);
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
      sched.freeFloat = Math.max(0, freeLimit === Infinity ? projectFinishOffset - sched.ee : freeLimit);
    }
    sched.critical = sched.totalFloat <= 0.001;
  }

  const startDate = dateFromOffset(cal, anchorWorkday, 0);
  const finishDate =
    dateFromOffset(cal, anchorWorkday, Math.max(0, projectFinishOffset - 1)) || startDate;

  return {
    anchor: anchorWorkday,
    start: startDate,
    finish: projectFinishOffset > 0 ? finishDate : startDate,
    duration: projectFinishOffset,
    activities: result,
    order,
    errors,
    warnings,
  };
}

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
  total: number;
}

export function computeAllocations(
  input: ProjectInput,
  schedule: ScheduleResult,
): Map<string, Allocation> {
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
    for (const assignment of activity.resources) {
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
  const target = dateFromOffset(cal, date, days);
  return days >= 0 ? target : addCalendarDays(target, 0);
}
