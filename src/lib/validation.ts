import { z } from "zod";
import { isIsoDate } from "./engine/calendar";
import type { ProjectInput } from "./engine/types";

const today = () => new Date().toISOString().slice(0, 10);

/** absent/invalid dates resolve to today, so partial payloads stay analysable */
const dateLike = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && isIsoDate(value) ? value : today()));

const dependency = z.object({
  predecessorId: z.string().min(1).max(64),
  type: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
  lag: z.coerce.number().min(-365).max(365).default(0),
});

const activityResource = z.object({
  resourceId: z.string().min(1).max(64),
  units: z.coerce.number().min(0).max(10_000).default(1),
});

const activity = z.object({
  id: z.string().min(1).max(64),
  code: z.string().max(32).default(""),
  name: z.string().min(1).max(200),
  phase: z.string().min(1).max(120).default("فاز ۱"),
  duration: z.coerce.number().min(0).max(3650).default(1),
  predecessors: z.array(dependency).max(40).default([]),
  progress: z.coerce.number().min(0).max(100).default(0),
  resources: z.array(activityResource).max(30).default([]),
  fixedCost: z.coerce.number().min(0).default(0),
  materialCost: z.coerce.number().min(0).default(0),
  actualCost: z.coerce.number().min(0).optional(),
  constraintType: z.enum(["ASAP", "SNET", "MSO", "FNLT"]).default("ASAP"),
  constraintDate: z.string().optional(),
  milestone: z.boolean().default(false),
  deliverable: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  riskProbability: z.coerce.number().min(0).max(5).optional(),
  riskImpact: z.coerce.number().min(0).max(5).optional(),
});

const resource = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  type: z.enum(["labor", "equipment", "material", "cost"]).default("labor"),
  rate: z.coerce.number().min(0).default(0),
  capacity: z.coerce.number().min(0).max(10_000).default(1),
  rateKey: z.string().max(64).optional(),
  unit: z.string().max(64).optional(),
  rateSource: z.string().max(160).optional(),
});

const pricing = z
  .object({
    series: z.enum(["official-1405", "official-1404", "market"]).default("official-1405"),
    region: z.enum(["tehran", "metro", "other"]).default("tehran"),
    indexFactor: z.coerce.number().min(10).max(1000).default(100),
    escalationEnabled: z.boolean().default(true),
    escalationRatePerMonth: z.coerce.number().min(0).max(30).default(3),
    overheadPercent: z.coerce.number().min(0).max(200).default(17),
    profitPercent: z.coerce.number().min(0).max(200).default(10),
    contingencyPercent: z.coerce.number().min(0).max(200).default(5),
    appliedAt: z.string().optional(),
  })
  .nullish();

const milestone = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  date: z.string().optional(),
  activityId: z.string().optional(),
  phase: z.string().max(120).optional(),
});

const risk = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  category: z.string().max(80).default("عمومی"),
  probability: z.coerce.number().min(1).max(5).default(3),
  impact: z.coerce.number().min(1).max(5).default(3),
  scheduleImpact: z.coerce.number().min(0).max(3650).default(0),
  costImpact: z.coerce.number().min(0).default(0),
  mitigation: z.string().max(600).optional(),
  owner: z.string().max(120).optional(),
});

const baseline = z
  .object({
    name: z.string().max(120).default("Baseline"),
    createdAt: z.string().optional(),
    activities: z
      .array(
        z.object({
          activityId: z.string(),
          startDate: z.string(),
          finishDate: z.string(),
          duration: z.coerce.number().default(0),
          cost: z.coerce.number().default(0),
        }),
      )
      .max(2000)
      .default([]),
  })
  .nullish();

export const projectInputSchema = z.object({
  meta: z.object({
    name: z.string().min(1).max(200).default("پروژه بدون نام"),
    code: z.string().max(60).optional(),
    type: z
      .enum([
        "construction",
        "civil",
        "architecture",
        "infrastructure",
        "software",
        "manufacturing",
        "research",
        "event",
        "renovation",
        "general",
      ])
      .default("general"),
    client: z.string().max(160).optional(),
    contractor: z.string().max(160).optional(),
    consultant: z.string().max(160).optional(),
    location: z.string().max(160).optional(),
    manager: z.string().max(160).optional(),
    description: z.string().max(2000).optional(),
    currency: z.enum(["IRR", "USD", "EUR"]).default("IRR"),
    budget: z.coerce.number().min(0).optional(),
    startDate: dateLike,
    statusDate: dateLike,
    deadline: z.string().optional(),
  }).prefault(() => ({})),
  calendar: z.object({
    workDays: z
      .array(z.coerce.number().min(0).max(6))
      .min(1, "حداقل یک روز کاری در هفته لازم است")
      .default([6, 0, 1, 2, 3]),
    holidays: z.array(z.string()).default([]),
    hoursPerDay: z.coerce.number().min(1).max(24).default(8),
  }).prefault(() => ({})),
  activities: z.array(activity).max(1000).default([]),
  resources: z.array(resource).max(200).default([]),
  milestones: z.array(milestone).max(200).default([]),
  risks: z.array(risk).max(200).default([]),
  baseline,
  pricing,
});

export type ReportOptions = {
  sections: string[];
  includeNotes: boolean;
  includeGanttDependencyArrows: boolean;
  ganttScale: "day" | "week" | "month";
  theme: "light" | "print";
  author?: string;
};

