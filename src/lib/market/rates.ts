/**
 * HERMIPLAN — Iranian market rate catalog.
 *
 * Grounded data sources:
 *  • مصوبه شورای عالی کار (بخشنامه ۲۳۱۷۱۱ مورخ ۱۴۰۳/۱۲/۲۸) و جدول دستمزد ۱۴۰۵ —
 *    حداقل مزد روزانه ۱۴۰۴: ۳,۴۶۳,۶۵۶ ریال / ۱۴۰۵: ۵,۵۴۱,۸۵۰ ریال؛ ضرایب کارگران
 *    ساختمانی بر پایه کارت مهارت فنی: ۱.۳ / ۱.۶ / ۱.۹ برابر حداقل مزد.
 *  • فهرست‌بهای واحد پایه سازمان برنامه و بودجه (رسته‌های ابنیه، راه و ترابری، تأسیسات
 *    مکانیکی و برقی، آب و فاضلاب و …) — مبنای برآورد هزینه طرح‌های عمرانی.
 *  • میانگین بازار مصالح ساختمانی ۱۴۰۵ (سیمان تیپ ۲ پاکتی، میلگرد A۳، بتن آماده …).
 *
 * نرخ‌ها به ریال و در واحد پایه هر ردیف است. برای مصالح، «نرخ» = قیمت واحد و «تعداد»
 * در تخصیص منبع = مصرف روزانه است (نرخ × تعداد × مدت = هزینه).
 */

export type RateSeries = "official-1405" | "official-1404" | "market";
export type RateRegion = "tehran" | "metro" | "other";

export interface RateItem {
  key: string;
  name: string;
  category: "labor" | "equipment" | "material";
  unit: string;
  /** نرخ مصوب رسمی سال ۱۴۰۵ (ریال) */
  official1405?: number;
  /** نرخ مصوب رسمی سال ۱۴۰۴ (ریال) */
  official1404?: number;
  /** میانگین بازار آزاد (ریال) */
  market: number;
  volatility: "low" | "medium" | "high";
  note?: string;
}

