import type { DependencyType, ProjectInput, ProjectType, ResourceInput, RiskInput } from "./engine/types";
import { DEFAULT_PRICING, effectiveRate } from "./market/engine";
import { findRate, guessRateKey, MARKET_AS_OF, SERIES_LABELS, TEMPLATE_RATE_KEYS } from "./market/rates";

export interface TemplateActivity {
  code: string;
  name: string;
  phase: string;
  duration: number;
  /** predecessor refs: "A10" or "A10:SS+2" */
  preds?: string[];
  /** "resourceId:units" */
  res?: string[];
  progress?: number;
  milestone?: boolean;
  fixedCost?: number;
  notes?: string;
}

export type TemplateDomain =
  | "construction"
  | "infrastructure"
  | "design"
  | "technology"
  | "industry"
  | "research"
  | "event";

export interface ProjectTemplate {
  id: ProjectType;
  title: string;
  icon: string;
  tagline: string;
  domain: TemplateDomain;
  complexity: "ساده" | "متوسط" | "پیچیده";
  typicalWorkingDays: number;
  audience: string[];
  currency: "IRR" | "USD" | "EUR";
  phases: string[];
  resources: Omit<ResourceInput, "id">[];
  activities: TemplateActivity[];
  milestones: { name: string; activityCode?: string }[];
  risks: Omit<RiskInput, "id">[];
}

