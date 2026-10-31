import { toJalali, JALALI_MONTHS } from "@/lib/date-fa";
import { isIsoDate } from "@/lib/engine/calendar";
import type {
  EscalationMonth,
  PricingResult,
  ProjectInput,
  ProjectPricing,
  ResourceInput,
} from "@/lib/engine/types";

/** Minimal analysis shape needed for pricing (keeps the engine decoupled). */
export interface PricingAnalysis {
  costs: { budget: number };
  gantt: { dates: string[] };
  activities: { es: number; ee: number; budgetCost: number }[];
}
import {
  MARKET_AS_OF,
  RATE_CATALOG,
  RATE_DATA_POLICY,
  REGION_FACTORS,
  SERIES_LABELS,
  findRate,
  guessRateKey,
  rateProvenance,
  resolveRate,
} from "./rates";

export const DEFAULT_PRICING: ProjectPricing = {
  series: "official-1405",
  region: "tehran",
  indexFactor: 100,
  escalationEnabled: true,
  escalationRatePerMonth: 3,
  overheadPercent: 17,
  profitPercent: 10,
  contingencyPercent: 5,
};

export function normalizePricing(raw?: Partial<ProjectPricing> | null): ProjectPricing {
  const clampPercent = (value: number | undefined, fallback: number, max = 200) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : fallback;
  const has = (key: keyof ProjectPricing) => Boolean(raw && key in raw && raw[key] !== undefined);
  return {
    series:
      raw?.series === "official-1404" || raw?.series === "market" || raw?.series === "official-1405"
        ? raw.series
        : DEFAULT_PRICING.series,
    region: raw?.region && raw.region in REGION_FACTORS ? raw.region : DEFAULT_PRICING.region,
    indexFactor:
      typeof raw?.indexFactor === "number" && raw.indexFactor > 0
        ? Math.min(Math.max(raw.indexFactor, 10), 1000)
        : DEFAULT_PRICING.indexFactor,
    escalationEnabled: has("escalationEnabled")
      ? Boolean(raw?.escalationEnabled)
      : DEFAULT_PRICING.escalationEnabled,
    escalationRatePerMonth: clampPercent(raw?.escalationRatePerMonth, DEFAULT_PRICING.escalationRatePerMonth, 30),
    overheadPercent: clampPercent(raw?.overheadPercent, DEFAULT_PRICING.overheadPercent),
    profitPercent: clampPercent(raw?.profitPercent, DEFAULT_PRICING.profitPercent),
    contingencyPercent: clampPercent(raw?.contingencyPercent, DEFAULT_PRICING.contingencyPercent),
    appliedAt: raw?.appliedAt,
  };
}

/**
 * Reference rate for a resource, derived from the catalogue and the pricing
 * settings. This is a *suggestion*: the rate actually applied to a project is
 * `resource.rate`, which only changes when the user (or `applyMarketRates`)
 * writes it. Keeping the two apart is what makes "displayed rate = applied rate"
 * auditable.
 */
/** Validated rate values coming from a market snapshot (feed or catalogue). */
export type RateSnapshotMap = Record<
  string,
  { market?: number; official1405?: number; official1404?: number }
>;

/**
 * Resolves the value for a catalogue item, preferring the snapshot that was
 * actually shown to the user. This is what prevents "displayed rate ≠ applied
 * rate": both paths call this function with the *same* snapshot object.
 */
export function resolveRateFromSnapshot(
  item: { key: string; market: number; official1405?: number; official1404?: number; category: string },
  series: ProjectPricing["series"] | "market",
  snapshot?: RateSnapshotMap,
) {
  const override = snapshot?.[item.key];
  const official1405 = override?.official1405 ?? item.official1405;
  const official1404 = override?.official1404 ?? item.official1404;
  const market = override?.market ?? item.market;
  if (item.category === "labor") {
    if (series === "official-1405" && official1405) return official1405;
    if (series === "official-1404" && official1404) return official1404;
  }
  return market;
}

