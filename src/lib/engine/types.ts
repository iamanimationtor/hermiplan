/**
 * HERMIPLAN — Project Engine domain types.
 *
 * These types are intentionally framework-agnostic: the engine must stay
 * deterministic, testable and independent from any UI framework.
 */

export type ProjectType =
  | "construction"
  | "civil"
  | "architecture"
  | "infrastructure"
  | "software"
  | "manufacturing"
  | "research"
  | "event"
  | "renovation"
  | "general";

export type Currency = "IRR" | "USD" | "EUR";

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface Dependency {
  /** id of the predecessor activity */
  predecessorId: string;
  type: DependencyType;
  /** lag in working days (can be negative for lead) */
  lag: number;
}

export type ConstraintType = "ASAP" | "SNET" | "MSO" | "FNLT";

export interface ActivityResource {
  resourceId: string;
  /** units assigned per working day (e.g. 4 masons) */
  units: number;
}

export interface ActivityInput {
  id: string;
  code: string;
  name: string;
  phase: string;
  /** duration in working days (0 => milestone) */
  duration: number;
  predecessors: Dependency[];
  /** 0..100 physical percent complete */
  progress: number;
  resources: ActivityResource[];
  fixedCost: number;
  materialCost: number;
  /** actual cost incurred so far (optional; falls back to earned value) */
  actualCost?: number;
  constraintType: ConstraintType;
  constraintDate?: string;
  milestone: boolean;
  deliverable?: string;
  notes?: string;
  /** 1..5 qualitative risk inputs */
  riskProbability?: number;
  riskImpact?: number;
}

export type ResourceType = "labor" | "equipment" | "material" | "cost";

export interface ResourceInput {
  id: string;
  name: string;
  type: ResourceType;
  /** cost per unit per working day (for materials: unit price) */
  rate: number;
  /** maximum available units per working day */
  capacity: number;
  /** key of the market rate catalog entry */
  rateKey?: string;
  /** unit label, e.g. روز-کارگر / کیلوگرم / مترمکعب */
  unit?: string;
  /** source label of the last applied market rate */
  rateSource?: string;
}

export type RateSeries = "official-1405" | "official-1404" | "market";
export type RateRegion = "tehran" | "metro" | "other";

/** Pricing & escalation context (مبنای قیمت‌گذاری و تعدیل) */
export interface ProjectPricing {
  series: RateSeries;
  region: RateRegion;
  /** ضریب تعدیل عمومی کاربر (۱۰۰ = بدون تغییر) */
  indexFactor: number;
  /** فعال‌سازی تعدیل / Escalation بر پایه کارکرد ماهانه */
  escalationEnabled: boolean;
  /** نرخ تعدیل ماهانه (درصد) */
  escalationRatePerMonth: number;
  /** درصد هزینه‌های بالاسری (Overhead) */
  overheadPercent: number;
  /** درصد سود پیمانکار */
  profitPercent: number;
  /** درصد ذخیره احتیاطی (Contingency) */
  contingencyPercent: number;
  /** تاریخ اعمال نرخ بازار */
  appliedAt?: string;
}

export interface EscalationMonth {
  key: string;
  label: string;
  workingDays: number;
  plannedValue: number;
  factor: number;
  adjustedValue: number;
  escalation: number;
}

export interface CostBreakdown {
  direct: number;
  overhead: number;
  profit: number;
  contingency: number;
  escalation: number;
  total: number;
}

export interface PricingResult {
  series: RateSeries;
  seriesLabel: string;
  region: RateRegion;
  regionLabel: string;
  indexFactor: number;
  asOf: string;
  asOfJalali: string;
  sources: string[];
  escalationEnabled: boolean;
  escalationRatePerMonth: number;
  escalation: { months: EscalationMonth[]; total: number; baseValue: number };
  breakdown: CostBreakdown;
  rates: { resourceId: string; name: string; key?: string; unit?: string; rate: number; source: string }[];
}

export interface StandardsBasis {
  code: string;
  title: string;
  body: string;
  scope: "national" | "international";
}

export interface MilestoneInput {
  id: string;
  name: string;
  /** ISO date (yyyy-mm-dd) when manually scheduled */
  date?: string;
  /** when linked, the milestone inherits the activity finish date */
  activityId?: string;
  phase?: string;
}

export interface RiskInput {
  id: string;
  title: string;
  category: string;
  /** 1..5 */
  probability: number;
  /** 1..5 */
  impact: number;
  /** schedule impact in working days if it happens */
  scheduleImpact: number;
  /** cost impact if it happens */
  costImpact: number;
  mitigation?: string;
  owner?: string;
}

export interface BaselineActivity {
  activityId: string;
  startDate: string;
  finishDate: string;
  duration: number;
  cost: number;
}

export interface ProjectBaseline {
  name: string;
  createdAt: string;
  activities: BaselineActivity[];
}

export interface WorkCalendar {
  /** working weekdays, 0 = Sunday … 6 = Saturday */
  workDays: number[];
  /** holiday dates (yyyy-mm-dd) excluded from working days */
  holidays: string[];
  hoursPerDay: number;
}

export interface ProjectMeta {
  name: string;
  code?: string;
  type: ProjectType;
  client?: string;
  contractor?: string;
  consultant?: string;
  location?: string;
  manager?: string;
  description?: string;
  currency: Currency;
  /** approved budget (optional) */
  budget?: number;
  startDate: string;
  /** ISO date used for progress / earned value calculations */
  /** optional contractual finish date (yyyy-mm-dd) */
  deadline?: string;
  statusDate: string;
}

