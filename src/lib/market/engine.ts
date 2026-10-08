import { toJalali, JALALI_MONTHS } from "@/lib/date-fa";
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
  REGION_FACTORS,
  SERIES_LABELS,
  findRate,
  guessRateKey,
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

/** نرخ مؤثر یک منبع بر مبنای فهرست بازار و تنظیمات قیمت‌گذاری */
export function effectiveRate(resource: ResourceInput, pricing: ProjectPricing) {
  const key = resource.rateKey ?? guessRateKey(resource.name);
  const item = key ? findRate(key) : undefined;
  if (!item) {
    return {
      key: undefined,
      unit: resource.unit,
      rate: resource.rate,
      source: resource.rateSource ?? "نرخ دستی کاربر",
    };
  }
  const base = resolveRate(item, pricing.series);
  const rate = Math.round(base * REGION_FACTORS[pricing.region].factor * (pricing.indexFactor / 100));
  return {
    key: item.key,
    unit: item.unit,
    rate,
    source: `${SERIES_LABELS[pricing.series]} · ${MARKET_AS_OF.jalali}`,
  };
}

/** بازنویسی نرخ همه منابع بر مبنای فهرست بازار (عملیات قابل بازگشت توسط کاربر) */
export function applyMarketRates(project: ProjectInput, pricing: ProjectPricing): ProjectInput {
  const next: ProjectInput = {
    ...project,
    resources: project.resources.map((resource) => {
      const effective = effectiveRate(resource, pricing);
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
 * تعدیل / Escalation بر پایه کارکرد ماهانه.
 * هزینه برنامه‌ریزی‌شده هر فعالیت به‌طور مساوی میان روزهای کاری آن پخش و سپس
 * در ماه‌های بعد از تاریخ وضعیت با نرخ ماهانه تعدیل می‌شود.
 */
export function computeEscalation(
  input: ProjectInput,
  analysis: PricingAnalysis,
  pricing: ProjectPricing,
): { months: EscalationMonth[]; total: number; baseValue: number } {
  if (!pricing.escalationEnabled || pricing.escalationRatePerMonth <= 0) {
    return { months: [], total: 0, baseValue: 0 };
  }

  const dates = analysis.gantt.dates;
  if (!dates.length) return { months: [], total: 0, baseValue: 0 };

  const buckets = new Map<string, { workingDays: number; plannedValue: number; index: number }>();
  dates.forEach((date, index) => {
    const key = monthKey(date);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.workingDays += 1;
    } else {
      buckets.set(key, { workingDays: 1, plannedValue: 0, index });
    }
  });

  const statusIndex = dates.findIndex((date) => date === input.meta.statusDate);
  const effectiveStatusIndex = statusIndex >= 0 ? statusIndex : 0;

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
  const ordered = [...buckets.entries()].sort((a, b) => a[1].index - b[1].index);

  let total = 0;
  let baseValue = 0;
  const months: EscalationMonth[] = [];

  ordered.forEach(([key, bucket], order) => {
    const monthStartsAfterStatus = bucket.index > effectiveStatusIndex;
    const monthsAfter = monthStartsAfterStatus ? Math.max(1, order - ordered.findIndex(([, b]) => b.index <= effectiveStatusIndex)) : 0;
    const factor = monthsAfter > 0 ? Math.pow(1 + monthlyRate, monthsAfter) : 1;
    const adjusted = bucket.plannedValue * factor;
    const escalation = adjusted - bucket.plannedValue;
    if (monthStartsAfterStatus) {
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
  });

  return { months, total: round2(total), baseValue: round2(baseValue) };
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
        rate: resource.rate,
        source: resource.rateSource ?? "نرخ دستی کاربر",
      };
    }),
  };
}

export interface MarketSnapshot {
  asOf: string;
  asOfJalali: string;
  isLive: boolean;
  feedUrl?: string;
  fetchedAt: string;
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

  if (feedUrl) {
    try {
      const response = await fetch(feedUrl, {
        headers: process.env.HERMIPLAN_MARKET_FEED_KEY
          ? { Authorization: `Bearer ${process.env.HERMIPLAN_MARKET_FEED_KEY}` }
          : undefined,
        next: { revalidate: 900 },
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          asOf?: string;
          rates?: { key: string; market?: number; official1405?: number }[];
        };
        const overrides = new Map((payload.rates ?? []).map((r) => [r.key, r]));
        snapshot = {
          ...snapshot,
          asOf: payload.asOf ?? snapshot.asOf,
          isLive: true,
          feedUrl,
          fetchedAt: new Date().toISOString(),
          rates: snapshot.rates.map((rate) => {
            const override = overrides.get(rate.key);
            return override
              ? { ...rate, market: override.market ?? rate.market, official1405: override.official1405 ?? rate.official1405 }
              : rate;
          }),
          sources: [...(payload.asOf ? [`فید لحظه‌ای بازار (${payload.asOf})`] : []), ...snapshot.sources],
        };
      }
    } catch {
      /* feed unavailable — fall back to the reference catalog */
    }
  }

  cache = { at: Date.now(), snapshot };
  return snapshot;
}