export const REPORT_SECTIONS: { key: string; label: string; description: string; group: string }[] = [
  { key: "cover", label: "صفحه جلد گزارش", description: "عنوان پروژه، کارفرما، پیمانکار و تاریخ گزارش", group: "عمومی" },
  { key: "executive", label: "خلاصه مدیریتی", description: "جمع‌بندی خودکار وضعیت پروژه برای مدیران", group: "عمومی" },
  { key: "info", label: "مشخصات پروژه", description: "اطلاعات پایه، تقویم و طرف‌های قرارداد", group: "عمومی" },
  { key: "kpis", label: "شاخص‌های کلیدی (KPI)", description: "SPI، CPI، پیشرفت، مسیر بحرانی و …", group: "عمومی" },
  { key: "wbs", label: "ساختار شکست کار (WBS)", description: "سلسله‌مراتب فازها و فعالیت‌ها", group: "برنامه‌ریزی" },
  { key: "activities", label: "فهرست فعالیت‌ها", description: "کد، مسئول، مدت، تاریخ شروع و پایان", group: "برنامه‌ریزی" },
  { key: "schedule", label: "زمان‌بندی و شناوری", description: "تاریخ‌های زودترین/دیرترین و Float", group: "برنامه‌ریزی" },
  { key: "gantt", label: "نمودار گانت", description: "نمودار میله‌ای زمان‌بندی با مسیر بحرانی", group: "برنامه‌ریزی" },
  { key: "critical", label: "مسیر بحرانی", description: "فعالیت‌های بحرانی و زنجیره وابستگی", group: "برنامه‌ریزی" },
  { key: "milestones", label: "نقاط کنترل (Milestone)", description: "تاریخ‌های کلیدی و وضعیت هر نقطه", group: "برنامه‌ریزی" },
  { key: "progress", label: "پیشرفت و تحلیل ارزش کسب‌شده", description: "PV، EV، AC و شاخص‌های عملکرد", group: "پایش" },
  { key: "resources", label: "منابع و تخصیص", description: "بار کاری، ظرفیت و بهره‌وری منابع", group: "پایش" },
  { key: "costs", label: "هزینه‌ها", description: "بودجه، هزینه واقعی و پیش‌بینی تا پایان", group: "پایش" },
  { key: "risks", label: "ریسک‌ها", description: "ماتریس احتمال–اثر و اقدامات کاهش", group: "پایش" },
  { key: "delays", label: "تأخیرها", description: "فعالیت‌های عقب‌مانده و میزان تأخیر", group: "پایش" },
  { key: "baseline", label: "مقایسه با Baseline", description: "انحراف زمان‌بندی و هزینه از مبنا", group: "پایش" },
  { key: "status", label: "وضعیت و سلامت پروژه", description: "سیگنال‌های هشدار و امتیاز سلامت", group: "پایش" },
  { key: "pricing", label: "قیمت‌گذاری بازار و تعدیل", description: "مبنای نرخ، فهرست نرخ ایران و تعدیل ماهانه", group: "پایش" },
  { key: "standards", label: "مبنای استانداردها و متدها", description: "استانداردهای ملی و بین‌المللی و روش‌های محاسباتی", group: "عمومی" },
  { key: "network", label: "نمودار شبکه‌ای", description: "گراف وابستگی فعالیت‌ها", group: "برنامه‌ریزی" },
  { key: "signature", label: "صفحه امضا و تأیید", description: "جدول امضای تهیه‌کننده، بازرس و کارفرما", group: "عمومی" },
];

export const DEFAULT_REPORT_SECTIONS = [
  "cover",
  "executive",
  "info",
  "kpis",
  "wbs",
  "activities",
  "schedule",
  "gantt",
  "critical",
  "milestones",
  "progress",
  "resources",
  "costs",
  "risks",
  "delays",
  "baseline",
  "status",
  "pricing",
  "signature",
];

export const reportOptionsSchema = z.object({
  sections: z.array(z.string()).default(DEFAULT_REPORT_SECTIONS),
  includeNotes: z.boolean().default(true),
  includeGanttDependencyArrows: z.boolean().default(true),
  ganttScale: z.enum(["day", "week", "month"]).default("day"),
  theme: z.enum(["light", "print"]).default("print"),
  author: z.string().max(120).optional(),
});

export const EXPORT_FORMATS = [
  {
    id: "pdf",
    label: "گزارش HTML (چاپ / PDF)",
    ext: "html",
    hint: "گزارش کامل A4 — در مرورگر باز کنید و Ctrl+P → Save as PDF",
  },
  { id: "xlsx", label: "Excel (xlsx)", ext: "xlsx", hint: "کارپوشه چندشییتی با فرمت استاندارد Office" },
  { id: "xls", label: "Excel 2003 (xls)", ext: "xls", hint: "سازگار با نسخه‌های قدیمی Excel" },
  { id: "csv", label: "CSV", ext: "csv", hint: "داده جدولی با پشتیبانی کامل فارسی" },
  { id: "json", label: "JSON", ext: "json", hint: "داده کامل پروژه برای تبادل سیستم‌به‌سیستم" },
  { id: "msproject", label: "MS Project (XML)", ext: "xml", hint: "قابل بازکردن در MS Project و Primavera" },
  { id: "package", label: "بسته کامل (ZIP)", ext: "zip", hint: "همه فرمت‌ها به همراه فهرست تحویل" },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];

export type ParsedProjectInput = ProjectInput;
export function parseProjectInput(raw: unknown): ProjectInput {
  return projectInputSchema.parse(raw) as ProjectInput;
}