export const RATE_CATALOG: RateItem[] = [
  /* ---------------------------- نیروی انسانی --------------------------- */
  {
    key: "labor-min",
    name: "حداقل دستمزد روزانه مصوب",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 5_541_850,
    official1404: 3_463_656,
    market: 12_000_000,
    volatility: "medium",
    note: "مصوبه شورای عالی کار — مبنای محاسبه حق بیمه کارگران ساختمانی",
  },
  {
    key: "labor-general-3",
    name: "کارگر ساختمانی درجه ۳ (عمومی)",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 7_204_405,
    official1404: 4_502_752,
    market: 18_000_000,
    volatility: "medium",
    note: "۱۳/۱ برابر حداقل مزد مصوب (کارت مهارت فنی درجه ۳)",
  },
  {
    key: "labor-general-2",
    name: "کارگر ساختمانی درجه ۲ (نیمه‌ماهر)",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 8_866_960,
    official1404: 5_541_850,
    market: 24_000_000,
    volatility: "medium",
    note: "۱۶/۱ برابر حداقل مزد مصوب (کارت مهارت فنی درجه ۲)",
  },
  {
    key: "labor-general-1",
    name: "کارگر ساختمانی درجه ۱ (ماهر / استادکار)",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 10_529_515,
    official1404: 6_580_947,
    market: 34_000_000,
    volatility: "medium",
    note: "۱۹/۱ برابر حداقل مزد مصوب (کارت مهارت فنی درجه ۱)",
  },
  {
    key: "labor-rebar",
    name: "آرماتوربند",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 10_529_515,
    official1404: 6_580_947,
    market: 30_000_000,
    volatility: "high",
  },
  {
    key: "labor-carpenter",
    name: "نجار قالب‌بند",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 10_529_515,
    official1404: 6_580_947,
    market: 30_000_000,
    volatility: "high",
  },
  {
    key: "labor-welder",
    name: "جوشکار",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 10_529_515,
    official1404: 6_580_947,
    market: 32_000_000,
    volatility: "high",
  },
  {
    key: "labor-operator",
    name: "اپراتور ماشین‌آلات",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 11_600_000,
    official1404: 7_300_000,
    market: 28_000_000,
    volatility: "medium",
  },
  {
    key: "labor-technician",
    name: "تکنسین نصب و تأسیسات",
    category: "labor",
    unit: "روز-کارگر",
    official1405: 12_000_000,
    official1404: 7_500_000,
    market: 26_000_000,
    volatility: "medium",
  },
  {
    key: "engineer-site",
    name: "مهندس ناظر / سرپرست اجرا",
    category: "labor",
    unit: "روز-مهندس",
    official1405: 20_000_000,
    official1404: 14_000_000,
    market: 26_000_000,
    volatility: "low",
  },
  {
    key: "engineer-manager",
    name: "مدیر پروژه",
    category: "labor",
    unit: "روز-مهندس",
    official1405: 28_000_000,
    official1404: 19_000_000,
    market: 34_000_000,
    volatility: "low",
  },
  {
    key: "engineer-designer",
    name: "مهندس طراح / معمار",
    category: "labor",
    unit: "روز-مهندس",
    official1405: 22_000_000,
    official1404: 15_000_000,
    market: 27_000_000,
    volatility: "low",
  },
  {
    key: "engineer-qa",
    name: "مهندس کیفیت و ایمنی (QC/HSE)",
    category: "labor",
    unit: "روز-مهندس",
    official1405: 20_000_000,
    official1404: 14_000_000,
    market: 25_000_000,
    volatility: "low",
  },

  /* ----------------------------- ماشین‌آلات ---------------------------- */
  { key: "equip-excavator", name: "بیل مکانیکی", category: "equipment", unit: "روز-ماشین", market: 140_000_000, volatility: "high" },
  { key: "equip-loader", name: "لودر", category: "equipment", unit: "روز-ماشین", market: 110_000_000, volatility: "high" },
  { key: "equip-grader", name: "گریدر", category: "equipment", unit: "روز-ماشین", market: 160_000_000, volatility: "high" },
  { key: "equip-roller", name: "غلتک خاک / آسفالت", category: "equipment", unit: "روز-ماشین", market: 120_000_000, volatility: "high" },
  { key: "equip-dump", name: "کمپرسی ۱۰ چرخ", category: "equipment", unit: "روز-ماشین", market: 90_000_000, volatility: "high" },
  { key: "equip-pump", name: "بتن‌پمپ", category: "equipment", unit: "روز-ماشین", market: 150_000_000, volatility: "medium" },
  { key: "equip-crane", name: "جرثقیل ۲۵ تنی", category: "equipment", unit: "روز-ماشین", market: 180_000_000, volatility: "high" },
  { key: "equip-welder", name: "دستگاه جوشکاری و تجهیزات کمکی", category: "equipment", unit: "روز-ماشین", market: 8_000_000, volatility: "low" },
  { key: "equip-scaffold", name: "داربندی و قالب فلزی", category: "equipment", unit: "روز-ماشین", market: 12_000_000, volatility: "medium" },
  { key: "equip-it", name: "زیرساخت نرم‌افزاری و ابری", category: "equipment", unit: "روز-سرویس", market: 3_500_000, volatility: "medium" },

  /* ------------------------------- مصالح ------------------------------ */
  { key: "mat-rebar", name: "میلگرد آجدار A3", category: "material", unit: "کیلوگرم", market: 950_000, volatility: "high", note: "محدوده بازار ۱۴۰۵: ۸۸ تا ۱۰۵ هزار تومان برای هر کیلوگرم" },
  { key: "mat-beam", name: "تیرآهن", category: "material", unit: "کیلوگرم", market: 1_100_000, volatility: "high" },
  { key: "mat-cement", name: "سیمان تیپ ۲ پاکتی (۵۰ کیلوگرم)", category: "material", unit: "کیسه", market: 2_600_000, volatility: "medium", note: "محدوده بازار ۱۴۰۵: ۲۵۰ تا ۲۹۰ هزار تومان" },
  { key: "mat-concrete", name: "بتن آماده عیار ۳۵۰", category: "material", unit: "مترمکعب", market: 25_000_000, volatility: "high", note: "شامل هزینه پمپ" },
  { key: "mat-block", name: "بلوک سفالی ۱۰×۲۰×۴۰", category: "material", unit: "عدد", market: 150_000, volatility: "medium" },
  { key: "mat-sand", name: "ماسه", category: "material", unit: "مترمکعب", market: 4_000_000, volatility: "medium" },
  { key: "mat-gravel", name: "شن", category: "material", unit: "مترمکعب", market: 4_500_000, volatility: "medium" },
  { key: "mat-gypsum", name: "گچ ساختمانی", category: "material", unit: "کیلوگرم", market: 120_000, volatility: "medium" },
  { key: "mat-tile", name: "کاشی و سرامیک", category: "material", unit: "مترمربع", market: 9_000_000, volatility: "medium" },
  { key: "mat-paint", name: "رنگ و پوشش نهایی", category: "material", unit: "لیتر", market: 2_500_000, volatility: "medium" },
  { key: "mat-waterproof", name: "عایق رطوبتی", category: "material", unit: "مترمربع", market: 2_000_000, volatility: "high" },
  { key: "mat-cable", name: "کابل و سیم برق", category: "material", unit: "متر", market: 800_000, volatility: "high" },
  { key: "mat-pipe", name: "لوله پلی‌اتیلن / پلی‌پروپیلن", category: "material", unit: "متر", market: 3_500_000, volatility: "medium" },
  { key: "mat-asphalt", name: "آسفالت گرم (پایه و رویه)", category: "material", unit: "تن", market: 12_000_000, volatility: "high" },
];

