import type { WorkCalendar } from "./types";

/* ------------------------------------------------------------------ */
/* ISO date helpers (yyyy-mm-dd, timezone-safe)                        */
/* ------------------------------------------------------------------ */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIso(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addCalendarDays(value: string, days: number): string {
  const d = parseIso(value);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function diffCalendarDays(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday (UTC based, deterministic across environments) */
export function weekday(value: string): number {
  return parseIso(value).getUTCDay();
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/* ------------------------------------------------------------------ */
/* Working calendar                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_CALENDAR: WorkCalendar = {
  // Iran default working week: Saturday → Wednesday (6, 0, 1, 2, 3)
  workDays: [6, 0, 1, 2, 3],
  holidays: [],
  hoursPerDay: 8,
};

export function normalizeCalendar(raw?: Partial<WorkCalendar> | null): WorkCalendar {
  const workDays = (raw?.workDays ?? DEFAULT_CALENDAR.workDays)
    .map((d) => Math.trunc(d))
    .filter((d) => d >= 0 && d <= 6);
  const uniqueDays = Array.from(new Set(workDays)).sort((a, b) => a - b);
  return {
    workDays: uniqueDays.length ? uniqueDays : DEFAULT_CALENDAR.workDays,
    holidays: Array.from(new Set(raw?.holidays ?? []))
      .filter(isIsoDate)
      .sort(),
    hoursPerDay: clampNumber(raw?.hoursPerDay ?? 8, 1, 24),
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function isWorkday(cal: WorkCalendar, date: string): boolean {
  if (!cal.workDays.includes(weekday(date))) return false;
  return !cal.holidays.includes(date);
}

export function nextWorkday(cal: WorkCalendar, date: string): string {
  let cursor = date;
  for (let i = 0; i < 400; i += 1) {
    if (isWorkday(cal, cursor)) return cursor;
    cursor = addCalendarDays(cursor, 1);
  }
  return cursor;
}

export function previousWorkday(cal: WorkCalendar, date: string): string {
  let cursor = date;
  for (let i = 0; i < 400; i += 1) {
    if (isWorkday(cal, cursor)) return cursor;
    cursor = addCalendarDays(cursor, -1);
  }
  return cursor;
}

/** First working day on or after `date`. */
export function alignStart(cal: WorkCalendar, date: string): string {
  return nextWorkday(cal, date);
}

/**
 * Offset 0 === first working day of the project.
 * Returns the working day that is `offset` working days after the anchor.
 */
export function dateFromOffset(cal: WorkCalendar, anchor: string, offset: number): string {
  if (offset < 0) return previousWorkday(cal, addCalendarDays(anchor, offset));
  const axis = getAxis(cal, nextWorkday(cal, anchor));
  const index = Math.trunc(offset);
  while (axis.workdays.length <= index && axis.offsetAt.size < AXIS_LIMIT) {
    extendAxis(axis, cal, addCalendarDays(axis.lastCursor, 1));
  }
  return axis.workdays[index] ?? axis.workdays[axis.workdays.length - 1] ?? nextWorkday(cal, anchor);
}

/* ------------------------------------------------------------------ */
/* Memoised date axis                                                  */
/*                                                                     */
/* dateFromOffset / offsetFromDate walk day by day, which made large   */
/* projects O(activities × days). A lazily-built axis keyed by the     */
/* calendar signature turns both lookups into O(1) amortised.          */
/* ------------------------------------------------------------------ */

const AXIS_LIMIT = 20_000; // ≈ 55 years of calendar days

interface Axis {
  /** calendar day -> number of working days strictly before it (from anchor) */
  offsetAt: Map<string, number>;
  /** offset -> working day */
  workdays: string[];
  lastCursor: string;
}

let axisCache: { key: string; axis: Axis } | null = null;

function axisKey(cal: WorkCalendar, anchor: string): string {
  return `${anchor}|${cal.workDays.join(",")}|${cal.holidays.join(",")}`;
}

function getAxis(cal: WorkCalendar, anchor: string): Axis {
  const key = axisKey(cal, anchor);
  if (axisCache && axisCache.key === key) return axisCache.axis;
  // the anchor itself is the first working day when it is one
  const axis: Axis = {
    offsetAt: new Map([[anchor, 0]]),
    workdays: isWorkday(cal, anchor) ? [anchor] : [],
    lastCursor: anchor,
  };
  axisCache = { key, axis };
  return axis;
}

/** Extends the axis so that `upto` (a calendar date) is indexed. */
function extendAxis(axis: Axis, cal: WorkCalendar, upto: string): void {
  let cursor = axis.lastCursor;
  while (cursor < upto && axis.offsetAt.size < AXIS_LIMIT) {
    cursor = addCalendarDays(cursor, 1);
    // offsetAt = number of working days strictly before `cursor`, which for a
    // working day is also its index in `workdays`
    axis.offsetAt.set(cursor, axis.workdays.length);
    if (isWorkday(cal, cursor)) axis.workdays.push(cursor);
  }
  if (cursor > axis.lastCursor) axis.lastCursor = cursor;
}

/**
 * Number of working days in the inclusive range [start, end].
 * start is normally a working day (an activity start), so this equals
 * offsetOf(end) − offsetOf(start) + 1.
 */
export function countWorkingDaysInclusive(cal: WorkCalendar, start: string, end: string): number {
  if (end < start) return 0;
  const axis = getAxis(cal, nextWorkday(cal, start));
  if (!axis.offsetAt.has(end)) extendAxis(axis, cal, addCalendarDays(end, 1));
  const endOffset = axis.offsetAt.get(end) ?? 0;
  const started = isWorkday(cal, start) ? 1 : 0;
  return Math.max(0, endOffset + started);
}

/** Number of working days from the anchor working day until `date` (may be negative). */
export function offsetFromDate(cal: WorkCalendar, anchor: string, date: string): number {
  const anchorWd = nextWorkday(cal, anchor);
  if (date === anchorWd) return 0;
  if (date < anchorWd) {
    // before the anchor: walk backwards (rare, short distances in practice)
    let cursor = anchorWd;
    let count = 0;
    while (cursor > date && count < 4000) {
      cursor = addCalendarDays(cursor, -1);
      if (isWorkday(cal, cursor)) count += 1;
    }
    return -count;
  }
  const axis = getAxis(cal, anchorWd);
  if (!axis.offsetAt.has(date)) extendAxis(axis, cal, addCalendarDays(date, 1));
  return axis.offsetAt.get(date) ?? 0;
}

export function workingDaysBetween(cal: WorkCalendar, start: string, end: string): string[] {
  if (end < start) return [];
  const axis = getAxis(cal, nextWorkday(cal, start));
  if (!axis.offsetAt.has(end)) extendAxis(axis, cal, addCalendarDays(end, 1));
  return axis.workdays.filter((date) => date >= start && date <= end);
}

/**
 * Safety net for calendars that contain no working day at all.
 * Returns a valid fallback so the scheduler can never loop forever.
 */
export function ensureViableCalendar(cal: WorkCalendar): WorkCalendar {
  const normalized = normalizeCalendar(cal);
  const probe = nextWorkday(normalized, "2026-01-01");
  if (isWorkday(normalized, probe) && normalized.workDays.length > 0) return normalized;
  return { ...normalized, workDays: DEFAULT_CALENDAR.workDays, holidays: [] };
}

function guardWorkdayTraversal(cursor: string, target: string): void {
  void cursor;
  void target;
}

export function countWorkingDays(cal: WorkCalendar, start: string, end: string): number {
  return workingDaysBetween(cal, start, end).length;
}
