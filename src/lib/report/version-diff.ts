/**
 * HERMIPLAN — semantic diff between two project revisions.
 *
 * A revision list that only says "نسخه ۳" is not enough to decide whether to
 * restore it: the owner has to see *what* changed. This module turns two stored
 * payloads into a stable, reviewable list of changes.
 *
 * Design rules (deliberate, and covered by `scripts/version-diff-check.ts`):
 *
 *  • **Nothing is silently ignored.** Entities are matched by `id`; every key
 *    that differs between the two versions is reported. Known keys carry a
 *    Persian label, unknown ones fall back to the raw key instead of being
 *    dropped (a new field added elsewhere must never make a diff lie).
 *  • **Pure and deterministic.** No I/O, no locale-dependent sorting: the same
 *    pair of payloads always produces the same structure and order, so a diff
 *    can be compared, cached or asserted in a test.
 *  • **Values are data, not prose.** Numbers stay numbers; the UI decides how to
 *    format them (Persian digits, currency, dates). Only structurally nested
 *    values (dependency lists, unit lists) are summarised into short strings,
 *    because an array of objects is not readable in a table cell.
 */
import type { ProjectInput } from "@/lib/engine/types";

export type DiffStatus = "added" | "removed" | "changed";

/** One changed property of an entity (or of the project itself). */
export interface DiffField {
  key: string;
  label: string;
  /** `null` means "absent" (undefined / empty string), rendered as «—» */
  before: string | null;
  after: string | null;
}

export interface DiffEntry {
  id: string;
  /** stable, human-readable title: «کد — نام» */
  title: string;
  status: DiffStatus;
  fields: DiffField[];
}

export interface DiffGroup {
  key: string;
  label: string;
  entries: DiffEntry[];
}

export interface ProjectDiff {
  identical: boolean;
  counts: { added: number; removed: number; changed: number; total: number };
  /** meta / calendar / pricing — single-project settings, shown first */
  settings: DiffField[];
  groups: DiffGroup[];
}

/** Everything a revision stores about the project. */
export interface RevisionPayload {
  project: ProjectInput;
  reportOptions?: Record<string, unknown> | null;
}

const FIELD_LABELS: Record<string, string> = {
  // project meta
  name: "نام پروژه",
  code: "کد پروژه",
  type: "نوع پروژه",
  client: "کارفرما",
  contractor: "پیمانکار",
  consultant: "مشاور",
  location: "محل",
  manager: "مدیر پروژه",
  description: "توضیحات",
  currency: "واحد پول",
  budget: "بودجه مصوب",
  startDate: "تاریخ شروع",
  deadline: "مهلت قراردادی",
  statusDate: "تاریخ وضعیت",
  // calendar
  workDays: "روزهای کاری هفته",
  holidays: "تعطیلات",
  hoursPerDay: "ساعت کاری روزانه",
  // pricing
  series: "سری نرخ",
  region: "منطقه",
  indexFactor: "ضریب تعدیل",
  escalationEnabled: "تعدیل فعال",
  escalationRatePerMonth: "نرخ تعدیل ماهانه",
  overheadPercent: "درصد بالاسری",
  profitPercent: "درصد سود",
  contingencyPercent: "درصد ذخیره احتیاطی",
  appliedAt: "تاریخ اعمال نرخ",
  // activity / resource / risk / milestone
  phase: "فاز",
  duration: "مدت (روز کاری)",
  progress: "پیشرفت فیزیکی",
  predecessors: "وابستگی‌ها",
  resources: "منابع",
  fixedCost: "هزینه ثابت",
  materialCost: "هزینه مصالح",
  actualCost: "هزینه واقعی",
  quantity: "کارکرد متره",
  constraintType: "نوع محدودیت",
  constraintDate: "تاریخ محدودیت",
  milestone: "نقطه عطف",
  deliverable: "تحویل‌شدنی",
  notes: "یادداشت",
  riskProbability: "احتمال ریسک",
  riskImpact: "اثر ریسک",
  rate: "نرخ",
  capacity: "ظرفیت",
  rateKey: "کلید نرخ",
  unit: "واحد",
  rateSource: "منبع نرخ",
  date: "تاریخ",
  activityId: "فعالیت مرتبط",
  title: "عنوان",
  category: "دسته",
  probability: "احتمال",
  impact: "اثر",
  scheduleImpact: "اثر زمانی (روز)",
  costImpact: "اثر هزینه‌ای",
  mitigation: "اقدام کاهنده",
  owner: "مسئول",
  planned: "برنامه‌ای",
  actual: "واقعی",
  approved: "تأییدشده",
  // report options
  sections: "بخش‌های گزارش",
};

const labelOf = (key: string, overrides?: Record<string, string>): string =>
  overrides?.[key] ?? FIELD_LABELS[key] ?? key;

