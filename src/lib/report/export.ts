import { formatJalali } from "@/lib/date-fa";
import { isIsoDate } from "@/lib/engine/calendar";
import { normalizePricing } from "@/lib/market/engine";
import type { ActivityInput, ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

export interface SheetDate {
  kind: "date";
  value: string;
}

export interface SheetPercent {
  kind: "percent";
  /** HERMIPLAN's source value, on a 0..100 scale. */
  value: number;
}

export interface SheetCurrency {
  kind: "currency";
  value: number;
}

export type SheetVisualStyle = "ganttPhase" | "ganttPlanned" | "ganttCritical" | "ganttComplete" | "ganttMilestone";

export interface SheetStyledValue {
  kind: "styled";
  value: string | number;
  style: SheetVisualStyle;
}

export type SheetCell = string | number | null | SheetDate | SheetPercent | SheetCurrency | SheetStyledValue;

export interface SheetColumn {
  /** Approximate Excel width in character units. */
  width?: number;
}

export interface Sheet {
  name: string;
  headers: string[];
  rows: SheetCell[][];
  columns?: SheetColumn[];
  /** Freeze the first N columns as well as the header row. */
  freezeColumns?: number;
  /** Auto-filter only the first N columns (useful for wide Gantt sheets). */
  filterColumnCount?: number;
}

export const dateCell = (value?: string | null): SheetCell =>
  value && isIsoDate(value) ? { kind: "date", value } : "";

export const percentCell = (value: number): SheetCell =>
  Number.isFinite(value) ? { kind: "percent", value } : "";

export const currencyCell = (value: number): SheetCell =>
  Number.isFinite(value) ? { kind: "currency", value } : "";

export const styledCell = (value: string | number, style: SheetVisualStyle): SheetCell => ({
  kind: "styled",
  value,
  style,
});

/** CSV is a single-table format, so the report UI lets users select a sheet. */
export const CSV_SHEET_OPTIONS = [
  { id: "activities", sheetName: "Activities", label: "فعالیت‌ها و زمان‌بندی" },
  { id: "dependencies", sheetName: "Dependencies", label: "وابستگی‌ها" },
  { id: "wbs", sheetName: "WBS", label: "ساختار شکست کار (WBS)" },
  { id: "gantt", sheetName: "Gantt", label: "نمودار گانت (داده جدولی)" },
  { id: "milestones", sheetName: "Milestones", label: "نقاط کنترل" },
  { id: "resources", sheetName: "Resources", label: "منابع" },
  { id: "assignments", sheetName: "Assignments", label: "تخصیص منابع به فعالیت‌ها" },
  { id: "costs", sheetName: "Costs", label: "هزینه‌های فازی" },
  { id: "evm", sheetName: "EVM", label: "پیشرفت و ارزش کسب‌شده" },
  { id: "risks", sheetName: "Risks", label: "ریسک‌ها" },
  { id: "delays", sheetName: "Delays", label: "تأخیرها" },
  { id: "pricing", sheetName: "Pricing", label: "نرخ‌های منابع" },
  { id: "escalation", sheetName: "Escalation", label: "تعدیل ماهانه" },
  { id: "costSummary", sheetName: "CostSummary", label: "خلاصه برآورد هزینه" },
  { id: "standards", sheetName: "Standards", label: "مبنای استانداردها" },
  { id: "baseline", sheetName: "Baseline", label: "مقایسه با مبنا" },
  { id: "calendar", sheetName: "Calendar", label: "تقویم و تعطیلات" },
  { id: "checks", sheetName: "Checks", label: "هشدارها و بررسی‌ها" },
  { id: "info", sheetName: "Info", label: "خلاصه پروژه" },
] as const;

const DAY_NAMES_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const CONSTRAINT_LABELS: Record<string, string> = {
  ASAP: "هرچه زودتر ممکن (ASAP)",
  SNET: "شروع نه زودتر از (SNET)",
  MSO: "شروع در تاریخ مشخص (MSO)",
  FNLT: "پایان نه دیرتر از (FNLT)",
};
const ACTIVITY_STATUS_LABELS: Record<string, string> = {
  "not-started": "شروع‌نشده",
  "in-progress": "در حال اجرا",
  completed: "تکمیل‌شده",
  late: "دارای تأخیر",
};
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  labor: "نیروی انسانی",
  equipment: "تجهیزات",
  material: "مصالح / مواد",
  cost: "هزینه‌ای",
};
const CURRENCY_LABELS: Record<string, string> = { IRR: "ریال", USD: "دلار آمریکا", EUR: "یورو" };

function jalali(value?: string | null): string {
  return value && isIsoDate(value) ? formatJalali(value, { withMonthName: false }) : "";
}