export const REGION_FACTORS: Record<RateRegion, { label: string; factor: number }> = {
  tehran: { label: "تهران", factor: 1 },
  metro: { label: "کلان‌شهرها", factor: 0.93 },
  other: { label: "سایر شهرها", factor: 0.86 },
};

export const SERIES_LABELS: Record<RateSeries, string> = {
  "official-1405": "مصوب رسمی ۱۴۰۵ (شورای عالی کار)",
  "official-1404": "مصوب رسمی ۱۴۰۴ (شورای عالی کار)",
  market: "میانگین بازار آزاد",
};

/** شاخص‌های مرجع برای تحلیل روند (منبع: مرکز آمار ایران / گزارش‌های بازار) */
export const MARKET_INDICES: { period: string; label: string; value: number; change: string }[] = [
  { period: "1405-01", label: "شاخص نهاده‌های ساختمان مسکونی تهران — بهار ۱۴۰۵", value: 336.4, change: "۱۰۶.۸٪ افزایش سالانه" },
  { period: "1404-01", label: "شاخص نهاده‌های ساختمان مسکونی تهران — بهار ۱۴۰۴", value: 162.8, change: "مبنای مقایسه" },
];

/** تاریخ مرجع داده‌های بازار (به‌روزرسانی با هر انتشار جدید) */
export const MARKET_AS_OF = {
  jalali: "مهر ۱۴۰۵",
  iso: "2026-09-30",
  sources: [
    "مصوبه شورای عالی کار — جدول دستمزد ۱۴۰۴ و ۱۴۰۵",
    "فهرست‌بهای واحد پایه سازمان برنامه و بودجه",
    "میانگین فهرست‌های معاملاتی بازار مصالح ساختمانی",
  ],
};

/** نگاشت منابع قالب‌های پروژه به کلیدهای فهرست نرخ بازار */
export const TEMPLATE_RATE_KEYS: Record<string, string[]> = {
  construction: ["labor-general-3", "labor-operator", "engineer-site", "equip-excavator", "mat-rebar"],
  civil: ["engineer-site", "labor-operator", "labor-general-3", "equip-excavator", "mat-concrete"],
  architecture: ["engineer-designer", "labor-general-2", "engineer-designer", "engineer-qa"],
  infrastructure: ["engineer-site", "labor-technician", "labor-operator", "mat-pipe"],
  software: ["engineer-manager", "engineer-designer", "engineer-designer", "engineer-designer", "engineer-qa", "equip-it"],
  manufacturing: ["engineer-manager", "labor-technician", "labor-general-2", "mat-rebar", "equip-loader"],
  research: ["engineer-designer", "engineer-designer", "labor-technician", "equip-it"],
  event: ["engineer-manager", "labor-general-3", "labor-general-2", "equip-scaffold"],
  renovation: ["labor-general-2", "labor-general-1", "engineer-site", "mat-cement"],
  general: ["engineer-manager", "labor-general-3", "equip-it"],
};

export function findRate(key: string): RateItem | undefined {
  return RATE_CATALOG.find((item) => item.key === key);
}

export function resolveRate(item: RateItem, series: RateSeries): number {
  if (item.category === "labor") {
    if (series === "official-1405" && item.official1405) return item.official1405;
    if (series === "official-1404" && item.official1404) return item.official1404;
  }
  return item.market;
}

/** یافتن نزدیک‌ترین ردیف فهرست بر اساس نام منبع (برای منابع دستی کاربر) */
export function guessRateKey(name: string): string | undefined {
  const normalized = name.replace(/\u200c/g, " ").trim();
  if (!normalized) return undefined;
  const direct = RATE_CATALOG.find((item) => item.name === normalized);
  if (direct) return direct.key;
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 2);
  let best: { key: string; score: number } | undefined;
  for (const item of RATE_CATALOG) {
    let score = 0;
    for (const token of tokens) if (item.name.includes(token)) score += token.length;
    if (score > 0 && (!best || score > best.score)) best = { key: item.key, score };
  }
  return best?.key;
}