/** Stable JSON: object keys sorted, so key order never looks like a change. */
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

interface RenderContext {
  /** activity id → «کد — نام» in the *same* revision, for readable dependency lists */
  activityNames: Map<string, string>;
  resourceNames: Map<string, string>;
}

function buildContext(project: ProjectInput): RenderContext {
  const activityNames = new Map<string, string>();
  for (const activity of project.activities ?? []) {
    activityNames.set(activity.id, `${activity.code || activity.id} — ${activity.name}`);
  }
  const resourceNames = new Map<string, string>();
  for (const resource of project.resources ?? []) {
    resourceNames.set(resource.id, resource.name || resource.id);
  }
  return { activityNames, resourceNames };
}

/** Turns one side's value into a short, comparable text (or null when absent). */
function render(key: string, value: unknown, ctx: RenderContext): string | null {
  if (isEmpty(value)) return null;
  if (typeof value === "boolean") {
    if (/enabled$/i.test(key)) return value ? "فعال" : "غیرفعال";
    return value ? "بله" : "خیر";
  }
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) {
    if (key === "workDays") return value.map((day) => String(day)).join("، ");
    if (key === "holidays") return `${value.length} روز`;
    if (key === "predecessors") {
      const list = value as { predecessorId: string; type: string; lag: number }[];
      if (list.length === 0) return "بدون وابستگی";
      return list
        .map((dep) => {
          const name = ctx.activityNames.get(dep.predecessorId) ?? dep.predecessorId;
          const lag = dep.lag ? ` ${dep.lag > 0 ? "+" : "−"}${Math.abs(dep.lag)}` : "";
          return `${name} (${dep.type}${lag})`;
        })
        .join("، ");
    }
    if (key === "resources") {
      const list = value as { resourceId: string; units: number }[];
      if (list.length === 0) return "بدون منبع";
      return list
        .map((item) => `${ctx.resourceNames.get(item.resourceId) ?? item.resourceId} × ${item.units}`)
        .join("، ");
    }
    if (value.length === 0) return null;
  }
  if (key === "quantity") {
    const q = value as { unit: string; planned: number; actual: number; approved?: number };
    return `${q.planned}/${q.actual}${q.approved === undefined ? "" : `/${q.approved}`} ${q.unit}`;
  }
  if (typeof value === "object") {
    const text = canonical(value);
    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  }
  return String(value);
}

/** Compares two flat records and returns every differing key (label + texts). */
function compareRecords(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  ctxBefore: RenderContext,
  ctxAfter: RenderContext,
  overrides?: Record<string, string>,
): DiffField[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const fields: DiffField[] = [];
  for (const key of [...keys].sort()) {
    const a = before?.[key];
    const b = after?.[key];
    if (same(a, b)) continue;
    const renderedBefore = render(key, a, ctxBefore);
    const renderedAfter = render(key, b, ctxAfter);
    // `undefined` and `""` both render as null: an explicit empty string replacing
    // a missing value is not a change a user can act on.
    if (renderedBefore === renderedAfter) continue;
    fields.push({ key, label: labelOf(key, overrides), before: renderedBefore, after: renderedAfter });
  }
  return fields;
}

type Entity = Record<string, unknown> & { id: string };

/**
 * Matches two entity lists by id and reports additions, removals and changes.
 * Ordering is by id so the output never depends on the order stored in the row.
 */