function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addCalendarDays(value: string, days: number): string {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDayDifference(start: string, end: string): number {
  return Math.round((calendarDate(end).getTime() - calendarDate(start).getTime()) / 86_400_000);
}

function monthStart(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function nextMonth(value: string): string {
  const date = calendarDate(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function taskById(project: ProjectInput): Map<string, ActivityInput> {
  const map = new Map<string, ActivityInput>();
  for (const activity of project.activities) {
    if (!map.has(activity.id)) map.set(activity.id, activity);
  }
  return map;
}

function dependencyReference(
  predecessorId: string,
  byId: Map<string, ActivityInput>,
  byCode: Map<string, ActivityInput>,
): ActivityInput | undefined {
  return byId.get(predecessorId) ?? byCode.get(predecessorId);
}

function dependencySummary(
  activity: ActivityInput | undefined,
  byId: Map<string, ActivityInput>,
  byCode: Map<string, ActivityInput>,
): string {
  if (!activity?.predecessors.length) return "";
  return activity.predecessors
    .map((dependency) => {
      const predecessor = dependencyReference(dependency.predecessorId, byId, byCode);
      const reference = predecessor?.code || dependency.predecessorId;
      const lag = dependency.lag > 0 ? `+${dependency.lag}` : String(dependency.lag);
      return `${reference} (${dependency.type}, ${lag} روز کاری)`;
    })
    .join("؛ ");
}

function resourceAssignments(
  activity: ActivityInput | undefined,
  resourceById: Map<string, ProjectInput["resources"][number]>,
): string {
  if (!activity?.resources.length) return "";
  return activity.resources
    .map((assignment) => {
      const resource = resourceById.get(assignment.resourceId);
      const name = resource?.name ?? `منبع نامشخص (${assignment.resourceId})`;
      const unit = resource?.unit ? ` ${resource.unit}` : " واحد";
      return `${name} × ${assignment.units}${unit}`;
    })
    .join("؛ ");
}

function ganttPeriods(analysis: ProjectAnalysis): {
  granularity: "روزانه" | "هفتگی" | "ماهانه";
  periods: { start: string; end: string; label: string }[];
} {
  const start = analysis.schedule.startDate;
  const finish = analysis.schedule.finishDate;
  const calendarDays = Math.max(1, calendarDayDifference(start, finish) + 1);
  if (calendarDays <= 120) {
    const periods = Array.from({ length: calendarDays }, (_, index) => {
      const date = addCalendarDays(start, index);
      return { start: date, end: date, label: jalali(date) };
    });
    return { granularity: "روزانه", periods };
  }

  if (calendarDays <= 730) {
    const count = Math.ceil(calendarDays / 7);
    const periods = Array.from({ length: count }, (_, index) => {
      const periodStart = addCalendarDays(start, index * 7);
      const periodEnd = addCalendarDays(periodStart, 6);
      return { start: periodStart, end: periodEnd, label: `هفته ${jalali(periodStart)}` };
    });
    return { granularity: "هفتگی", periods };
  }

  const periods: { start: string; end: string; label: string }[] = [];
  let periodStart = monthStart(start);
  while (periodStart <= finish) {
    const next = nextMonth(periodStart);
    const periodEnd = addCalendarDays(next, -1);
    const [year, month] = jalali(periodStart).split("/");
    periods.push({ start: periodStart, end: periodEnd, label: `${year}/${month}` });
    periodStart = next;
  }
  return { granularity: "ماهانه", periods };
}

function buildGanttSheet(analysis: ProjectAnalysis): Sheet | null {
  if (!analysis.activities.length) return null;

  const { granularity, periods } = ganttPeriods(analysis);
  const dateById = new Map(analysis.activities.map((activity) => [activity.id, activity]));
  const phaseByName = new Map(analysis.schedule.phases.map((phase) => [phase.name, phase]));
  const fixedHeaders = [
    "WBS",
    "کد",
    "فعالیت / فاز",
    "فاز",
    "شروع (Excel / Gregorian)",
    "پایان (Excel / Gregorian)",
    "شروع شمسی",
    "پایان شمسی",
    "پیشرفت",
    "بحرانی؟",
    "نوع ردیف",
  ];
  const headers = [...fixedHeaders, ...periods.map((period) => period.label)];
  const rows: SheetCell[][] = [];

  for (const ganttRow of analysis.gantt.rows) {
    const isPhase = ganttRow.kind === "phase";
    const phase = isPhase ? phaseByName.get(ganttRow.name) : undefined;
    const activity = isPhase ? undefined : dateById.get(ganttRow.id);
    if (!isPhase && !activity) continue;

    const start = phase?.startDate ?? activity?.startDate ?? analysis.schedule.startDate;
    const finish = phase?.finishDate ?? activity?.finishDate ?? start;
    const progress = phase?.progress ?? activity?.progress ?? 0;
    const critical = phase?.critical ?? activity?.critical ?? false;
    const milestone = ganttRow.kind === "milestone" || Boolean(activity?.milestone);
    const timelineCells: SheetCell[] = periods.map((period) => {
      if (finish < period.start || start > period.end) return "";
      if (isPhase) return styledCell(" ", "ganttPhase");
      if (milestone) return styledCell("◆", "ganttMilestone");
      if (progress >= 100) return styledCell(" ", "ganttComplete");
      return styledCell(" ", critical ? "ganttCritical" : "ganttPlanned");
    });

    rows.push([
      ganttRow.wbs,
      isPhase ? "" : activity?.code ?? "",
      ganttRow.name,
      isPhase ? ganttRow.name : activity?.phase ?? "",
      dateCell(start),
      dateCell(finish),
      jalali(start),
      jalali(finish),
      percentCell(progress),
      critical ? "بله" : "خیر",
      isPhase ? "فاز" : milestone ? "نقطه‌عطف" : "فعالیت",
      ...timelineCells,
    ]);

  }

  const widths = [10, 12, 42, 20, 15, 15, 14, 14, 12, 12, 14];
  widths.push(...periods.map(() => (granularity === "روزانه" ? 4.5 : 10)));
  return {
    name: "Gantt",
    headers,
    rows,
    columns: widths.map((width) => ({ width })),
    freezeColumns: fixedHeaders.length,
    filterColumnCount: fixedHeaders.length,
  };
}

export function buildSheets(analysis: ProjectAnalysis, input: ProjectInput): Sheet[] {
  const activityById = new Map(analysis.activities.map((activity) => [activity.id, activity]));
  const rawActivityById = taskById(input);
  const resourceById = new Map(input.resources.map((resource) => [resource.id, resource]));
  const activityByCode = new Map<string, ActivityInput>();
  for (const activity of input.activities) {
    if (activity.code) activityByCode.set(activity.code, activity);
  }
  const currency = input.meta.currency;
  const moneyLabel = CURRENCY_LABELS[currency] ?? currency;
  const pricingSettings = normalizePricing(input.pricing);
  const sheets: Sheet[] = [];

  const criticalCount = analysis.activities.filter((activity) => activity.critical).length;
  const dependencyCount = input.activities.reduce((sum, activity) => sum + activity.predecessors.length, 0);
  const inputPhaseCount = new Set(input.activities.map((activity) => activity.phase)).size;
  const activityMilestoneCount = input.activities.filter(
    (activity) => (activity.milestone || activity.duration === 0) && !input.milestones.some((milestone) => milestone.activityId === activity.id),
  ).length;
  const milestoneCount = input.milestones.length + activityMilestoneCount;
  const constraintLabel = (value?: string) => CONSTRAINT_LABELS[value ?? "ASAP"] ?? value ?? "";

  sheets.push({
    name: "Info",
    headers: ["شاخص / مشخصه", "مقدار"],
    columns: [{ width: 38 }, { width: 72 }],
    rows: [
      ["نام پروژه", input.meta.name],
      ["کد پروژه", input.meta.code ?? ""],
      ["نوع پروژه", input.meta.type],
      ["شرح پروژه", input.meta.description ?? ""],
      ["کارفرما", input.meta.client ?? ""],
      ["پیمانکار", input.meta.contractor ?? ""],
      ["مشاور", input.meta.consultant ?? ""],
      ["مدیر پروژه", input.meta.manager ?? ""],
      ["موقعیت", input.meta.location ?? ""],
      ["واحد پول", `${currency} — ${moneyLabel}`],
      ["تاریخ شروع ورودی (Excel / Gregorian)", dateCell(input.meta.startDate)],
      ["تاریخ شروع ورودی (شمسی)", jalali(input.meta.startDate)],
      ["شروع محاسبه‌شده (Excel / Gregorian)", dateCell(analysis.schedule.startDate)],
      ["شروع محاسبه‌شده (شمسی)", jalali(analysis.schedule.startDate)],
      ["پایان محاسبه‌شده (Excel / Gregorian)", dateCell(analysis.schedule.finishDate)],
      ["پایان محاسبه‌شده (شمسی)", jalali(analysis.schedule.finishDate)],
      ["تاریخ وضعیت (Excel / Gregorian)", dateCell(input.meta.statusDate)],
      ["تاریخ وضعیت (شمسی)", jalali(input.meta.statusDate)],
      ["تاریخ هدف قراردادی (Excel / Gregorian)", dateCell(input.meta.deadline)],
      ["تاریخ هدف قراردادی (شمسی)", jalali(input.meta.deadline)],
      ["مدت برنامه", analysis.schedule.workingDays],
      ["روز تقویمی برنامه", analysis.schedule.calendarDays],
      ["ساعت کاری در روز", analysis.schedule.hoursPerDay],
      ["تعداد فعالیت ثبت‌شده", input.activities.length],
      ["فعالیت‌های زمان‌بندی‌شده", analysis.activities.length],
      ["تعداد فاز ثبت‌شده", inputPhaseCount],
      ["تعداد وابستگی ثبت‌شده", dependencyCount],
      ["تعداد نقاط کنترل ثبت‌شده", milestoneCount],
      ["تعداد منابع", analysis.resources.length],
      ["تعداد تخصیص منابع", input.activities.reduce((sum, activity) => sum + activity.resources.length, 0)],
      ["تعداد ریسک", analysis.risks.length],
      ["فعالیت‌های بحرانی", criticalCount],
      ["بودجه مصوب ورودی", input.meta.budget === undefined ? "" : currencyCell(input.meta.budget)],
      ["بودجه مستقیم محاسبه‌شده", currencyCell(analysis.costs.budget)],
      ["هزینه واقعی تا تاریخ وضعیت", currencyCell(analysis.costs.actual)],
      ["ارزش کسب‌شده (EV)", currencyCell(analysis.costs.earned)],
      ["ارزش برنامه‌ای تا تاریخ وضعیت (PV)", currencyCell(analysis.costs.plannedToDate)],
      ["پیشرفت فیزیکی", percentCell(analysis.progress.overall)],
      ["پیشرفت برنامه‌ای", percentCell(analysis.progress.planned)],
      ["SPI", analysis.progress.schedulePerformanceIndex],
      ["CPI", analysis.progress.costPerformanceIndex],
      ["برآورد هزینه در پایان (EAC)", currencyCell(analysis.costs.estimateAtCompletion)],
      ["انحراف هزینه در پایان (VAC)", currencyCell(analysis.costs.varianceAtCompletion)],
      ["امتیاز سلامت پروژه", analysis.health.score],
      ["مبنای نرخ", analysis.pricing.seriesLabel],
      ["منطقه نرخ", analysis.pricing.regionLabel],
      ["تاریخ مرجع نرخ بازار", analysis.pricing.asOfJalali],
      ["ضریب تعدیل عمومی", analysis.pricing.indexFactor],
      ["نرخ تعدیل ماهانه (٪)", percentCell(analysis.pricing.escalationRatePerMonth)],
      ["تعدیل فعال است؟", pricingSettings.escalationEnabled ? "بله" : "خیر"],
      ["سربار (٪)", percentCell(pricingSettings.overheadPercent)],
      ["سود پیمانکار (٪)", percentCell(pricingSettings.profitPercent)],
      ["ذخیره احتیاطی (٪)", percentCell(pricingSettings.contingencyPercent)],
      ["مبلغ برآورد نهایی", currencyCell(analysis.pricing.breakdown.total)],
      ["مدل تاریخ Excel", "تاریخ‌های Excel به‌صورت تاریخ واقعی (Gregorian/UTC، بدون جابه‌جایی منطقه زمانی) ذخیره شده‌اند؛ ستون متنی مجاور تاریخ شمسی HERMIPLAN را نشان می‌دهد."],
      ["نمودار Excel", "نوارها تاریخ شروع/پایان برنامه‌ریزی‌شده را نشان می‌دهند؛ درصد پیشرفت در ستون جداگانه است و به تاریخ تکمیل واقعی تبدیل نشده است."],
      ["زمان تولید تحلیل", analysis.generatedAt],
    ],
  });

  const activityHeaders = [
    "WBS",
    "شناسه فعالیت",
    "کد فعالیت",
    "عنوان فعالیت",
    "فاز",
    "مدت (روز کاری)",
    "شروع (Excel / Gregorian)",
    "شروع شمسی",
    "پایان (Excel / Gregorian)",
    "پایان شمسی",
    "پیش‌نیازها (نوع و Lag)",
    "محدودیت زمان",
    "تاریخ محدودیت (Excel / Gregorian)",
    "تاریخ محدودیت شمسی",
    "شناوری کل (روز کاری)",
    "شناوری آزاد (روز کاری)",
    "بحرانی؟",
    "نقطه‌عطف؟",
    "پیشرفت فیزیکی",
    "پیشرفت برنامه‌ای",
    `بودجه (${currency})`,
    `هزینه واقعی (${currency})`,
    `ارزش کسب‌شده (${currency})`,
    `ارزش برنامه‌ای (${currency})`,
    "تخصیص منابع (منبع × واحد)",
    "شرح تحویل",
    "یادداشت فعالیت",
    "وضعیت",
    "تأخیر (روز کاری)",
  ];
  sheets.push({
    name: "Activities",
    headers: activityHeaders,
    columns: [
      10, 18, 14, 46, 22, 15, 18, 14, 18, 14, 44, 26, 18, 16, 18, 18, 12, 12, 14, 16, 18, 18, 18, 18, 40, 48, 48, 16, 16,
    ].map((width) => ({ width })),
    rows: input.activities.map((source) => {
      const activity = activityById.get(source.id);
      return [
        activity?.wbs ?? "",
        source.id,
        source.code,
        source.name,
        source.phase,
        source.duration,
        dateCell(activity?.startDate),
        jalali(activity?.startDate),
        dateCell(activity?.finishDate),
        jalali(activity?.finishDate),
        dependencySummary(source, rawActivityById, activityByCode),
        constraintLabel(source.constraintType),
        dateCell(source.constraintDate),
        jalali(source.constraintDate),
        activity?.totalFloat ?? "",
        activity?.freeFloat ?? "",
        activity ? (activity.critical ? "بله" : "خیر") : "",
        source.milestone || source.duration === 0 ? "بله" : "خیر",
        percentCell(source.progress),
        activity ? percentCell(activity.plannedProgress) : "",
        activity ? currencyCell(activity.budgetCost) : "",
        activity ? currencyCell(activity.actualCost) : source.actualCost === undefined ? "" : currencyCell(source.actualCost),
        activity ? currencyCell(activity.earnedValue) : "",
        activity ? currencyCell(activity.plannedValue) : "",
        resourceAssignments(source, resourceById),
        source.deliverable ?? "",
        source.notes ?? "",
        activity ? ACTIVITY_STATUS_LABELS[activity.status] ?? activity.status : "زمان‌بندی محاسبه نشد",
        activity?.slipDays ?? "",
      ];
    }),
  });

  const dependencyRows: SheetCell[][] = [];
  for (const successor of input.activities) {
    for (const dependency of successor.predecessors) {
      const predecessor = dependencyReference(dependency.predecessorId, rawActivityById, activityByCode);
      const predecessorResult = predecessor ? activityById.get(predecessor.id) : undefined;
      const successorResult = activityById.get(successor.id);
      dependencyRows.push([
        dependency.predecessorId,
        predecessor?.code ?? "",
        predecessor?.name ?? "",
        predecessorResult?.wbs ?? "",
        successor.id,
        successor.code,
        successor.name,
        successorResult?.wbs ?? "",
        dependency.type,
        dependency.lag,
        predecessor ? "متصل" : "شناسه پیش‌نیاز در داده‌ها یافت نشد",
      ]);
    }
  }
  if (dependencyRows.length) {
    sheets.push({
      name: "Dependencies",
      headers: ["شناسه پیش‌نیاز ورودی", "کد پیش‌نیاز", "عنوان پیش‌نیاز", "WBS پیش‌نیاز", "شناسه فعالیت پس‌نیاز", "کد پس‌نیاز", "عنوان پس‌نیاز", "WBS پس‌نیاز", "نوع رابطه", "Lag (روز کاری)", "وضعیت ارجاع"],
      columns: [22, 14, 42, 14, 22, 14, 42, 14, 14, 16, 40].map((width) => ({ width })),
      rows: dependencyRows,
    });
  }

  if (analysis.wbs.length || input.activities.length) {
    const wbsRows: SheetCell[][] = [];
    const representedActivityIds = new Set<string>();
    const representedPhases = new Set<string>();
    for (const phase of analysis.wbs) {
      representedPhases.add(phase.name);
      wbsRows.push([
        phase.wbs,
        "فاز",
        phase.name,
        phase.duration ?? "",
        dateCell(phase.startDate),
        jalali(phase.startDate),
        dateCell(phase.finishDate),
        jalali(phase.finishDate),
        percentCell(phase.progress ?? 0),
        currencyCell(phase.budget ?? 0),
        "",
        "خلاصه محاسبه‌شده",
      ]);
      for (const activity of phase.children) {
        representedActivityIds.add(activity.id);
        const result = activityById.get(activity.id);
        wbsRows.push([
          activity.wbs,
          "فعالیت",
          activity.name,
          activity.duration ?? "",
          dateCell(activity.startDate),
          jalali(activity.startDate),
          dateCell(activity.finishDate),
          jalali(activity.finishDate),
          percentCell(activity.progress ?? 0),
          currencyCell(activity.budget ?? 0),
          result ? (result.critical ? "بله" : "خیر") : "",
          "محاسبه‌شده",
        ]);
      }
    }
    for (const phaseName of new Set(input.activities.map((activity) => activity.phase))) {
      if (!representedPhases.has(phaseName)) {
        wbsRows.push(["", "فاز", phaseName, "", "", "", "", "", "", "", "", "خلاصه محاسبه نشد"]);
      }
    }
    for (const source of input.activities) {
      if (representedActivityIds.has(source.id)) continue;
      wbsRows.push([
        "",
        "فعالیت",
        source.name,
        source.duration,
        "",
        "",
        "",
        "",
        percentCell(source.progress),
        "",
        "",
        "WBS/زمان‌بندی محاسبه نشد؛ داده ورودی در شیت فعالیت‌ها حفظ شده است",
      ]);
    }
    sheets.push({
      name: "WBS",
      headers: ["WBS", "نوع گره", "عنوان / فاز", "مدت (روز کاری)", "شروع (Excel)", "شروع شمسی", "پایان (Excel)", "پایان شمسی", "پیشرفت", `بودجه (${currency})`, "بحرانی؟", "وضعیت محاسبه"],
      columns: [12, 14, 48, 16, 16, 14, 16, 14, 14, 20, 12, 64].map((width) => ({ width })),
      rows: wbsRows,
    });
  }

  const gantt = buildGanttSheet(analysis);
  if (gantt) sheets.push(gantt);

  const milestoneStatus: Record<string, string> = { reached: "محقق‌شده", late: "در تأخیر", upcoming: "در پیش رو" };
  const calculatedMilestones = new Map(analysis.milestones.map((milestone) => [milestone.id, milestone]));
  const milestoneRows: SheetCell[][] = input.milestones.map((source) => {
    const calculated = calculatedMilestones.get(source.id);
    const linked = source.activityId ? rawActivityById.get(source.activityId) : undefined;
    const linkedResult = source.activityId ? activityById.get(source.activityId) : undefined;
    const date = calculated?.date ?? linkedResult?.finishDate ?? source.date;
    return [
      source.id,
      source.name,
      "نقطه کنترل ثبت‌شده",
      calculated?.phase ?? source.phase ?? linked?.phase ?? "",
      calculated?.linkedActivityCode ?? linked?.code ?? "",
      dateCell(date),
      jalali(date),
      calculated ? milestoneStatus[calculated.status] ?? calculated.status : "وضعیت محاسبه نشده",
    ];
  });
  for (const source of input.activities) {
    if (!source.milestone && source.duration !== 0) continue;
    if (input.milestones.some((milestone) => milestone.activityId === source.id)) continue;
    const calculated = calculatedMilestones.get(`act-${source.id}`);
    const result = activityById.get(source.id);
    const date = calculated?.date ?? result?.finishDate;
    milestoneRows.push([
      `act-${source.id}`,
      source.name,
      "نقطه‌عطف فعالیت",
      source.phase,
      source.code,
      dateCell(date),
      jalali(date),
      calculated ? milestoneStatus[calculated.status] ?? calculated.status : "زمان‌بندی محاسبه نشده",
    ]);
  }
  if (milestoneRows.length) {
    sheets.push({
      name: "Milestones",
      headers: ["شناسه نقطه کنترل", "عنوان نقطه کنترل", "منبع", "فاز", "فعالیت مرتبط", "تاریخ (Excel / Gregorian)", "تاریخ شمسی", "وضعیت"],
      columns: [22, 42, 20, 24, 18, 20, 16, 24].map((width) => ({ width })),
      rows: milestoneRows,
    });
  }

  if (analysis.resources.length) {
    sheets.push({
      name: "Resources",
      headers: ["شناسه منبع", "منبع", "نوع", "واحد", `نرخ روزانه / قیمت واحد (${currency})`, "ظرفیت", "واحد-روز تخصیص", "اوج تخصیص", "تاریخ اوج (Excel)", "تاریخ اوج شمسی", "بهره‌وری", "بیش‌تخصیص؟", `هزینه تخصیص (${currency})`, "کلید نرخ", "منبع نرخ"],
      columns: [20, 38, 20, 18, 24, 14, 18, 14, 18, 16, 14, 14, 24, 22, 38].map((width) => ({ width })),
      rows: analysis.resources.map((resource) => {
        const source = resourceById.get(resource.id);
        return [
          resource.id,
          resource.name,
          RESOURCE_TYPE_LABELS[resource.type] ?? resource.type,
          source?.unit ?? "",
          currencyCell(resource.rate),
          resource.capacity,
          resource.totalUnits,
          resource.peakUnits,
          dateCell(resource.peakDate),
          jalali(resource.peakDate),
          percentCell(resource.utilization),
          resource.overallocated ? "بله" : "خیر",
          currencyCell(resource.cost),
          source?.rateKey ?? "",
          source?.rateSource ?? "",
        ];
      }),
    });
  }

  const assignmentRows: SheetCell[][] = [];
  for (const activity of input.activities) {
    const result = activityById.get(activity.id);
    for (const assignment of activity.resources) {
      const resource = resourceById.get(assignment.resourceId);
      assignmentRows.push([
        result?.wbs ?? "",
        activity.id,
        activity.code,
        activity.name,
        assignment.resourceId,
        resource?.name ?? "منبع نامشخص",
        RESOURCE_TYPE_LABELS[resource?.type ?? ""] ?? resource?.type ?? "",
        assignment.units,
        resource?.unit ?? "",
        resource?.capacity ?? "",
        resource ? currencyCell(resource.rate) : "",
        result?.duration ?? activity.duration,
      ]);
    }
  }
  if (assignmentRows.length) {
    sheets.push({
      name: "Assignments",
      headers: ["WBS", "شناسه فعالیت", "کد فعالیت", "فعالیت", "شناسه منبع", "منبع", "نوع منبع", "واحد تخصیص در روز", "واحد", "ظرفیت منبع", `نرخ (${currency})`, "مدت فعالیت (روز کاری)"],
      columns: [12, 20, 14, 42, 20, 36, 20, 18, 18, 16, 18, 22].map((width) => ({ width })),
      rows: assignmentRows,
    });
  }

  if (analysis.costs.byPhase.length) {
    sheets.push({
      name: "Costs",
      headers: ["فاز", `بودجه (${currency})`, `هزینه واقعی (${currency})`, "پیشرفت"],
      columns: [32, 22, 22, 14].map((width) => ({ width })),
      rows: analysis.costs.byPhase.map((phase) => [
        phase.phase,
        currencyCell(phase.budget),
        currencyCell(phase.actual),
        percentCell(phase.progress),
      ]),
    });
  }

  sheets.push({
    name: "EVM",
    headers: ["شاخص", "مقدار", "واحد", "توضیح"],
    columns: [42, 24, 22, 68].map((width) => ({ width })),
    rows: [
      ["ارزش برنامه‌ای تا تاریخ وضعیت (PV)", currencyCell(analysis.costs.plannedToDate), currency, "بر اساس تاریخ وضعیت و پیشرفت برنامه‌ریزی‌شده موتور"],
      ["ارزش کسب‌شده (EV)", currencyCell(analysis.costs.earned), currency, "بودجه × درصد پیشرفت واقعی فعالیت‌ها"],
      ["هزینه واقعی (AC)", currencyCell(analysis.costs.actual), currency, "از هزینه واقعی ثبت‌شده؛ در نبود آن از منطق فعلی موتور استفاده شده است"],
      ["انحراف زمان‌بندی (SV)", currencyCell(analysis.progress.scheduleVariance), currency, "EV − PV"],
      ["انحراف هزینه (CV)", currencyCell(analysis.progress.costVariance), currency, "EV − AC"],
      ["شاخص عملکرد زمان‌بندی (SPI)", analysis.progress.schedulePerformanceIndex, "نسبت", "EV ÷ PV طبق تحلیل موتور"],
      ["شاخص عملکرد هزینه (CPI)", analysis.progress.costPerformanceIndex, "نسبت", "EV ÷ AC طبق تحلیل موتور"],
      ["پیش‌بینی هزینه در پایان (EAC)", currencyCell(analysis.costs.estimateAtCompletion), currency, "مقدار محاسبه‌شده توسط موتور تحلیل"],
      ["انحراف هزینه در پایان (VAC)", currencyCell(analysis.costs.varianceAtCompletion), currency, "بودجه − EAC طبق تحلیل موتور"],
      ["پیشرفت فیزیکی کل", percentCell(analysis.progress.overall), "%", "وزن‌دهی‌شده بر اساس مدت فعالیت‌ها"],
      ["پیشرفت برنامه‌ای تا تاریخ وضعیت", percentCell(analysis.progress.planned), "%", "بر مبنای تاریخ وضعیت"],
      ["فعالیت آغازشده", analysis.progress.started, "فعالیت", "شمار فعالیت‌های دارای پیشرفت ثبت‌شده"],
      ["فعالیت تکمیل‌شده", analysis.progress.completed, "فعالیت", "شمار فعالیت‌های با پیشرفت ۱۰۰٪"],
      ["فعالیت عقب‌مانده", analysis.progress.late, "فعالیت", "بر اساس محاسبه موتور"],
      ["روز کاری سپری‌شده تا وضعیت", analysis.progress.elapsedDays, "روز کاری", "محاسبه‌شده از تاریخ وضعیت"],
      ["روز کاری باقی‌مانده تا پایان برنامه", analysis.progress.remainingDays, "روز کاری", "محاسبه‌شده از برنامه جاری"],
    ],
  });

  if (analysis.risks.length) {
    sheets.push({
      name: "Risks",
      headers: ["شناسه", "ریسک", "دسته", "احتمال (۱–۵)", "اثر (۱–۵)", "امتیاز", "سطح", "اثر زمانی (روز کاری)", `اثر مالی (${currency})`, "راهکار کاهش", "مسئول"],
      columns: [18, 44, 22, 16, 14, 12, 16, 22, 22, 52, 28].map((width) => ({ width })),
      rows: analysis.risks.map((risk) => [
        risk.id,
        risk.title,
        risk.category,
        risk.probability,
        risk.impact,
        risk.score,
        risk.level,
        risk.scheduleImpact,
        currencyCell(risk.costImpact),
        risk.mitigation ?? "",
        risk.owner ?? "",
      ]),
    });
  }

  if (analysis.delays.length) {
    sheets.push({
      name: "Delays",
      headers: ["شناسه فعالیت", "کد", "فعالیت", "فاز", "پایان برنامه‌ای (Excel)", "پایان شمسی", "پیشرفت واقعی", "پیشرفت برنامه‌ای", "تأخیر (روز کاری)", "بحرانی؟"],
      columns: [20, 14, 44, 24, 22, 16, 16, 18, 20, 14].map((width) => ({ width })),
      rows: analysis.delays.map((delay) => [
        delay.activityId,
        delay.code,
        delay.name,
        delay.phase,
        dateCell(delay.plannedFinish),
        jalali(delay.plannedFinish),
        percentCell(delay.progress),
        percentCell(delay.plannedProgress),
        delay.slipDays,
        delay.critical ? "بله" : "خیر",
      ]),
    });
  }

  if (analysis.pricing.rates.length) {
    sheets.push({
      name: "Pricing",
      headers: ["شناسه منبع", "منبع", "کلید نرخ", "واحد", `نرخ (${currency})`, "مبنای نرخ", "سری نرخ", "منطقه", "تاریخ مرجع نرخ شمسی", "تاریخ مرجع نرخ (Excel)"],
      columns: [20, 38, 24, 18, 22, 34, 22, 18, 24, 24].map((width) => ({ width })),
      rows: analysis.pricing.rates.map((rate) => [
        rate.resourceId,
        rate.name,
        rate.key ?? "",
        rate.unit ?? "",
        currencyCell(rate.rate),
        rate.source,
        analysis.pricing.seriesLabel,
        analysis.pricing.regionLabel,
        analysis.pricing.asOfJalali,
        dateCell(analysis.pricing.asOf),
      ]),
    });
  }

  if (analysis.pricing.escalation.months.length) {
    sheets.push({
      name: "Escalation",
      headers: ["ماه / دوره", "روز کاری", `هزینه برنامه‌ای (${currency})`, "ضریب تعدیل", `هزینه تعدیل‌شده (${currency})`, `مبلغ تعدیل (${currency})`],
      columns: [24, 16, 28, 18, 30, 24].map((width) => ({ width })),
      rows: analysis.pricing.escalation.months.map((month) => [
        month.label,
        month.workingDays,
        currencyCell(month.plannedValue),
        month.factor,
        currencyCell(month.adjustedValue),
        currencyCell(month.escalation),
      ]),
    });
  }

  sheets.push({
    name: "CostSummary",
    headers: ["شرح برآورد", `مبلغ (${currency})`],
    columns: [{ width: 42 }, { width: 28 }],
    rows: [
      ["هزینه‌های مستقیم", currencyCell(analysis.pricing.breakdown.direct)],
      ["هزینه‌های بالاسری", currencyCell(analysis.pricing.breakdown.overhead)],
      ["سود پیمانکار", currencyCell(analysis.pricing.breakdown.profit)],
      ["ذخیره احتیاطی", currencyCell(analysis.pricing.breakdown.contingency)],
      ["تعدیل قیمت", currencyCell(analysis.pricing.breakdown.escalation)],
      ["جمع برآورد نهایی", currencyCell(analysis.pricing.breakdown.total)],
      ["هزینه واقعی تا تاریخ وضعیت", currencyCell(analysis.costs.actual)],
      ["پیش‌بینی هزینه در پایان (EAC)", currencyCell(analysis.costs.estimateAtCompletion)],
    ],
  });

  if (analysis.standards.length) {
    sheets.push({
      name: "Standards",
      headers: ["کد", "عنوان مرجع", "دامنه", "شرح / مبنا"],
      columns: [24, 44, 18, 96].map((width) => ({ width })),
      rows: analysis.standards.map((standard) => [
        standard.code,
        standard.title,
        standard.scope === "national" ? "ملی" : "بین‌المللی",
        standard.body,
      ]),
    });
  }

  if (input.baseline?.activities.length) {
    sheets.push({
      name: "Baseline",
      headers: ["شناسه فعالیت", "کد", "فعالیت", "شروع مبنا (Excel)", "شروع مبنا شمسی", "شروع جاری (Excel)", "شروع جاری شمسی", "پایان مبنا (Excel)", "پایان مبنا شمسی", "پایان جاری (Excel)", "پایان جاری شمسی", "انحراف پایان (روز تقویمی)", `بودجه مبنا (${currency})`, `بودجه جاری (${currency})`, "وضعیت"],
      columns: [22, 14, 40, 20, 16, 20, 16, 20, 16, 20, 16, 24, 24, 24, 26].map((width) => ({ width })),
      rows: input.baseline.activities.map((baselineActivity) => {
        const current = activityById.get(baselineActivity.activityId);
        const raw = rawActivityById.get(baselineActivity.activityId);
        const varianceDays = current
          ? calendarDayDifference(baselineActivity.finishDate, current.finishDate)
          : "";
        const changed = current && (varianceDays !== 0 || baselineActivity.cost !== current.budgetCost);
        return [
          baselineActivity.activityId,
          current?.code ?? raw?.code ?? "",
          current?.name ?? raw?.name ?? "",
          dateCell(baselineActivity.startDate),
          jalali(baselineActivity.startDate),
          dateCell(current?.startDate),
          jalali(current?.startDate),
          dateCell(baselineActivity.finishDate),
          jalali(baselineActivity.finishDate),
          dateCell(current?.finishDate),
          jalali(current?.finishDate),
          current ? varianceDays : "",
          currencyCell(baselineActivity.cost),
          current ? currencyCell(current.budgetCost) : "",
          current ? (changed ? "دارای تغییر" : "بدون تغییر ثبت‌شده") : "فعالیت در برنامه جاری یافت نشد",
        ];
      }),
    });
  }

  const workDays = new Set(input.calendar.workDays);
  const calendarRows: SheetCell[][] = [];
  for (let day = 0; day < 7; day += 1) {
    calendarRows.push([
      "روز هفته",
      DAY_NAMES_FA[day],
      "",
      "",
      workDays.has(day) ? "روز کاری" : "غیرکاری",
    ]);
  }
  calendarRows.push(["ساعت کاری در روز", input.calendar.hoursPerDay, "", "", "طبق تقویم پروژه"]);
  calendarRows.push(["تعداد تعطیلات ثبت‌شده", input.calendar.holidays.length, "", "", "تاریخ‌ها به شکل ISO وارد مدل شده‌اند"]);
  calendarRows.push(["تاریخ شروع ورودی", "", dateCell(input.meta.startDate), jalali(input.meta.startDate), "تاریخ واردشده توسط کاربر"]);
  calendarRows.push(["شروع محاسبه‌شده", "", dateCell(analysis.schedule.startDate), jalali(analysis.schedule.startDate), "پس از هم‌ترازی با تقویم کاری"]);
  calendarRows.push(["تاریخ وضعیت", "", dateCell(input.meta.statusDate), jalali(input.meta.statusDate), "مبنای پایش و EVM"]);
  if (input.meta.deadline) {
    calendarRows.push(["تاریخ هدف قراردادی", "", dateCell(input.meta.deadline), jalali(input.meta.deadline), "تاریخ هدف ثبت‌شده در ورودی"]);
  }
  for (const holiday of input.calendar.holidays) {
    calendarRows.push(["تعطیل", "", dateCell(holiday), jalali(holiday), "تعطیلی ثبت‌شده در تقویم"]);
  }
  sheets.push({
    name: "Calendar",
    headers: ["نوع مشخصه", "مقدار", "تاریخ (Excel / Gregorian)", "تاریخ شمسی", "جزئیات"],
    columns: [26, 24, 24, 18, 48].map((width) => ({ width })),
    rows: calendarRows,
  });

  if (analysis.errors.length || analysis.warnings.length) {
    sheets.push({
      name: "Checks",
      headers: ["شدت", "پیام موتور تحلیل"],
      columns: [{ width: 20 }, { width: 100 }],
      rows: [
        ...analysis.errors.map((message) => ["خطا", message] as SheetCell[]),
        ...analysis.warnings.map((message) => ["هشدار", message] as SheetCell[]),
      ],
    });
  }

  return sheets;
}

/** Spreadsheet formula protection for untrusted text; real numbers stay numeric. */
function csvSafe(value: string | number): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value ?? "");
  // Spreadsheet apps may ignore leading whitespace/control characters before
  // a formula prefix. Numeric cells are returned above, so a text minus sign
  // remains protected without changing legitimate negative numeric cells.
  return /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function cellValue(cell: SheetCell): string | number {
  if (cell === null) return "";
  if (typeof cell !== "object") return typeof cell === "number" && !Number.isFinite(cell) ? "" : cell;
  return cell.value;
}

export function buildCsv(sheet: Sheet): string {
  const lines = [sheet.headers.map((header) => csvSafe(header)).join(",")];
  for (const row of sheet.rows) {
    const values = sheet.headers.map((_, index) => {
      const value = csvSafe(cellValue(row[index] ?? ""));
      return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    });
    lines.push(values.join(","));
  }
  // UTF-8 BOM + CRLF is intentional for Excel/Windows while preserving all
  // Unicode text and the conventional CSV record separator.
  return `\uFEFF${lines.join("\r\n")}`;
}
