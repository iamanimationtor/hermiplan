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

/**
 * Behaviour of each supported date constraint (single source of truth for the
 * engine, the UI and docs/ENGINE.md):
 *
 *   ASAP  no restriction — the activity is scheduled as early as its logic allows
 *   SNET  Start No Earlier Than  → ES = max(logic, date)
 *   MSO   Must Start On          → ES = date exactly; LS is pinned too, so the
 *                                  activity owns no float and predecessors must
 *                                  finish before the forced start. A link that
 *                                  would push the start later is a conflict and
 *                                  is reported as an error, never hidden.
 *   FNLT  Finish No Later Than   → LF = min(logic, date). The constraint is
 *                                  enforced in the backward pass; violated
 *                                  constraints surface as negative total float
 *                                  plus an explicit `fnlt-violated` diagnostic.
 */
export type DiagnosticKind =
  | "data"
  | "cycle"
  | "dependency"
  | "constraint"
  | "calendar"
  | "capacity";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  /** stable machine-readable code (tests and UI rely on it) */
  code: string;
  message: string;
  activityIds?: string[];
  /** actionable fix, in Persian; filled from `DIAGNOSTIC_REMEDIES` */
  remedy?: string;
}

/**
 * Overall verdict of an analysis. The UI must show these states distinctly
 * instead of a single "success" badge.
 */
export type AnalysisStatus =
  | "valid" //               everything computed, no errors
  | "warning" //             computed, engineering warnings present
  | "inconsistent" //        logic and constraints cannot both hold (negative float)
  | "invalid" //             network unusable (cycle, unknown predecessor, …)
  | "internal-error"; //     the engine itself failed (never a silent zero)

export interface ActivityConstraintResult {
  type: ConstraintType;
  /** ISO date typed by the user */
  date?: string;
  /** working-day offset of the constraint after workday alignment */
  offset?: number;
  /** true when the constraint actually changed a computed date */
  applied: boolean;
  /** reason the constraint cannot be honoured */
  conflict?: string;
}

export interface UnschedulableActivity {
  id: string;
  code: string;
  name: string;
  reason: string;
}

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
  /** actual cost incurred so far (optional; when absent CPI/EAC are unknown) */
  actualCost?: number;
  /** measured work (optional) — enables quantity-based physical progress */
  quantity?: ActivityQuantity;
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

/**
 * Measured work for quantity-based (physical) progress.
 * `planned` and `actual` must share the same unit; mixing units is rejected
 * rather than silently compared.
 */
export interface ActivityQuantity {
  /** unit of measure: مترمکعب، کیلوگرم، مترمربع، متر طول، عدد … */
  unit: string;
  planned: number;
  /** quantity recorded by the site (not yet approved) */
  actual: number;
  /** quantity approved by an authorised role (subset of actual) */
  approved?: number;
}

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
  /**
   * «سناریوی افزایش هزینه» — compounded monthly cost increase from the status
   * month onward. NOT a contractual adjustment; see docs/ENGINE.md §۱۱.
   */
  escalation: {
    months: EscalationMonth[];
    total: number;
    baseValue: number;
    scenario?: boolean;
    statusMonth?: string;
    note?: string;
  };
  breakdown: CostBreakdown;
  /**
   * `rate` is the rate **actually applied** to the project resource.
   * `catalogRate` is the reference value from the dated catalogue (what the
   * "apply market rates" action would write). They must never be confused.
   */
  rates: {
    resourceId: string;
    name: string;
    key?: string;
    unit?: string;
    rate: number;
    catalogRate?: number;
    source: string;
    verified: boolean;
    provenance?: {
      kind: string;
      verification: string;
      source: string;
      sourceRef: string | null;
      sourceUrl: string | null;
      asOfIso: string;
      lastUpdatedIso: string;
      validUntilIso: string | null;
      region: string;
      currency: string;
      note: string;
    };
  }[];
  /** provenance policy of the underlying catalogue (honesty contract) */
  ratePolicy?: { verification: string; note: string; asOfJalali: string; asOfIso: string };
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
  /** date constraint applied to this activity and whether it could be honoured */
  constraint: ActivityConstraintResult;
  /** duration-weighted progress measured at the status date (time-based, not physical) */
  timeProgress: number;
  /** quantity-based progress when measured quantities exist, otherwise null */
  physicalProgress: number | null;
  /** physical progress detail for auditing */
  quantity?: {
    unit: string;
    planned: number;
    actual: number;
    approved: number;
    /** actual / planned — may exceed 1 when more work was executed than planned */
    ratio: number;
    overrun: boolean;
    status: "no-data" | "normal" | "over" | "invalid";
    note?: string;
  };
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
  /** ISO date, or "" when the milestone has neither a date nor a linked activity */
  date: string;
  status: "reached" | "upcoming" | "late" | "unscheduled";
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