export interface ProjectInput {
  meta: ProjectMeta;
  calendar: WorkCalendar;
  activities: ActivityInput[];
  resources: ResourceInput[];
  milestones: MilestoneInput[];
  risks: RiskInput[];
  baseline?: ProjectBaseline | null;
  pricing?: ProjectPricing;
}

/* ------------------------------------------------------------------ */
/* Analysis results                                                    */
/* ------------------------------------------------------------------ */

export type Status = "good" | "watch" | "critical";

export interface ActivityResult {
  id: string;
  code: string;
  name: string;
  phase: string;
  wbs: string;
  duration: number;
  /** earliest start / exclusive end, in working-day offsets from project start */
  es: number;
  ee: number;
  ls: number;
  le: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  startDate: string;
  finishDate: string;
  lateStartDate: string;
  lateFinishDate: string;
  progress: number;
  plannedProgress: number;
  budgetCost: number;
  actualCost: number;
  earnedValue: number;
  plannedValue: number;
  resourceNames: string[];
  milestone: boolean;
  status: "not-started" | "in-progress" | "completed" | "late";
  slipDays: number;
  riskScore: number;
  level: number;
  successors: string[];
}

export interface PhaseResult {
  name: string;
  wbs: string;
  duration: number;
  startDate: string;
  finishDate: string;
  progress: number;
  budget: number;
  actual: number;
  activityCount: number;
  critical: boolean;
}

export interface WbsNode {
  id: string;
  wbs: string;
  name: string;
  kind: "project" | "phase" | "activity";
  level: number;
  duration?: number;
  startDate?: string;
  finishDate?: string;
  progress?: number;
  budget?: number;
  children: WbsNode[];
}

export interface MilestoneResult {
  id: string;
  name: string;
  phase: string;
  date: string;
  status: "reached" | "upcoming" | "late";
  linkedActivityCode?: string;
}

export interface DailyDemand {
  offset: number;
  date: string;
  units: number;
}

export interface ResourceResult {
  id: string;
  name: string;
  type: ResourceType;
  rate: number;
  capacity: number;
  totalUnits: number;
  peakUnits: number;
  peakDate: string;
  overallocated: boolean;
  utilization: number;
  cost: number;
  demand: DailyDemand[];
}

export interface CostResult {
  currency: Currency;
  budget: number;
  plannedToDate: number;
  earned: number;
  actual: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
  byPhase: { phase: string; budget: number; actual: number; progress: number }[];
}

export interface ProgressResult {
  overall: number;
  planned: number;
  scheduleVariance: number;
  costVariance: number;
  schedulePerformanceIndex: number;
  costPerformanceIndex: number;
  started: number;
  completed: number;
  notStarted: number;
  late: number;
  remainingDays: number;
  elapsedDays: number;
}

export interface RiskResult {
  id: string;
  title: string;
  category: string;
  probability: number;
  impact: number;
  score: number;
  level: "low" | "medium" | "high" | "critical";
  scheduleImpact: number;
  costImpact: number;
  mitigation?: string;
  owner?: string;
}

export interface DelayResult {
  activityId: string;
  code: string;
  name: string;
  phase: string;
  plannedFinish: string;
  progress: number;
  plannedProgress: number;
  slipDays: number;
  critical: boolean;
}

export interface KpiResult {
  key: string;
  label: string;
  value: string;
  hint: string;
  status: Status;
}

export interface GanttRow {
  id: string;
  code: string;
  name: string;
  wbs: string;
  kind: "phase" | "activity" | "milestone";
  level: number;
  startOffset: number;
  endOffset: number;
  progress: number;
  critical: boolean;
}

export interface GanttModel {
  rows: GanttRow[];
  totalOffsets: number;
  dates: string[];
  criticalPath: string[];
}

export interface HealthSignal {
  label: string;
  status: Status;
  detail: string;
}

export interface ProjectAnalysis {
  generatedAt: string;
  errors: string[];
  warnings: string[];
  schedule: {
    startDate: string;
    finishDate: string;
    workingDays: number;
    calendarDays: number;
    hoursPerDay: number;
    workDayCount: number;
    holidayCount: number;
    deadline?: string;
    deadlineMet: boolean | null;
    deadlineVarianceDays: number | null;
    phases: PhaseResult[];
  };
  activities: ActivityResult[];
  wbs: WbsNode[];
  criticalPath: { id: string; code: string; name: string }[];
  criticalPathRatio: number;
  milestones: MilestoneResult[];
  resources: ResourceResult[];
  overallocatedResources: number;
  costs: CostResult;
  progress: ProgressResult;
  risks: RiskResult[];
  riskExposure: number;
  delays: DelayResult[];
  baseline: {
    available: boolean;
    name?: string;
    scheduleVarianceDays: number;
    costVariance: number;
    changedActivities: {
      code: string;
      name: string;
      baselineStart: string;
      currentStart: string;
      baselineFinish: string;
      currentFinish: string;
      varianceDays: number;
      baselineCost: number;
      currentCost: number;
    }[];
  };
  gantt: GanttModel;
  kpis: KpiResult[];
  pricing: PricingResult;
  standards: StandardsBasis[];
  health: { score: number; status: Status; signals: HealthSignal[] };
  summary: { headline: string; bullets: string[] };
}