export function effectiveRate(resource: ResourceInput, pricing: ProjectPricing, snapshot?: RateSnapshotMap) {
  const key = resource.rateKey ?? guessRateKey(resource.name);
  const item = key ? findRate(key) : undefined;
  if (!item) {
    return {
      key: undefined,
      unit: resource.unit,
      rate: resource.rate,
      appliedRate: resource.rate,
      source: resource.rateSource ?? "نرخ دستی کاربر",
      provenance: undefined,
      verified: false,
    };
  }
  const base = resolveRateFromSnapshot(item, pricing.series, snapshot);
  const rate = Math.round(base * REGION_FACTORS[pricing.region].factor * (pricing.indexFactor / 100));
  const provenance = rateProvenance(item, pricing.series);
  return {
    key: item.key,
    unit: item.unit,
    rate,
    appliedRate: resource.rate,
    source: `${SERIES_LABELS[pricing.series]} · ${MARKET_AS_OF.jalali}`,
    provenance,
    verified: provenance.verification === "verified",
  };
}

/** بازنویسی نرخ همه منابع بر مبنای فهرست بازار (عملیات قابل بازگشت توسط کاربر) */
export function applyMarketRates(
  project: ProjectInput,
  pricing: ProjectPricing,
  /** the exact snapshot shown in the UI — omit only for the static catalogue */
  snapshot?: RateSnapshotMap,
): ProjectInput {
  const next: ProjectInput = {
    ...project,
    resources: project.resources.map((resource) => {
      const effective = effectiveRate(resource, pricing, snapshot);
      return {
        ...resource,
        rateKey: effective.key ?? resource.rateKey,
        unit: effective.unit ?? resource.unit,
        rate: effective.rate,
        rateSource: effective.source,
      };
    }),
    pricing: { ...pricing, appliedAt: new Date().toISOString() },
  };
  return next;
}