/**
 * Progress is deliberately split into distinct concepts:
 *  • timeBased   — duration-weighted progress of the schedule (a schedule KPI)
 *  • physical    — measured quantity progress (Actual / Planned), null when no
 *                  measured quantities were entered
 *  • financial   — EVM progress (EV/BAC), see the `evm` block
 */
export interface ProgressResult {
  /** duration-weighted progress — historical field name kept for the report */
  overall: number;
  timeBased: number;
  /** quantity-based physical progress; null when not measured */
  physical: number | null;
  physicalCoverage: number;
  /** EV ÷ BAC — financial progress; null when the budget is zero */
  financial: number | null;
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

/**
 * Earned value metrics with explicit definitions and explicit "unknown" states.
 * A metric is `null` when its inputs do not exist (e.g. CPI without actual
 * cost) — never 0, never Infinity, never NaN.
 */
export interface EvmResult {
  /** Planned Value up to the status date (EV = BAC × progress, PV = BAC × planned) */
  pv: number;
  ev: number;
  /** null when no activity reported actual cost */
  ac: number | null;
  sv: number;
  cv: number | null;
  /** EV / PV, null when PV = 0 */
  spi: number | null;
  /** EV / AC, null when AC is null or 0 */
  cpi: number | null;
  bac: number;
  /** EAC = BAC / CPI (documented method; null when CPI is unknown) */
  eac: number | null;
  /** ETC = EAC − AC */
  etc: number | null;
  /** VAC = BAC − EAC */
  vac: number | null;
  eacMethod: "bac-cpi";
  /** share of BAC that carries a recorded actual cost (0..100) */
  costDataCoverage: number;
  notes: string[];
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

/**
 * Baseline variance per activity. Start and finish deviations are reported
 * independently: a two-day start shift with an unchanged duration is a two-day
 * delay, and must not cancel out against the finish deviation.
 *
 * Basis: working days of the **current project calendar**; positive = later than
 * the baseline.
 */
export interface BaselineVarianceRow {
  activityId: string;
  code: string;
  name: string;
  baselineStart: string;
  currentStart: string;
  baselineFinish: string;
  currentFinish: string;
  /** current start − baseline start (working days) */
  startVarianceDays: number;
  /** current finish − baseline finish (working days) */
  finishVarianceDays: number;
  /** current duration − baseline duration (working days) */
  durationChange: number;
  /** current finish − baseline finish for incomplete work (forecast date) */
  completionVarianceDays: number;
  status: "earlier" | "on-plan" | "later" | "unknown";
  /** kept for backwards compatibility: equals `finishVarianceDays` */
  varianceDays: number;
  baselineCost: number;
  currentCost: number;
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
  /** structured, machine-readable diagnostics (the strings above are derived) */
  diagnostics: Diagnostic[];
  status: AnalysisStatus;
  /** activities that could not be scheduled at all (dependency cycles) */
  unschedulable: UnschedulableActivity[];
  schedule: {
    status: AnalysisStatus;
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
    /** natural finish (ignoring a deadline) in working days */
    naturalWorkingDays: number;
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
  evm: EvmResult;
  progress: ProgressResult;
  risks: RiskResult[];
  riskExposure: number;
  delays: DelayResult[];
  baseline: {
    available: boolean;
    name?: string;
    scheduleVarianceDays: number;
    costVariance: number;
    changedActivities: BaselineVarianceRow[];
    /** maximum finish slip over the baseline, in working days */
    maxFinishSlipDays: number;
    maxStartSlipDays: number;
  };
  gantt: GanttModel;
  kpis: KpiResult[];
  pricing: PricingResult;
  standards: StandardsBasis[];
  health: { score: number; status: Status; signals: HealthSignal[] };
  summary: { headline: string; bullets: string[] };
}