function compareEntities(
  before: Entity[] | undefined,
  after: Entity[] | undefined,
  ctxBefore: RenderContext,
  ctxAfter: RenderContext,
  titleOf: (entity: Entity) => string,
  /** entity-scoped labels, so «name» reads «نام فعالیت» here and «نام پروژه» in meta */
  overrides?: Record<string, string>,
): DiffEntry[] {
  const beforeById = new Map((before ?? []).map((item) => [item.id, item]));
  const afterById = new Map((after ?? []).map((item) => [item.id, item]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const entries: DiffEntry[] = [];

  for (const id of ids) {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    if (a && !b) {
      entries.push({
        id,
        title: titleOf(a),
        status: "removed",
        fields: compareRecords(a, undefined, ctxBefore, ctxAfter, overrides),
      });
      continue;
    }
    if (!a && b) {
      entries.push({
        id,
        title: titleOf(b),
        status: "added",
        fields: compareRecords(undefined, b, ctxBefore, ctxAfter, overrides),
      });
      continue;
    }
    if (!a || !b) continue;
    const fields = compareRecords(a, b, ctxBefore, ctxAfter, overrides);
    if (fields.length > 0) entries.push({ id, title: titleOf(b), status: "changed", fields });
  }
  return entries;
}

const activityTitle = (entity: Entity): string => {
  const code = typeof entity.code === "string" && entity.code ? entity.code : entity.id;
  const name = typeof entity.name === "string" ? entity.name : "";
  return name ? `${code} — ${name}` : String(code);
};

/**
 * The settings block covers the three single-valued parts of a project. Keys the
 * engine adds later are compared automatically — nothing has to be listed here
 * for a change to be reported.
 */
function compareSettings(before: ProjectInput, after: ProjectInput): DiffField[] {
  const empty: RenderContext = { activityNames: new Map(), resourceNames: new Map() };
  const fields: DiffField[] = [];
  for (const section of ["meta", "calendar", "pricing"] as const) {
    fields.push(
      ...compareRecords(
        before[section] as unknown as Record<string, unknown>,
        after[section] as unknown as Record<string, unknown>,
        empty,
        empty,
      ),
    );
  }
  return fields;
}

/** Full, deterministic comparison of two revisions. */
export function diffRevisions(before: RevisionPayload, after: RevisionPayload): ProjectDiff {
  const ctxBefore = buildContext(before.project);
  const ctxAfter = buildContext(after.project);

  const groups: DiffGroup[] = [
    {
      key: "activities",
      label: "فعالیت‌ها",
      entries: compareEntities(
        before.project.activities as unknown as Entity[],
        after.project.activities as unknown as Entity[],
        ctxBefore,
        ctxAfter,
        activityTitle,
        { name: "نام فعالیت", code: "کد فعالیت", phase: "فاز" },
      ),
    },
    {
      key: "milestones",
      label: "نقاط عطف",
      entries: compareEntities(
        before.project.milestones as unknown as Entity[],
        after.project.milestones as unknown as Entity[],
        ctxBefore,
        ctxAfter,
        (entity) => (typeof entity.name === "string" ? entity.name : entity.id),
        { name: "نام نقطه عطف", date: "تاریخ نقطه عطف", activityId: "فعالیت مرتبط" },
      ),
    },
    {
      key: "resources",
      label: "منابع",
      entries: compareEntities(
        before.project.resources as unknown as Entity[],
        after.project.resources as unknown as Entity[],
        ctxBefore,
        ctxAfter,
        (entity) => (typeof entity.name === "string" ? entity.name : entity.id),
        { name: "نام منبع", rate: "نرخ روزانه", capacity: "ظرفیت روزانه" },
      ),
    },
    {
      key: "risks",
      label: "ریسک‌ها",
      entries: compareEntities(
        before.project.risks as unknown as Entity[],
        after.project.risks as unknown as Entity[],
        ctxBefore,
        ctxAfter,
        (entity) => (typeof entity.title === "string" ? entity.title : entity.id),
        { title: "عنوان ریسک" },
      ),
    },
  ];

  // The baseline and the report options are single blocks, not lists.
  const baselineFields = compareRecords(
    (before.project.baseline ?? undefined) as Record<string, unknown> | undefined,
    (after.project.baseline ?? undefined) as Record<string, unknown> | undefined,
    ctxBefore,
    ctxAfter,
  );
  if (baselineFields.length > 0) {
    groups.push({
      key: "baseline",
      label: "خط مبنا",
      entries: [{ id: "baseline", title: "خط مبنای پروژه", status: "changed", fields: baselineFields }],
    });
  }

  const optionFields = compareRecords(
    (before.reportOptions ?? undefined) as Record<string, unknown> | undefined,
    (after.reportOptions ?? undefined) as Record<string, unknown> | undefined,
    ctxBefore,
    ctxAfter,
  );
  if (optionFields.length > 0) {
    groups.push({
      key: "reportOptions",
      label: "تنظیمات گزارش",
      entries: [{ id: "reportOptions", title: "تنظیمات گزارش", status: "changed", fields: optionFields }],
    });
  }

  const settings = compareSettings(before.project, after.project);
  const visibleGroups = groups.filter((group) => group.entries.length > 0);
  const counts = { added: 0, removed: 0, changed: 0, total: 0 };
  for (const group of visibleGroups) {
    for (const entry of group.entries) counts[entry.status] += 1;
  }
  counts.changed += settings.length > 0 ? 1 : 0;
  counts.total = counts.added + counts.removed + counts.changed;

  return {
    identical: counts.total === 0,
    counts,
    settings,
    groups: visibleGroups,
  };
}

/** Persian sentence for the headline of a diff panel. */
export function diffHeadline(diff: ProjectDiff): string {
  if (diff.identical) return "این دو نسخه هیچ تفاوتی ندارند.";
  const parts: string[] = [];
  if (diff.counts.added > 0) parts.push(`${diff.counts.added} افزوده`);
  if (diff.counts.removed > 0) parts.push(`${diff.counts.removed} حذف‌شده`);
  if (diff.counts.changed > 0) parts.push(`${diff.counts.changed} تغییر‌یافته`);
  return `${parts.join(" · ")} — ${diff.counts.total} مورد.`;
}