const R = (name: string, type: ResourceInput["type"], rate: number, capacity: number) => ({
  name,
  type,
  rate,
  capacity,
});

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "construction",
    title: "ساختمان (مسکونی / اداری)",
    icon: "🏗️",
    tagline: "از گودبرداری تا تحویل کلید؛ چرخه کامل اجرای ساختمان",
    domain: "construction",
    complexity: "پیچیده",
    typicalWorkingDays: 133,
    audience: ["پیمانکار", "کارفرما", "ناظر"],
    currency: "IRR",
    phases: ["مطالعات و آماده‌سازی", "عملیات خاکی و فونداسیون", "اسکلت و سفت‌کاری", "نازک‌کاری و تأسیسات", "پایان‌کار و تحویل"],
    resources: [
      R("نیروی کار عمومی", "labor", 1_200_000, 30),
      R("اپراتور ماشین‌آلات", "labor", 3_500_000, 6),
      R("مهندس ناظر اجرا", "labor", 6_000_000, 3),
      R("ماشین‌آلات سنگین", "equipment", 12_000_000, 4),
      R("مصالح ساختمانی", "material", 4_500_000, 100),
    ],
    activities: [
      { code: "A10", name: "برداشت و پیاده‌سازی نقشه", phase: "مطالعات و آماده‌سازی", duration: 2, res: ["r3:1", "r1:4"], preds: [], fixedCost: 15_000_000 },
      { code: "A20", name: "تجهیز کارگاه و دفتر پروژه", phase: "مطالعات و آماده‌سازی", duration: 5, res: ["r1:8"], preds: ["A10"], fixedCost: 80_000_000, notes: "شامل آوار، حصارکشی، انبار و تابلوی پروژه" },
      { code: "A30", name: "دریافت مجوزهای اجرا", phase: "مطالعات و آماده‌سازی", duration: 10, res: ["r3:1"], preds: ["A10"], fixedCost: 40_000_000 },
      { code: "A40", name: "شروع عملیات اجرایی", phase: "مطالعات و آماده‌سازی", duration: 0, milestone: true, preds: ["A20", "A30"] },
      { code: "A50", name: "گودبرداری و انتقال خاک", phase: "عملیات خاکی و فونداسیون", duration: 8, res: ["r4:2", "r1:6"], preds: ["A40"], fixedCost: 150_000_000 },
      { code: "A60", name: "بتن‌ریزی بند پایه و آجرچینی", phase: "عملیات خاکی و فونداسیون", duration: 6, res: ["r1:10", "r5:20"], preds: ["A50"], fixedCost: 60_000_000 },
      { code: "A70", name: "آرماتوربندی و قالب‌بندی فونداسیون", phase: "عملیات خاکی و فونداسیون", duration: 12, res: ["r1:12", "r5:30"], preds: ["A60"], fixedCost: 220_000_000 },
      { code: "A80", name: "بتن‌ریزی فونداسیون", phase: "عملیات خاکی و فونداسیون", duration: 4, res: ["r1:10", "r5:25"], preds: ["A70"], fixedCost: 90_000_000 },
      { code: "A90", name: "پایان فونداسیون", phase: "عملیات خاکی و فونداسیون", duration: 0, milestone: true, preds: ["A80"] },
      { code: "A100", name: "اجرا دیوارهای برشی و شافت‌ها", phase: "اسکلت و سفت‌کاری", duration: 15, res: ["r1:12", "r5:25"], preds: ["A90"] },
      { code: "A110", name: "قالب‌بندی و آرماتوربندی دال طبقات", phase: "اسکلت و سفت‌کاری", duration: 30, res: ["r1:16", "r5:40"], preds: ["A100"] },
      { code: "A120", name: "بتن‌ریزی طبقات", phase: "اسکلت و سفت‌کاری", duration: 18, res: ["r1:12", "r5:30"], preds: ["A110:SS+5"] },
      { code: "A130", name: "اجرای سقف و بتن‌سازی نهایی", phase: "اسکلت و سفت‌کاری", duration: 8, res: ["r1:10"], preds: ["A120"] },
      { code: "A140", name: "تأسیسات مکانیکی (لوله‌کشی و HVAC)", phase: "نازک‌کاری و تأسیسات", duration: 25, res: ["r1:8"], preds: ["A130:SS+3"], fixedCost: 350_000_000 },
      { code: "A150", name: "تأسیسات الکتریکی و ضدهای برق", phase: "نازک‌کاری و تأسیسات", duration: 22, res: ["r1:6"], preds: ["A130:SS+5"], fixedCost: 280_000_000 },
      { code: "A160", name: "نازک‌کاری، گچ‌کاری و کاشی", phase: "نازک‌کاری و تأسیسات", duration: 35, res: ["r1:14"], preds: ["A140:SS+8", "A150:SS+8"] },
      { code: "A170", name: "پایان نازک‌کاری", phase: "نازک‌کاری و تأسیسات", duration: 0, milestone: true, preds: ["A160"] },
      { code: "A180", name: "پوشش نما و درب و پنجره", phase: "پایان‌کار و تحویل", duration: 20, res: ["r1:10"], preds: ["A170:SS+5"], fixedCost: 420_000_000 },
      { code: "A190", name: "پاکسازی و فضای سبز", phase: "پایان‌کار و تحویل", duration: 10, res: ["r1:6"], preds: ["A180:SS+8"] },
      { code: "A200", name: "تست‌های نهایی و رفع نقص", phase: "پایان‌کار و تحویل", duration: 7, res: ["r3:2", "r1:4"], preds: ["A190"] },
      { code: "A210", name: "تحویل موقت کارفرما", phase: "پایان‌کار و تحویل", duration: 0, milestone: true, preds: ["A200"] },
    ],
    milestones: [
      { name: "شروع عملیات اجرایی", activityCode: "A40" },
      { name: "پایان فونداسیون", activityCode: "A90" },
      { name: "پایان نازک‌کاری", activityCode: "A170" },
      { name: "تحویل موقت", activityCode: "A210" },
    ],
    risks: [
      { title: "بارندگی و شرایط جوی نامساعد", category: "محیطی", probability: 3, impact: 3, scheduleImpact: 12, costImpact: 120_000_000, mitigation: "پیش‌بینی برنامه زمان‌بندی فصلی و پوشش محوطه" },
      { title: "نوسان قیمت مصالح", category: "مالی", probability: 4, impact: 4, scheduleImpact: 5, costImpact: 450_000_000, mitigation: "خرید زودهنگام مصالح کلیدی و درج تعدیل در قرارداد" },
      { title: "تأخیر در تأمین بتن آماده", category: "تأمین", probability: 3, impact: 4, scheduleImpact: 8, costImpact: 60_000_000, mitigation: "قرارداد با دو تأمین‌کننده و رزرو ظرفیت" },
      { title: "نرسیدن دستور کار از دستگاه نظارت", category: "اداری", probability: 2, impact: 3, scheduleImpact: 10, costImpact: 30_000_000, mitigation: "جلسات هفتگی هماهنگی و مستندسازی مکاتبات" },
    ],
  },
  {
    id: "civil",
    title: "پروژه پل / راه (مهندسی عمران)",
    icon: "🛣️",
    tagline: "زیرساخت راه و پل با کنترل نقاط ژئوتکنیکی",
    domain: "infrastructure",
    complexity: "پیچیده",
    typicalWorkingDays: 174,
    audience: ["پیمانکار", "مشاور", "کارفرمای دولتی"],
    currency: "IRR",
    phases: ["مطالعات و طراحی", "تجهیز و گودبرداری", "پی و زیرساخت", "رокумент و عرشه", "آسفالت و تحویل"],
    resources: [
      R("مهندس عمران", "labor", 7_000_000, 4),
      R("اپراتور ماشین‌آلات", "labor", 3_200_000, 8),
      R("کارگر فنی", "labor", 1_400_000, 40),
      R("ماشین‌آلات سنگین", "equipment", 15_000_000, 6),
      R("مصالح (بتن/فولاد)", "material", 6_000_000, 150),
    ],
    activities: [
      { code: "C10", name: "مطالعات ژئوتکنیک و حفاری گمانه", phase: "مطالعات و طراحی", duration: 12, res: ["r1:2"], fixedCost: 180_000_000 },
      { code: "C20", name: "طراحی اجرایی و نقشه‌های Shop Drawing", phase: "مطالعات و طراحی", duration: 20, res: ["r1:3"], preds: ["C10:SS+4"] },
      { code: "C30", name: "تجهیز محوطه و جاده دسترسی", phase: "تجهیز و گودبرداری", duration: 10, res: ["r4:3", "r3:10"], preds: ["C20"] },
      { code: "C40", name: "خاک‌برداری و تراز مسیر", phase: "تجهیز و گودبرداری", duration: 15, res: ["r4:4", "r3:12"], preds: ["C30"] },
      { code: "C50", name: "شمع‌کوبی و شفت‌های میانی", phase: "پی و زیرساخت", duration: 25, res: ["r4:2", "r3:14", "r5:30"], preds: ["C40"] },
      { code: "C60", name: "اجرا پی‌ها و سرستون‌ها", phase: "پی و زیرساخت", duration: 20, res: ["r3:16", "r5:35"], preds: ["C50:SS+6"] },
      { code: "C70", name: "پایان زیرساخت", phase: "پی و زیرساخت", duration: 0, milestone: true, preds: ["C60"] },
      { code: "C80", name: "ساخت رOCUMENT پایه‌ها", phase: "رокумент و عرشه", duration: 30, res: ["r3:14", "r5:40"], preds: ["C70"] },
      { code: "C90", name: "تنه و خرپاهای فلزی عرشه", phase: "رокумент و عرشه", duration: 28, res: ["r3:12", "r5:45"], preds: ["C80:SS+10"] },
      { code: "C100", name: "بتن‌ریزی دال عرشه", phase: "رокумент و عرشه", duration: 12, res: ["r3:14", "r5:30"], preds: ["C90"] },
      { code: "C110", name: "کوبیت و جان‌پناه", phase: "رокумент و عرشه", duration: 14, res: ["r3:8"], preds: ["C100"] },
      { code: "C120", name: "زیرسازی و آسفالت مسیر", phase: "آسفالت و تحویل", duration: 18, res: ["r4:3", "r3:10"], preds: ["C110"] },
      { code: "C130", name: "علائم، خط‌کشی و ایمنی", phase: "آسفالت و تحویل", duration: 8, res: ["r3:6"], preds: ["C120"] },
      { code: "C140", name: "تست بارگذاری و تحویل", phase: "آسفالت و تحویل", duration: 6, res: ["r1:3"], preds: ["C130"] },
    ],
    milestones: [
      { name: "تأیید طراحی اجرایی", activityCode: "C20" },
      { name: "پایان زیرساخت", activityCode: "C70" },
      { name: "پایان عرشه", activityCode: "C110" },
      { name: "بهره‌برداری", activityCode: "C140" },
    ],
    risks: [
      { title: "برخورد با شرایط ژئوتکنیکی پیش‌بینی‌نشده", category: "فنی", probability: 3, impact: 5, scheduleImpact: 20, costImpact: 500_000_000, mitigation: "گمانه‌های تکمیلی و طراحی راه‌حل جایگزین" },
      { title: "تأخیر در تأمین فولاد سازه", category: "تأمین", probability: 4, impact: 4, scheduleImpact: 15, costImpact: 300_000_000, mitigation: "سفارش زودهنگام و قرارداد با تولیدکننده داخلی" },
      { title: "محدودیت تردد ماشین‌آلات", category: "محیطی", probability: 3, impact: 2, scheduleImpact: 6, costImpact: 50_000_000, mitigation: "برنامه‌ریزی حمل در ساعات غیرپیک" },
    ],
  },
  {
    id: "architecture",
    title: "طراحی معماری و داخلی",
    icon: "📐",
    tagline: "از مفهوم تا نقشه‌های اجرایی و نظارت",
    domain: "design",
    complexity: "متوسط",
    typicalWorkingDays: 103,
    audience: ["معمار", "مشاور", "کارفرما"],
    currency: "IRR",
    phases: ["برنامه‌ریزی و شرح خدمات", "طراحی مفهومی", "طراحی تفصیلی", "نقشه‌های اجرایی", "نظارت و اجرا"],
    resources: [
      R("معمار ارشد", "labor", 8_000_000, 2),
      R("معمار جونیور", "labor", 4_000_000, 4),
      R("طراح ۳D و رندر", "labor", 5_500_000, 3),
      R("مهندس تأسیسات", "labor", 6_500_000, 2),
    ],
    activities: [
      { code: "D10", name: "جلسه نیازسنجی و شرح خدمات کارفرما", phase: "برنامه‌ریزی و شرح خدمات", duration: 3, res: ["r1:1"] },
      { code: "D20", name: "برداشت موقعیت و مستندسازی وضع موجود", phase: "برنامه‌ریزی و شرح خدمات", duration: 5, res: ["r2:2"], preds: ["D10"] },
      { code: "D30", name: "برنامه فیزیکی و دیاگرام عملکردی", phase: "طراحی مفهومی", duration: 7, res: ["r1:1", "r2:2"], preds: ["D20"] },
      { code: "D40", name: "طرح مفهومی و آلترناتیوها", phase: "طراحی مفهومی", duration: 10, res: ["r1:1", "r3:1"], preds: ["D30"] },
      { code: "D50", name: "تأیید کارفرما بر طرح مفهومی", phase: "طراحی مفهومی", duration: 0, milestone: true, preds: ["D40"] },
      { code: "D60", name: "توسعه طرح و پلان‌های تفصیلی", phase: "طراحی تفصیلی", duration: 14, res: ["r1:1", "r2:3"], preds: ["D50"] },
      { code: "D70", name: "نما، مصالح و جزئیات معماری", phase: "طراحی تفصیلی", duration: 10, res: ["r1:1", "r2:2"], preds: ["D60:SS+5"] },
      { code: "D80", name: "هماهنگی تأسیسات و سازه", phase: "طراحی تفصیلی", duration: 8, res: ["r4:2", "r2:1"], preds: ["D60:SS+6"] },
      { code: "D90", name: "تولید نقشه‌های اجرایی", phase: "نقشه‌های اجرایی", duration: 12, res: ["r2:4"], preds: ["D70", "D80"] },
      { code: "D100", name: "مدل سه‌بعدی و رندرهای ارائه", phase: "نقشه‌های اجرایی", duration: 8, res: ["r3:2"], preds: ["D70:SS+4"] },
      { code: "D110", name: "بöک لیست مصالح و برآورد", phase: "نقشه‌های اجرایی", duration: 6, res: ["r2:2"], preds: ["D90"] },
      { code: "D120", name: "تحویل پکیج نقشه‌ها", phase: "نقشه‌های اجرایی", duration: 0, milestone: true, preds: ["D110", "D100"] },
      { code: "D130", name: "نظارت بر اجرا و رفع اشکال", phase: "نظارت و اجرا", duration: 40, res: ["r1:1", "r2:1"], preds: ["D120"] },
    ],
    milestones: [
      { name: "تأیید طرح مفهومی", activityCode: "D50" },
      { name: "تحویل پکیج نقشه", activityCode: "D120" },
    ],
    risks: [
      { title: "تغییرات مکرر سلیقه کارفرما", category: "ذی‌نفعان", probability: 4, impact: 3, scheduleImpact: 10, costImpact: 80_000_000, mitigation: "تعریف محدوده تعدیل‌ها و فرم تأیید مکتوب" },
      { title: "ناهماهنگی تخصصی سازه و تأسیسات", category: "فنی", probability: 3, impact: 3, scheduleImpact: 7, costImpact: 40_000_000, mitigation: "جلسات BIM هماهنگی هفتگی" },
    ],
  },
  {
    id: "infrastructure",
    title: "زیرساخت (آب / برق / شبکه)",
    icon: "🔌",
    tagline: "شبکه‌های انتقال و توزیع با تست و راه‌اندازی",
    domain: "infrastructure",
    complexity: "متوسط",
    typicalWorkingDays: 93,
    audience: ["پیمانکار تأسیسات", "شهرداری", "بهره\u200cبردار"],
    currency: "IRR",
    phases: ["طرح و مجوز", "تجهیز سایت", "لوله‌کشی / کابل‌کشی", "تست و راه‌اندازی", "بهره‌برداری"],
    resources: [
      R("مهندس شبکه", "labor", 7_500_000, 4),
      R("تکنسین نصب", "labor", 2_800_000, 20),
      R("اپراتور تجهیزات", "labor", 3_200_000, 6),
      R("تجهیزات و مصالح", "material", 5_000_000, 200),
    ],
    activities: [
      { code: "I10", name: "نقشه‌برداری مسیر و توپوگرافی", phase: "طرح و مجوز", duration: 8, res: ["r1:2"] },
      { code: "I20", name: "اخذ مجوزهای عبور و حریم", phase: "طرح و مجوز", duration: 15, res: ["r1:1"], preds: ["I10"] },
      { code: "I30", name: "تجهیز سایت و انبار", phase: "تجهیز سایت", duration: 6, res: ["r3:3", "r2:6"], preds: ["I20"] },
      { code: "I40", name: "خرید و تحویل تجهیزات اصلی", phase: "تجهیز سایت", duration: 20, res: ["r4:60"], preds: ["I20:SS+5"] },
      { code: "I50", name: "حفاری و ترانشه‌زنی", phase: "لوله‌کشی / کابل‌کشی", duration: 18, res: ["r3:4", "r2:10"], preds: ["I30"] },
      { code: "I60", name: "لوله‌گذاری / کابل‌کشی", phase: "لوله‌کشی / کابل‌کشی", duration: 25, res: ["r2:12", "r4:30"], preds: ["I50:SS+4", "I40"] },
      { code: "I70", name: "اتصالات و اتصال به شبکه موجود", phase: "لوله‌کشی / کابل‌کشی", duration: 12, res: ["r2:8"], preds: ["I60"] },
      { code: "I80", name: "پرسازی و ترمیم سطح", phase: "لوله‌کشی / کابل‌کشی", duration: 10, res: ["r3:2", "r2:6"], preds: ["I70"] },
      { code: "I90", name: "تست فشار / تست عایقی", phase: "تست و راه‌اندازی", duration: 8, res: ["r1:2", "r2:4"], preds: ["I80"] },
      { code: "I100", name: "راه‌اندازی و تنظیم سیستم", phase: "تست و راه‌اندازی", duration: 6, res: ["r1:3"], preds: ["I90"] },
      { code: "I110", name: "تحویل و آموزش بهره‌بردار", phase: "بهره‌برداری", duration: 4, res: ["r1:2"], preds: ["I100"] },
    ],
    milestones: [
      { name: "دریافت تجهیزات", activityCode: "I40" },
      { name: "پایان تست‌ها", activityCode: "I100" },
      { name: "بهره‌برداری", activityCode: "I110" },
    ],
    risks: [
      { title: "موانع زیرساخت ناشناخته در مسیر", category: "فنی", probability: 3, impact: 4, scheduleImpact: 12, costImpact: 150_000_000, mitigation: "GPR پیش از حفاری و مسیر جایگزین" },
      { title: "تأخیر مجوز عبور از معابر عمومی", category: "اداری", probability: 4, impact: 3, scheduleImpact: 15, costImpact: 60_000_000, mitigation: "پیگیری موازی و شروع کار در بخش‌های بدون محدودیت" },
    ],
  },
  {
    id: "software",
    title: "توسعه نرم‌افزار / محصول دیجیتال",
    icon: "💻",
    tagline: "از دیسکاوری تا انتشار نسخه پایدار",
    domain: "technology",
    complexity: "متوسط",
    typicalWorkingDays: 97,
    audience: ["مدیر محصول", "تیم فنی", "سرمایه\u200cگذار"],
    currency: "IRR",
    phases: ["دیسکاوری و طراحی", "معماری و راه‌اندازی", "توسعه", "تست و پایداری", "انتشار"],
    resources: [
      R("مدیر محصول", "labor", 9_000_000, 2),
      R("مهندس ارشد نرم‌افزار", "labor", 10_000_000, 3),
      R("توسعه‌دهنده", "labor", 6_500_000, 8),
      R("طراح UI/UX", "labor", 6_000_000, 3),
      R("مهندس QA", "labor", 5_000_000, 4),
      R("زیرساخت ابری", "cost", 2_000_000, 50),
    ],
    activities: [
      { code: "S10", name: "مصاحبه با ذی‌نفعان و مستندسازی نیازها", phase: "دیسکاوری و طراحی", duration: 6, res: ["r1:1"] },
      { code: "S20", name: "طراحی تجربه کاربری و وایرفریم", phase: "دیسکاوری و طراحی", duration: 8, res: ["r4:2"], preds: ["S10:SS+3"] },
      { code: "S30", name: "پروتوتایپ و تست کاربر", phase: "دیسکاوری و طراحی", duration: 6, res: ["r4:1", "r5:1"], preds: ["S20"] },
      { code: "S40", name: "تأیید محدوده نسخه اول (MVP)", phase: "دیسکاوری و طراحی", duration: 0, milestone: true, preds: ["S30"] },
      { code: "S50", name: "معماری سیستم و انتخاب فناوری", phase: "معماری و راه‌اندازی", duration: 7, res: ["r2:2"], preds: ["S40"] },
      { code: "S60", name: "راه‌اندازی زیرساخت، CI/CD و مخزن", phase: "معماری و راه‌اندازی", duration: 6, res: ["r2:1", "r6:10"], preds: ["S50:SS+3"] },
      { code: "S70", name: "طراحی رابط کاربری نهایی", phase: "معماری و راه‌اندازی", duration: 10, res: ["r4:2"], preds: ["S40"] },
      { code: "S80", name: "توسعه بک‌اند و مدل داده", phase: "توسعه", duration: 25, res: ["r3:4", "r2:1"], preds: ["S60"] },
      { code: "S90", name: "توسعه فرانت‌اند", phase: "توسعه", duration: 22, res: ["r3:3"], preds: ["S70", "S80:SS+5"] },
      { code: "S100", name: "یکپارچه‌سازی و رفع اشکال", phase: "توسعه", duration: 8, res: ["r3:3", "r2:1"], preds: ["S90"] },
      { code: "S110", name: "تست پذیرش و رگرسیون", phase: "تست و پایداری", duration: 10, res: ["r5:3"], preds: ["S100"] },
      { code: "S120", name: "بهینه‌سازی عملکرد و امنیت", phase: "تست و پایداری", duration: 7, res: ["r2:1", "r5:1"], preds: ["S110:SS+4"] },
      { code: "S130", name: "آماده‌سازی انتشار", phase: "انتشار", duration: 5, res: ["r3:2", "r6:15"], preds: ["S120"] },
      { code: "S140", name: "انتشار نسخه ۱.۰", phase: "انتشار", duration: 0, milestone: true, preds: ["S130"] },
      { code: "S150", name: "پایش و پشتیبانی پس از انتشار", phase: "انتشار", duration: 15, res: ["r3:2"], preds: ["S140"] },
    ],
    milestones: [
      { name: "تأیید MVP", activityCode: "S40" },
      { name: "پایان توسعه", activityCode: "S100" },
      { name: "انتشار نسخه ۱.۰", activityCode: "S140" },
    ],
    risks: [
      { title: "تغییر دامنه (Scope Creep)", category: "ذی‌نفعان", probability: 4, impact: 4, scheduleImpact: 15, costImpact: 200_000_000, mitigation: "مدیریت Change Request و اولویت‌بندی مبتنی بر ارزش" },
      { title: "وابستگی به سرویس شخص ثالث", category: "فنی", probability: 3, impact: 3, scheduleImpact: 8, costImpact: 60_000_000, mitigation: "لایه انتزاع و پیاده‌سازی جایگزین" },
      { title: "کمبود نیروی متخصص", category: "منابع", probability: 3, impact: 4, scheduleImpact: 12, costImpact: 90_000_000, mitigation: "همکاری با پیمانکار تخصصی و مستندسازی دانش" },
    ],
  },
  {
    id: "manufacturing",
    title: "تولید / راه‌اندازی خط صنعتی",
    icon: "🏭",
    tagline: "از طراحی فرآیند تا تولید آزمایشی",
    domain: "industry",
    complexity: "پیچیده",
    typicalWorkingDays: 95,
    audience: ["مدیر تولید", "تأمین\u200cکننده", "سرمایه\u200cگذار"],
    currency: "IRR",
    phases: ["طراحی فرآیند", "تأمین و ساخت", "مونتاژ", "تولید آزمایشی", "تولید انبوه"],
    resources: [
      R("مهندس فرآیند", "labor", 7_000_000, 3),
      R("تکنسین مونتاژ", "labor", 2_600_000, 15),
      R("اپراتور تولید", "labor", 2_000_000, 25),
      R("مواد اولیه", "material", 3_500_000, 300),
      R("تجهیزات تولید", "equipment", 9_000_000, 8),
    ],
    activities: [
      { code: "M10", name: "طراحی فرآیند و فلوچارت تولید", phase: "طراحی فرآیند", duration: 8, res: ["r1:2"] },
      { code: "M20", name: "برآورد ظرفیت و چیدمان خط", phase: "طراحی فرآیند", duration: 7, res: ["r1:2"], preds: ["M10"] },
      { code: "M30", name: "سفارش و ساخت تجهیزات", phase: "تأمین و ساخت", duration: 30, res: ["r5:5"], preds: ["M20"] },
      { code: "M40", name: "خرید مواد اولیه", phase: "تأمین و ساخت", duration: 15, res: ["r4:120"], preds: ["M20:SS+4"] },
      { code: "M50", name: "نصب تجهیزات و رگلاژ", phase: "مونتاژ", duration: 18, res: ["r2:10", "r5:4"], preds: ["M30"] },
      { code: "M60", name: "مونتاژ خط و اتصالات", phase: "مونتاژ", duration: 12, res: ["r2:12"], preds: ["M50"] },
      { code: "M70", name: "پایان مونتاژ", phase: "مونتاژ", duration: 0, milestone: true, preds: ["M60"] },
      { code: "M80", name: "تولید آزمایشی و تنظیم پارامترها", phase: "تولید آزمایشی", duration: 12, res: ["r3:10", "r1:2"], preds: ["M70", "M40"] },
      { code: "M90", name: "بازرسی کیفیت و تأیید نمونه", phase: "تولید آزمایشی", duration: 6, res: ["r1:2"], preds: ["M80"] },
      { code: "M100", name: "آموزش اپراتورها", phase: "تولید آزمایشی", duration: 5, res: ["r1:2", "r3:6"], preds: ["M90:SS+2"] },
      { code: "M110", name: "شروع تولید انبوه", phase: "تولید انبوه", duration: 0, milestone: true, preds: ["M90", "M100"] },
    ],
    milestones: [
      { name: "پایان مونتاژ خط", activityCode: "M70" },
      { name: "تأیید نمونه کیفی", activityCode: "M90" },
      { name: "شروع تولید انبوه", activityCode: "M110" },
    ],
    risks: [
      { title: "تأخیر ساخت تجهیزات سفارشی", category: "تأمین", probability: 4, impact: 5, scheduleImpact: 20, costImpact: 250_000_000, mitigation: "قرارداد با جریمه تأخیر و بازدید میانی کارخانه سازنده" },
      { title: "عدم تأیید کیفی نمونه اولیه", category: "کیفیت", probability: 3, impact: 4, scheduleImpact: 10, costImpact: 80_000_000, mitigation: "تست‌های میانی و کنترل ابعادی حین ساخت" },
    ],
  },
  {
    id: "research",
    title: "پژوهش / پایان‌نامه",
    icon: "🔬",
    tagline: "از طرح مسئله تا دفاع و انتشار مقاله",
    domain: "research",
    complexity: "ساده",
    typicalWorkingDays: 134,
    audience: ["پژوهشگر", "استاد راهنما", "دانشجو"],
    currency: "IRR",
    phases: ["طرح مسئله", "مرور ادبیات", "روش‌شناسی و داده", "تحلیل", "نگارش و انتشار"],
    resources: [
      R("استاد راهنما", "labor", 0, 1),
      R("پژوهشگر", "labor", 0, 1),
      R("دستیار داده", "labor", 0, 2),
      R("هزینه آزمایش و نرم‌افزار", "cost", 1_500_000, 20),
    ],
    activities: [
      { code: "R10", name: "تعریف مسئله و اهداف پژوهش", phase: "طرح مسئله", duration: 7, res: ["r2:1", "r1:1"] },
      { code: "R20", name: "تهیه و تأیید پروپوزال", phase: "طرح مسئله", duration: 10, res: ["r2:1"], preds: ["R10"] },
      { code: "R30", name: "دفاع از پروپوزال", phase: "طرح مسئله", duration: 0, milestone: true, preds: ["R20"] },
      { code: "R40", name: "مرور نظام‌مند ادبیات", phase: "مرور ادبیات", duration: 20, res: ["r2:1"], preds: ["R30"] },
      { code: "R50", name: "تدوین چارچوب نظری", phase: "مرور ادبیات", duration: 10, res: ["r2:1", "r1:1"], preds: ["R40:SS+10"] },
      { code: "R60", name: "طراحی روش‌شناسی", phase: "روش‌شناسی و داده", duration: 8, res: ["r2:1"], preds: ["R50"] },
      { code: "R70", name: "گردآوری داده / آزمایش", phase: "روش‌شناسی و داده", duration: 25, res: ["r2:1", "r3:1", "r4:10"], preds: ["R60"] },
      { code: "R80", name: "پاک‌سازی و آماده‌سازی داده", phase: "روش‌شناسی و داده", duration: 8, res: ["r3:2"], preds: ["R70"] },
      { code: "R90", name: "تحلیل داده و مدل‌سازی", phase: "تحلیل", duration: 18, res: ["r2:1", "r3:1"], preds: ["R80"] },
      { code: "R100", name: "اعتبارسنجی نتایج", phase: "تحلیل", duration: 10, res: ["r2:1", "r1:1"], preds: ["R90"] },
      { code: "R110", name: "نگارش فصل‌های پایان‌نامه", phase: "نگارش و انتشار", duration: 22, res: ["r2:1"], preds: ["R100:SS+8"] },
      { code: "R120", name: "تهیه مقاله علمی", phase: "نگارش و انتشار", duration: 12, res: ["r2:1"], preds: ["R110:SS+10"] },
      { code: "R130", name: "دفاع نهایی", phase: "نگارش و انتشار", duration: 0, milestone: true, preds: ["R110", "R120"] },
    ],
    milestones: [
      { name: "تأیید پروپوزال", activityCode: "R30" },
      { name: "پایان تحلیل", activityCode: "R100" },
      { name: "دفاع نهایی", activityCode: "R130" },
    ],
    risks: [
      { title: "دسترسی نیافتن به داده یا نمونه کافی", category: "داده", probability: 3, impact: 4, scheduleImpact: 20, costImpact: 15_000_000, mitigation: "دستیابی به منابع ثانویه و بازتعریف جامعه آماری" },
      { title: "بازنگری در دیدگاه داوران", category: "ذی‌نفعان", probability: 3, impact: 3, scheduleImpact: 10, costImpact: 0, mitigation: "جلسات منظم با استاد راهنما و مستندسازی بازخوردها" },
    ],
  },
  {
    id: "event",
    title: "برگزاری رویداد / کنفرانس",
    icon: "🎪",
    tagline: "برنامه‌ریزی دقیق تا روز رویداد",
    domain: "event",
    complexity: "ساده",
    typicalWorkingDays: 42,
    audience: ["مدیر رویداد", "اسپانسر", "تیم اجرایی"],
    currency: "IRR",
    phases: ["طراحی رویداد", "تأمین و قرارداد", "بازاریابی", "آماده‌سازی اجرا", "روز رویداد و جمع‌بندی"],
    resources: [
      R("مدیر رویداد", "labor", 6_000_000, 2),
      R("تیم اجرایی", "labor", 2_000_000, 20),
      R("تیم بازاریابی", "labor", 3_000_000, 5),
      R("تجهیزات و سالن", "equipment", 8_000_000, 10),
    ],
    activities: [
      { code: "E10", name: "تعریف هدف، مخاطب و فرمت رویداد", phase: "طراحی رویداد", duration: 4, res: ["r1:1"] },
      { code: "E20", name: "انتخاب تاریخ و مکان", phase: "طراحی رویداد", duration: 6, res: ["r1:1"], preds: ["E10"] },
      { code: "E30", name: "بودجه‌بندی و تعیین حق ثبت‌نام", phase: "طراحی رویداد", duration: 4, res: ["r1:1"], preds: ["E20"] },
      { code: "E40", name: "قرارداد با سالن و تجهیزات", phase: "تأمین و قرارداد", duration: 8, res: ["r1:1", "r4:5"], preds: ["E30"] },
      { code: "E50", name: "دعوت سخنرانان و تأیید برنامه", phase: "تأمین و قرارداد", duration: 12, res: ["r1:1"], preds: ["E30"] },
      { code: "E60", name: "کمپین تبلیغاتی و ثبت‌نام", phase: "بازاریابی", duration: 20, res: ["r3:4"], preds: ["E40:SS+3"] },
      { code: "E70", name: "طراحی هویت بصری و محتوا", phase: "بازاریابی", duration: 10, res: ["r3:2"], preds: ["E20"] },
      { code: "E80", name: "برنامه‌ریزی اجرایی و پرسنل", phase: "آماده‌سازی اجرا", duration: 7, res: ["r1:1", "r2:8"], preds: ["E60", "E50"] },
      { code: "E90", name: "چیدمان سالن و تمرین", phase: "آماده‌سازی اجرا", duration: 3, res: ["r2:15", "r4:8"], preds: ["E80"] },
      { code: "E100", name: "برگزاری رویداد", phase: "روز رویداد و جمع‌بندی", duration: 1, res: ["r2:20", "r4:10", "r1:2"], preds: ["E90"] },
      { code: "E110", name: "جمع‌بندی، نظرسنجی و گزارش", phase: "روز رویداد و جمع‌بندی", duration: 5, res: ["r1:1", "r3:2"], preds: ["E100"] },
    ],
    milestones: [
      { name: "تأیید مکان و تاریخ", activityCode: "E20" },
      { name: "پایان ثبت‌نام", activityCode: "E60" },
      { name: "روز رویداد", activityCode: "E100" },
    ],
    risks: [
      { title: "عدم رسیدن به تعداد ثبت‌نام هدف", category: "بازاریابی", probability: 3, impact: 4, scheduleImpact: 0, costImpact: 90_000_000, mitigation: "کمپین زودهنگام و تخفیف ثبت‌نام زودهنگام" },
      { title: "لغو سخنران کلیدی", category: "ذی‌نفعان", probability: 2, impact: 4, scheduleImpact: 3, costImpact: 20_000_000, mitigation: "لیست جایگزین سخنرانان" },
    ],
  },
  {
    id: "renovation",
    title: "نوسازی و بازسازی ساختمان",
    icon: "🧰",
    tagline: "بازسازی، مقاوم‌سازی و بهسازی با کنترل تداخل و ایمنی",
    domain: "construction",
    complexity: "متوسط",
    typicalWorkingDays: 55,
    audience: ["پیمانکار نوسازی", "مالک", "مدیر فنی"],
    currency: "IRR",
    phases: ["ارزیابی و طراحی نوسازی", "تخریب و تخلیه", "مقاوم‌سازی و اصلاح سازه", "بازسازی و تأسیسات", "تکمیل و تحویل"],
    resources: [
      R("کارگر ساختمانی", "labor", 18_000_000, 20),
      R("استادکار بازسازی", "labor", 34_000_000, 6),
      R("مهندس ناظر اجرا", "labor", 26_000_000, 2),
      R("مصالح نوسازی", "material", 6_000_000, 120),
    ],
    activities: [
      { code: "N10", name: "ارزیابی وضع موجود و آسیب‌شناسی", phase: "ارزیابی و طراحی نوسازی", duration: 6, res: ["r3:1"] },
      { code: "N20", name: "طراحی نوسازی و اخذ مجوز", phase: "ارزیابی و طراحی نوسازی", duration: 12, res: ["r3:1"], preds: ["N10"] },
      { code: "N30", name: "تأیید طرح نوسازی", phase: "ارزیابی و طراحی نوسازی", duration: 0, milestone: true, preds: ["N20"] },
      { code: "N40", name: "تجهیز سایت و حفاظت از اجزای موجود", phase: "تخریب و تخلیه", duration: 5, res: ["r1:8"], preds: ["N30"] },
      { code: "N50", name: "تخریب‌های انتخابی و تخلیه نخاله", phase: "تخریب و تخلیه", duration: 10, res: ["r1:10", "r4:15"], preds: ["N40"] },
      { code: "N60", name: "مقاوم‌سازی سازه (ژاکت و دیوار برشی)", phase: "مقاوم‌سازی و اصلاح سازه", duration: 20, res: ["r2:4", "r4:40"], preds: ["N50"] },
      { code: "N70", name: "اصلاح تأسیسات مکانیکی و برقی", phase: "بازسازی و تأسیسات", duration: 18, res: ["r2:3", "r1:6"], preds: ["N60:SS+6"] },
      { code: "N80", name: "بازسازی نازک‌کاری و کف‌سازی", phase: "بازسازی و تأسیسات", duration: 22, res: ["r2:5", "r1:8"], preds: ["N70:SS+5"] },
      { code: "N90", name: "نصب درب، پنجره و پوشش نما", phase: "تکمیل و تحویل", duration: 12, res: ["r2:3", "r4:20"], preds: ["N80"] },
      { code: "N100", name: "پاکسازی، تست و رفع نقص", phase: "تکمیل و تحویل", duration: 6, res: ["r3:1", "r1:4"], preds: ["N90"] },
      { code: "N110", name: "تحویل نوسازی", phase: "تکمیل و تحویل", duration: 0, milestone: true, preds: ["N100"] },
    ],
    milestones: [
      { name: "تأیید طرح نوسازی", activityCode: "N30" },
      { name: "پایان مقاوم‌سازی", activityCode: "N60" },
      { name: "تحویل نوسازی", activityCode: "N110" },
    ],
    risks: [
      { title: "آسیب‌های پنهان در سازه موجود", category: "فنی", probability: 4, impact: 4, scheduleImpact: 15, costImpact: 250_000_000, mitigation: "اسکن‌های تکمیلی و ذخیره احتیاطی در بودجه" },
      { title: "تداخل سکونت و اجرا", category: "ذی‌نفعان", probability: 3, impact: 3, scheduleImpact: 10, costImpact: 40_000_000, mitigation: "برنامه‌ریزی مرحله‌ای و هماهنگی با ساکنان" },
    ],
  },
  {
    id: "general",
    title: "پروژه عمومی",
    icon: "📁",
    tagline: "ساختار ساده و قابل تنظیم برای هر نوع پروژه",
    domain: "technology",
    complexity: "ساده",
    typicalWorkingDays: 37,
    audience: ["مدیر پروژه", "تیم اجرایی"],
    currency: "IRR",
    phases: ["شروع پروژه", "برنامه‌ریزی", "اجرا", "پایان"],
    resources: [R("مدیر پروژه", "labor", 5_000_000, 2), R("عضو تیم", "labor", 2_500_000, 10), R("بودجه اجرا", "cost", 1_000_000, 50)],
    activities: [
      { code: "G10", name: "تعریف محدوده و اهداف پروژه", phase: "شروع پروژه", duration: 3, res: ["r1:1"] },
      { code: "G20", name: "شناسایی ذی‌نفعان", phase: "شروع پروژه", duration: 2, res: ["r1:1"], preds: ["G10"] },
      { code: "G30", name: "برنامه‌ریزی فعالیت‌ها و زمان‌بندی", phase: "برنامه‌ریزی", duration: 5, res: ["r1:1", "r2:2"], preds: ["G20"] },
      { code: "G40", name: "تخصیص منابع و بودجه", phase: "برنامه‌ریزی", duration: 4, res: ["r1:1", "r3:10"], preds: ["G30"] },
      { code: "G50", name: "تأیید برنامه پروژه", phase: "برنامه‌ریزی", duration: 0, milestone: true, preds: ["G40"] },
      { code: "G60", name: "اجرای بسته کاری ۱", phase: "اجرا", duration: 10, res: ["r2:4"], preds: ["G50"] },
      { code: "G70", name: "اجرای بسته کاری ۲", phase: "اجرا", duration: 10, res: ["r2:4"], preds: ["G60"] },
      { code: "G80", name: "پایش و کنترل دوره‌ای", phase: "اجرا", duration: 18, res: ["r1:1"], preds: ["G60:SS+2"] },
      { code: "G90", name: "تحویل خروجی نهایی", phase: "پایان", duration: 0, milestone: true, preds: ["G70", "G80"] },
      { code: "G100", name: "جمع‌بندی درس‌آموخته‌ها", phase: "پایان", duration: 3, res: ["r1:1", "r2:3"], preds: ["G90"] },
    ],
    milestones: [{ name: "تأیید برنامه پروژه", activityCode: "G50" }, { name: "تحویل نهایی", activityCode: "G90" }],
    risks: [
      { title: "تغییر محدوده پروژه", category: "ذی‌نفعان", probability: 3, impact: 3, scheduleImpact: 7, costImpact: 30_000_000, mitigation: "فرآیند رسمی تغییر محدوده" },
      { title: "کمبود منابع انسانی", category: "منابع", probability: 3, impact: 3, scheduleImpact: 6, costImpact: 20_000_000, mitigation: "برنامه ذخیره نیروی احتیاطی" },
    ],
  },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