function monthKey(iso: string): string {
  const [jy, jm] = toJalali(iso);
  return `${jy}-${String(jm).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [jy, jm] = key.split("-");
  return `${JALALI_MONTHS[Number(jm) - 1] ?? ""} ${jy}`;
}

/**
 * Cost-increase scenario (سناریوی افزایش هزینه) — **not** contractual escalation.
 *
 * What it does: the planned cost of every activity is spread evenly over its
 * working days, bucketed by Jalali month, and every month that *starts after*
 * the status month is compounded by the monthly rate the user typed.
 *
 * What it is not: a contractual price adjustment (تعدیل). A contractual
 * adjustment needs an official index series, a base period, a performance
 * period, factor shares and a published formula — none of which exist in the
 * data model yet. The UI and the report label this block accordingly.
 *
 * Date handling: the status month is derived from the status date itself, not
 * from its position in the working-day array. The previous implementation used
 * `dates.findIndex(...)` and silently fell back to index 0 when the status date
 * was not a working day or fell outside the project range — which compounded the
 * whole project from the first month.
 */
export function computeEscalation(
  input: ProjectInput,
  analysis: PricingAnalysis,
  pricing: ProjectPricing,
): EscalationResult {
  const empty: EscalationResult = {
    months: [],
    total: 0,
    baseValue: 0,
    scenario: true,
    statusMonth: undefined,
    note: "سناریوی افزایش هزینه غیرفعال است",
  };
  if (!pricing.escalationEnabled || pricing.escalationRatePerMonth <= 0) return empty;

  const dates = analysis.gantt.dates;
  if (!dates.length) {
    return { ...empty, note: "تقویم پروژه خالی است؛ سناریوی افزایش هزینه قابل محاسبه نیست" };
  }

  /** Jalali month ordinal (year × 12 + month) — monotonic and comparable. */
  const ordinal = (iso: string): number | null => {
    if (!isIsoDate(iso)) return null;
    const [jy, jm] = toJalali(iso);
    if (!Number.isFinite(jy) || !Number.isFinite(jm)) return null;
    return jy * 12 + (jm - 1);
  };

  const statusOrdinal = ordinal(input.meta.statusDate);
  if (statusOrdinal === null) {
    return { ...empty, note: "تاریخ وضعیت معتبر نیست؛ سناریوی افزایش هزینه قابل محاسبه نیست" };
  }

  const buckets = new Map<string, { workingDays: number; plannedValue: number; ordinal: number }>();
  dates.forEach((date) => {
    const key = monthKey(date);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.workingDays += 1;
    } else {
      buckets.set(key, { workingDays: 1, plannedValue: 0, ordinal: ordinal(date) ?? 0 });
    }
  });

  for (const activity of analysis.activities) {
    const totalDays = Math.max(activity.ee - activity.es, 0);
    if (totalDays === 0) continue;
    const perDay = activity.budgetCost / totalDays;
    for (let offset = activity.es; offset < activity.ee; offset += 1) {
      const date = dates[offset];
      if (!date) continue;
      const bucket = buckets.get(monthKey(date));
      if (bucket) bucket.plannedValue += perDay;
    }
  }

  const monthlyRate = pricing.escalationRatePerMonth / 100;
  const ordered = [...buckets.entries()].sort((a, b) => a[1].ordinal - b[1].ordinal);

  let total = 0;
  let baseValue = 0;
  const months: EscalationMonth[] = [];

  for (const [key, bucket] of ordered) {
    // Months strictly after the status month are escalated; the status month and
    // everything before it stay at their base cost.
    const monthsAfter = bucket.ordinal - statusOrdinal;
    const factor = monthsAfter > 0 ? Math.pow(1 + monthlyRate, monthsAfter) : 1;
    const adjusted = bucket.plannedValue * factor;
    const escalation = adjusted - bucket.plannedValue;
    if (monthsAfter > 0) {
      total += escalation;
      baseValue += bucket.plannedValue;
    }
    months.push({
      key,
      label: monthLabel(key),
      workingDays: bucket.workingDays,
      plannedValue: round2(bucket.plannedValue),
      factor: Number(factor.toFixed(4)),
      adjustedValue: round2(adjusted),
      escalation: round2(escalation),
    });
  }

  return {
    months,
    total: round2(total),
    baseValue: round2(baseValue),
    scenario: true,
    statusMonth: monthLabel(monthKey(input.meta.statusDate)),
    note:
      "این محاسبه یک «سناریوی افزایش هزینه» با نرخ مرکب ماهانه است و معادل تعدیل قراردادی " +
      "(مبتنی بر شاخص رسمی، دوره مبنا و فرمول قرارداد) نیست.",
  };
}

export interface EscalationResult {
  months: EscalationMonth[];
  total: number;
  baseValue: number;
  /** always true: this block is a scenario, never a contractual adjustment */
  scenario: boolean;
  statusMonth?: string;
  note: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** ساختار برآورد هزینه مطابق روش فهرست‌بهای (مستقیم + بالاسری + سود + احتیاط + تعدیل) */
export function computeCostBreakdown(direct: number, escalation: number, pricing: ProjectPricing) {
  const overhead = round2(direct * (pricing.overheadPercent / 100));
  const profit = round2((direct + overhead) * (pricing.profitPercent / 100));
  const contingency = round2(direct * (pricing.contingencyPercent / 100));
  const total = round2(direct + overhead + profit + contingency + escalation);
  return { direct: round2(direct), overhead, profit, contingency, escalation: round2(escalation), total };
}

/** نتیجه کامل قیمت‌گذاری برای گزارش و تحلیل */
export function computePricing(
  input: ProjectInput,
  analysis: PricingAnalysis,
  pricingInput?: Partial<ProjectPricing> | null,
): PricingResult {
  const pricing = normalizePricing(pricingInput);
  const escalation = computeEscalation(input, analysis, pricing);
  const breakdown = computeCostBreakdown(analysis.costs.budget, escalation.total, pricing);

  return {
    series: pricing.series,
    seriesLabel: SERIES_LABELS[pricing.series],
    region: pricing.region,
    regionLabel: REGION_FACTORS[pricing.region].label,
    indexFactor: pricing.indexFactor,
    asOf: MARKET_AS_OF.iso,
    asOfJalali: MARKET_AS_OF.jalali,
    sources: MARKET_AS_OF.sources,
    escalationEnabled: pricing.escalationEnabled,
    escalationRatePerMonth: pricing.escalationRatePerMonth,
    escalation,
    breakdown,
    rates: input.resources.map((resource) => {
      const effective = effectiveRate(resource, pricing);
      return {
        resourceId: resource.id,
        name: resource.name,
        key: effective.key,
        unit: effective.unit,
        // applied rate = what the project actually uses for money
        rate: resource.rate,
        // reference rate = what the catalogue would suggest
        catalogRate: effective.rate,
        source: resource.rateSource ?? "نرخ دستی کاربر",
        verified: effective.verified,
        provenance: effective.provenance
          ? {
              kind: effective.provenance.kind,
              verification: effective.provenance.verification,
              source: effective.provenance.source,
              asOfIso: effective.provenance.asOfIso,
              note: effective.provenance.note,
            }
          : undefined,
      };
    }),
    ratePolicy: {
      verification: RATE_DATA_POLICY.verification,
      note: RATE_DATA_POLICY.note,
      asOfJalali: MARKET_AS_OF.jalali,
      asOfIso: MARKET_AS_OF.iso,
    },
  };
}

export interface MarketSnapshot {
  asOf: string;
  asOfJalali: string;
  isLive: boolean;
  feedUrl?: string;
  fetchedAt: string;
  /** number of feed rows rejected by validation */
  quarantined?: number;
  /** why the feed could not be used (absent when it was used successfully) */
  feedError?: string;
  sources: string[];
  indices: { period: string; label: string; value: number; change: string }[];
  rates: {
    key: string;
    name: string;
    category: string;
    unit: string;
    market: number;
    official1405?: number;
    official1404?: number;
    volatility: string;
  }[];
}

let cache: { at: number; snapshot: MarketSnapshot } | null = null;
const TTL_MS = 1000 * 60 * 30;

/**
 * فید قیمت بازار. اگر `HERMIPLAN_MARKET_FEED` تنظیم شده باشد، نرخ‌های لحظه‌ای از آن
 * خوانده و با فهرست پایه ادغام می‌شود؛ در غیر این صورت نسخه مرجع داخلی ارائه می‌گردد.
 */
export async function getMarketSnapshot(force = false): Promise<MarketSnapshot> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.snapshot;

  const feedUrl = process.env.HERMIPLAN_MARKET_FEED;
  let snapshot: MarketSnapshot = {
    asOf: MARKET_AS_OF.iso,
    asOfJalali: MARKET_AS_OF.jalali,
    isLive: false,
    fetchedAt: new Date().toISOString(),
    sources: MARKET_AS_OF.sources,
    indices: (await import("./rates")).MARKET_INDICES,
    rates: RATE_CATALOG.map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      market: item.market,
      official1405: item.official1405,
      official1404: item.official1404,
      volatility: item.volatility,
    })),
  };

  let quarantined = 0;
  let feedError: string | undefined;

  if (feedUrl) {
    try {
      const response = await fetch(feedUrl, {
        headers: process.env.HERMIPLAN_MARKET_FEED_KEY
          ? { Authorization: `Bearer ${process.env.HERMIPLAN_MARKET_FEED_KEY}` }
          : undefined,
        next: { revalidate: 900 },
      });
      if (!response.ok) {
        feedError = `HTTP ${response.status}`;
      } else {
        const payload = (await response.json()) as {
          asOf?: string;
          rates?: { key?: unknown; market?: unknown; official1405?: unknown; official1404?: unknown }[];
        };
        const valid = (value: unknown): number | undefined =>
          typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

        const overrides = new Map<string, { market?: number; official1405?: number; official1404?: number }>();
        for (const entry of payload.rates ?? []) {
          const key = typeof entry.key === "string" ? entry.key : undefined;
          if (!key || !RATE_CATALOG.some((item) => item.key === key)) {
            quarantined += 1;
            continue;
          }
          const market = valid(entry.market);
          const official1405 = valid(entry.official1405);
          const official1404 = valid(entry.official1404);
          if (market === undefined && official1405 === undefined && official1404 === undefined) {
            // A row without a single usable number is quarantined, never merged.
            quarantined += 1;
            continue;
          }
          overrides.set(key, { market, official1405, official1404 });
        }

        if (overrides.size === 0) {
          feedError = "فید هیچ نرخ معتبری برنگرداند";
        } else {
          const asOf = typeof payload.asOf === "string" && isIsoDate(payload.asOf) ? payload.asOf : snapshot.asOf;
          snapshot = {
            ...snapshot,
            asOf,
            isLive: true,
            feedUrl,
            fetchedAt: new Date().toISOString(),
            rates: snapshot.rates.map((rate) => {
              const override = overrides.get(rate.key);
              return override
                ? {
                    ...rate,
                    market: override.market ?? rate.market,
                    official1405: override.official1405 ?? rate.official1405,
                  }
                : rate;
            }),
            sources: [`فید بازار (${asOf})`, ...snapshot.sources],
          };
        }
      }
    } catch (error) {
      feedError = (error as Error)?.name === "AbortError" ? "timeout" : "unreachable";
    }
  }

  snapshot = { ...snapshot, quarantined, feedError };

  cache = { at: Date.now(), snapshot };
  return snapshot;
}