function parseDependency(ref: string, codeToId: Map<string, string>) {
  const [idPart, modifier] = ref.split(":");
  const predecessorId = codeToId.get(idPart.trim()) ?? idPart.trim();
  let type = "FS";
  let lag = 0;
  if (modifier) {
    const match = /^(FS|SS|FF|SF)?([+-]\d+)?$/.exec(modifier.trim());
    if (match) {
      if (match[1]) type = match[1];
      if (match[2]) lag = Number(match[2]);
    }
  }
  return {
    predecessorId,
    type: type as DependencyType,
    lag,
  };
}

/** Builds a full, ready-to-analyze project input from a template. */
export function buildProjectFromTemplate(
  templateId: string,
  overrides: Partial<ProjectInput["meta"]> = {},
): ProjectInput {
  const template = getTemplate(templateId) ?? TEMPLATES[TEMPLATES.length - 1];
  const today = new Date().toISOString().slice(0, 10);

  const rateKeys = TEMPLATE_RATE_KEYS[template.id] ?? [];
  const resources: ResourceInput[] = template.resources.map((r, i) => {
    const key = rateKeys[i] ?? guessRateKey(r.name);
    const item = key ? findRate(key) : undefined;
    if (!item) {
      return { ...r, id: `r${i + 1}`, rateKey: undefined, rateSource: "نرخ دستی کاربر" };
    }
    // نرخ قالب‌ها همیشه از فهرست نرخ بازار ایران خوانده می‌شود
    const resolved = effectiveRate(
      { id: `r${i + 1}`, name: item.name, type: r.type, rate: r.rate, capacity: r.capacity, rateKey: item.key },
      DEFAULT_PRICING,
    );
    return {
      ...r,
      id: `r${i + 1}`,
      rateKey: item.key,
      unit: item.unit,
      rate: resolved.rate,
      rateSource: resolved.source,
    };
  });

  const codeToId = new Map<string, string>();
  template.activities.forEach((a, i) => codeToId.set(a.code, `a${i + 1}`));

  const activities = template.activities.map((a, i) => ({
    id: `a${i + 1}`,
    code: a.code,
    name: a.name,
    phase: a.phase,
    duration: a.duration,
    predecessors: (a.preds ?? []).map((p) => parseDependency(p, codeToId)),
    progress: a.progress ?? 0,
    resources: (a.res ?? []).map((r) => {
      const [id, units] = r.split(":");
      return { resourceId: id, units: Number(units ?? 1) };
    }),
    fixedCost: a.fixedCost ?? 0,
    materialCost: 0,
    constraintType: "ASAP" as const,
    milestone: Boolean(a.milestone),
    notes: a.notes,
  }));

  const milestones = template.milestones.map((m, i) => ({
    id: `m${i + 1}`,
    name: m.name,
    activityId: m.activityCode ? codeToId.get(m.activityCode) : undefined,
    phase: template.activities.find((a) => a.code === m.activityCode)?.phase,
  }));

  const risks = template.risks.map((r, i) => ({ ...r, id: `k${i + 1}` }));

  return {
    meta: {
      name: `پروژه ${template.title}`,
      type: template.id,
      currency: template.currency,
      startDate: today,
      statusDate: today,
      manager: "",
      description: template.tagline,
      ...overrides,
    },
    calendar: { workDays: [6, 0, 1, 2, 3], holidays: [], hoursPerDay: 8 },
    activities,
    resources,
    milestones,
    risks,
    baseline: null,
    pricing: { ...DEFAULT_PRICING },
  };
}
