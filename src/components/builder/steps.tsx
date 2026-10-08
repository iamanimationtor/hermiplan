"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, Input, ProgressBar, Select, StatTile, Textarea } from "@/components/ui";
import { ActivityTable } from "./ActivityTable";
import type { ProjectApi } from "./useProject";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import { DEFAULT_REPORT_SECTIONS, REPORT_SECTIONS } from "@/lib/validation";
import { TEMPLATES, type TemplateDomain } from "@/lib/templates";
import { marketCatalog } from "./useProject";
import { QuickAdd, ImportDialog } from "./QuickCapture";
import { ScenarioPanel } from "./ScenarioPanel";
import type { ProjectPricing } from "@/lib/engine/types";
import {
  formatCompact,
  formatJalali,
  formatPercent,
  isoToJalaliInput,
  jalaliInputToIso,
  toPersianDigits,
  WEEKDAY_LABELS,
} from "@/lib/date-fa";

/* ------------------------- shared date input ------------------------- */

export function JalaliDateInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  label: string;
}) {
  const [text, setText] = useState(isoToJalaliInput(value));

  // keep the visible text in sync when the project (template / saved draft) is
  // replaced from the outside, without fighting the user's own typing
  useEffect(() => {
    const parsed = jalaliInputToIso(text);
    if (parsed !== value) setText(isoToJalaliInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Field label={label} hint="تاریخ شمسی — نمونه: ۱۴۰۴/۰۵/۰۱">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const iso = jalaliInputToIso(e.target.value);
            if (iso) onChange(iso);
          }}
          dir="ltr"
          placeholder="1404/05/01"
        />
        <span className="whitespace-nowrap text-[11px] text-slate-500">{value}</span>
      </div>
    </Field>
  );
}

/* ----------------------------- step 1 -------------------------------- */

const DOMAIN_LABELS: { id: "all" | TemplateDomain; label: string; icon: string }[] = [
  { id: "all", label: "همه حوزه‌ها", icon: "◈" },
  { id: "construction", label: "ساختمان و نوسازی", icon: "🏗️" },
  { id: "infrastructure", label: "زیرساخت و عمران", icon: "🛣️" },
  { id: "design", label: "طراحی و معماری", icon: "📐" },
  { id: "technology", label: "نرم‌افزار و فناوری", icon: "💻" },
  { id: "industry", label: "صنعت و تولید", icon: "🏭" },
  { id: "research", label: "پژوهش", icon: "🔬" },
  { id: "event", label: "رویداد", icon: "🎪" },
];

export function StepBasics({ project, api }: { project: ProjectInput; api: ProjectApi }) {
  const [domain, setDomain] = useState<"all" | TemplateDomain>("all");
  const [complexity, setComplexity] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | "short" | "long" | "simple">("default");

  const filtered = useMemo(() => {
    const list = TEMPLATES.filter((template) => {
      if (domain !== "all" && template.domain !== domain) return false;
      if (complexity !== "all" && template.complexity !== complexity) return false;
      if (query.trim()) {
        const haystack = `${template.title} ${template.tagline} ${template.phases.join(" ")}`;
        if (!haystack.includes(query.trim())) return false;
      }
      return true;
    });
    if (sort === "short") return [...list].sort((a, b) => a.typicalWorkingDays - b.typicalWorkingDays);
    if (sort === "long") return [...list].sort((a, b) => b.typicalWorkingDays - a.typicalWorkingDays);
    if (sort === "simple") {
      const rank = { ساده: 0, متوسط: 1, پیچیده: 2 } as const;
      return [...list].sort((a, b) => rank[a.complexity] - rank[b.complexity]);
    }
    return list;
  }, [domain, complexity, query, sort]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="نوع پروژه را انتخاب کنید"
          subtitle="با انتخاب هر نوع، ساختار WBS، فهرست فعالیت‌ها، منابع، نرخ‌های بازار ایران و ریسک‌های پیشنهادی به‌صورت حرفه‌ای ساخته می‌شود."
          icon={<span className="text-lg">🧩</span>}
          action={<Badge tone="info">{toPersianDigits(filtered.length)} قالب از {toPersianDigits(TEMPLATES.length)}</Badge>}
        />
        <div className="space-y-3 border-b border-slate-100 p-5">
          <div className="flex flex-wrap gap-1.5">
            {DOMAIN_LABELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDomain(item.id)}
                className={`rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
                  domain === item.id
                    ? "border-brand-500 bg-brand-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"
                }`}
              >
                <span className="me-1">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در قالب‌ها (مثلاً پل، نوسازی، نرم‌افزار)…"
              className="h-10 max-w-[280px] py-2"
            />
            <Select value={complexity} onChange={(e) => setComplexity(e.target.value)} className="h-10 max-w-[170px] py-2">
              <option value="all">هر سطح پیچیدگی</option>
              <option value="ساده">ساده</option>
              <option value="متوسط">متوسط</option>
              <option value="پیچیده">پیچیده</option>
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-10 max-w-[200px] py-2">
              <option value="default">مرتب‌سازی: پیشنهادی</option>
              <option value="short">کوتاه‌ترین مدت</option>
              <option value="long">بلندترین مدت</option>
              <option value="simple">ساده‌ترین ساختار</option>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => {
            const active = project.meta.type === template.id;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  if (
                    project.activities.length > 0 &&
                    !window.confirm(
                      `قالب «${template.title}» جایگزین ${toPersianDigits(project.activities.length)} فعالیت فعلی می‌شود. ادامه می‌دهید؟ (با واگردانی قابل بازگشت است)`,
                    )
                  ) {
                    return;
                  }
                  api.loadTemplate(template.id, false);
                }}
                className={`group rounded-2xl border p-4 text-right transition ${
                  active
                    ? "border-brand-500 bg-brand-50/70 shadow-[0_0_0_3px_rgb(45_99_160_/_0.12)]"
                    : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{template.icon}</span>
                  {active ? <Badge tone="info">قالب فعال</Badge> : <Badge>{template.complexity}</Badge>}
                </div>
                <h4 className="mt-3 text-[14px] font-bold text-ink-900">{template.title}</h4>
                <p className="mt-1 text-[11.5px] leading-6 text-slate-500">{template.tagline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="accent">{toPersianDigits(template.typicalWorkingDays)} روز کاری</Badge>
                  <Badge>{toPersianDigits(template.phases.length)} فاز</Badge>
                  <Badge>{toPersianDigits(template.activities.length)} فعالیت</Badge>
                  <Badge>{toPersianDigits(template.resources.length)} منبع</Badge>
                </div>
                <p className="mt-2 truncate text-[10.5px] text-slate-500">
                  مناسب برای: {template.audience.join("، ")}
                </p>
              </button>
            );
          })}
          {!filtered.length ? (
            <div className="col-span-full py-10 text-center text-[13px] text-slate-500">
              قالبی با این فیلترها یافت نشد. فیلترها را تغییر دهید.
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="مشخصات پروژه" subtitle="این اطلاعات در سربرگ و صفحات گزارش حرفه‌ای شما استفاده می‌شود." icon={<span className="text-lg">📋</span>} />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="نام پروژه" className="md:col-span-2">
            <Input value={project.meta.name} onChange={(e) => api.setMeta({ name: e.target.value })} />
          </Field>
          <Field label="کد / شماره قرارداد">
            <Input value={project.meta.code ?? ""} onChange={(e) => api.setMeta({ code: e.target.value })} dir="ltr" />
          </Field>
          <Field label="مدیر پروژه">
            <Input value={project.meta.manager ?? ""} onChange={(e) => api.setMeta({ manager: e.target.value })} />
          </Field>
          <Field label="کارفرما">
            <Input value={project.meta.client ?? ""} onChange={(e) => api.setMeta({ client: e.target.value })} />
          </Field>
          <Field label="پیمانکار">
            <Input value={project.meta.contractor ?? ""} onChange={(e) => api.setMeta({ contractor: e.target.value })} />
          </Field>
          <Field label="مشاور / ناظر">
            <Input value={project.meta.consultant ?? ""} onChange={(e) => api.setMeta({ consultant: e.target.value })} />
          </Field>
          <Field label="موقعیت پروژه">
            <Input value={project.meta.location ?? ""} onChange={(e) => api.setMeta({ location: e.target.value })} />
          </Field>
          <JalaliDateInput
            label="تاریخ شروع پروژه"
            value={project.meta.startDate}
            onChange={(iso) => api.setMeta({ startDate: iso })}
          />
          <JalaliDateInput
            label="تاریخ وضعیت (تاریخ گزارش)"
            value={project.meta.statusDate}
            onChange={(iso) => api.setMeta({ statusDate: iso })}
          />
          {project.meta.deadline ? (
            <div className="flex items-end gap-2">
              <JalaliDateInput
                label="تاریخ هدف پایان (قراردادی)"
                value={project.meta.deadline}
                onChange={(iso) => api.setMeta({ deadline: iso })}
              />
              <Button variant="ghost" size="sm" onClick={() => api.setMeta({ deadline: undefined })}>
                حذف هدف
              </Button>
            </div>
          ) : (
            <Field label="تاریخ هدف پایان (اختیاری)" hint="با ثبت آن، انحراف برنامه از موعد قراردادی محاسبه می‌شود">
              <Button variant="secondary" onClick={() => api.setMeta({ deadline: project.meta.startDate })}>
                تعیین تاریخ هدف پایان
              </Button>
            </Field>
          )}
          <Field label="واحد پول">
            <Select value={project.meta.currency} onChange={(e) => api.setMeta({ currency: e.target.value as ProjectInput["meta"]["currency"] })}>
              <option value="IRR">ریال (IRR)</option>
              <option value="USD">دلار (USD)</option>
              <option value="EUR">یورو (EUR)</option>
            </Select>
          </Field>
          <Field label="بودجه مصوب (اختیاری)">
            <Input
              type="number"
              min={0}
              value={project.meta.budget ?? 0}
              onChange={(e) => api.setMeta({ budget: Number(e.target.value) })}
            />
          </Field>
          <Field label="توضیح پروژه" className="md:col-span-2">
            <Textarea value={project.meta.description ?? ""} onChange={(e) => api.setMeta({ description: e.target.value })} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------- بازار و قیمت‌گذاری ------------------------ */

const CATALOG = marketCatalog();

interface MarketFeed {
  asOfJalali: string;
  isLive: boolean;
  feedConfigured: boolean;
  sources: string[];
  indices: { label: string; value: number; change: string }[];
}

export function PricingPanel({ project, analysis, api }: { project: ProjectInput; analysis: ProjectAnalysis; api: ProjectApi }) {
  const [feed, setFeed] = useState<MarketFeed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const pricing: ProjectPricing = { ...{ series: "official-1405", region: "tehran", indexFactor: 100, escalationEnabled: true, escalationRatePerMonth: 3, overheadPercent: 17, profitPercent: 10, contingencyPercent: 5 }, ...project.pricing };

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/market?refresh=1");
      setFeed((await response.json()) as MarketFeed);
    } catch {
      setFeed(null);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetch("/api/market")
      .then((r) => r.json())
      .then((data: MarketFeed) => setFeed(data))
      .catch(() => setFeed(null));
  }, []);

  const p = analysis.pricing;

  return (
    <Card>
      <CardHeader
        title="قیمت‌گذاری بر مبنای بازار ایران"
        subtitle="نرخ‌های نیروی انسانی، ماشین‌آلات و مصالح بر پایه مصوبات رسمی و میانگین بازار، همراه با تعدیل ماهانه."
        icon={<span className="text-lg">📈</span>}
        action={
          <Badge tone={feed?.isLive ? "ok" : "info"}>
            {feed?.isLive ? "قیمت لحظه‌ای" : `نرخ مرجع ${feed?.asOfJalali ?? "…"}`}
          </Badge>
        }
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="مبنای دستمزد">
            <Select value={pricing.series} onChange={(e) => api.setPricing({ series: e.target.value as ProjectPricing["series"] })}>
              <option value="official-1405">مصوب رسمی ۱۴۰۵</option>
              <option value="official-1404">مصوب رسمی ۱۴۰۴</option>
              <option value="market">میانگین بازار آزاد</option>
            </Select>
          </Field>
          <Field label="منطقه اجرا">
            <Select value={pricing.region} onChange={(e) => api.setPricing({ region: e.target.value as ProjectPricing["region"] })}>
              <option value="tehran">تهران</option>
              <option value="metro">کلان‌شهرها</option>
              <option value="other">سایر شهرها</option>
            </Select>
          </Field>
          <Field label="ضریب تعدیل عمومی (٪)">
            <Input
              type="number"
              min={10}
              max={1000}
              value={pricing.indexFactor}
              onChange={(e) => api.setPricing({ indexFactor: Number(e.target.value) })}
            />
          </Field>
          <Field label="نرخ تعدیل ماهانه (٪)">
            <Input
              type="number"
              min={0}
              max={30}
              value={pricing.escalationRatePerMonth}
              onChange={(e) => api.setPricing({ escalationRatePerMonth: Number(e.target.value) })}
            />
          </Field>
          <Field label="هزینه‌های بالاسری (٪)">
            <Input type="number" min={0} max={200} value={pricing.overheadPercent} onChange={(e) => api.setPricing({ overheadPercent: Number(e.target.value) })} />
          </Field>
          <Field label="سود پیمانکار (٪)">
            <Input type="number" min={0} max={200} value={pricing.profitPercent} onChange={(e) => api.setPricing({ profitPercent: Number(e.target.value) })} />
          </Field>
          <Field label="ذخیره احتیاطی (٪)">
            <Input type="number" min={0} max={200} value={pricing.contingencyPercent} onChange={(e) => api.setPricing({ contingencyPercent: Number(e.target.value) })} />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => api.applyMarketRates()} className="flex-1">اعمال نرخ بازار</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => api.setPricing({ escalationEnabled: !pricing.escalationEnabled })}
            className={`rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition ${
              pricing.escalationEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {pricing.escalationEnabled ? "✓ تعدیل قیمت فعال است" : "تعدیل قیمت غیرفعال است"}
          </button>
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            title={
              feed?.feedConfigured
                ? "خواندن مجدد نرخ‌ها از فید لحظه‌ای"
                : "فید لحظه‌ای در تنظیمات سرور ثبت نشده است؛ نسخه مرجع نمایش داده می‌شود"
            }
          >
            {refreshing ? "در حال به‌روزرسانی…" : "به‌روزرسانی نرخ بازار"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowCatalog((v) => !v)}>
            {showCatalog ? "بستن فهرست نرخ" : "نمایش فهرست نرخ بازار"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="هزینه‌های مستقیم" value={formatCompact(p.breakdown.direct)} />
          <StatTile label="بالاسری + سود + احتیاط" value={formatCompact(p.breakdown.overhead + p.breakdown.profit + p.breakdown.contingency)} />
          <StatTile label="تعدیل قیمت" value={formatCompact(p.breakdown.escalation)} tone={p.breakdown.escalation > 0 ? "warn" : "neutral"} hint={`${toPersianDigits(p.escalationRatePerMonth)}٪ ماهانه`} />
          <StatTile label="برآورد نهایی پروژه" value={formatCompact(p.breakdown.total)} tone="accent" hint="مبنای پیشنهاد قیمت و مندرجات قرارداد" />
        </div>

        {p.escalation.months.length ? (
          <div className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-2.5 text-[12.5px] font-bold text-ink-900">
              جدول تعدیل بر پایه کارکرد ماهانه
            </div>
            <div className="thin-scroll max-h-[240px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    {["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب", "مبلغ تعدیل"].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.escalation.months.map((m) => (
                    <tr key={m.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold">{m.label}</td>
                      <td className="px-3 py-2 text-slate-500">{toPersianDigits(m.workingDays)}</td>
                      <td className="px-3 py-2">{formatCompact(m.plannedValue)}</td>
                      <td className="px-3 py-2 text-slate-500">{toPersianDigits(m.factor)}</td>
                      <td className="px-3 py-2 font-semibold text-amber-700">{formatCompact(m.escalation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {feed && !feed.feedConfigured ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] leading-6 text-slate-500">
            فید لحظه‌ای بازار فعال نیست؛ نرخ‌های نمایش‌داده‌شده نسخه مرجع ({feed.asOfJalali}) هستند و برای پروژه شما قابل
            اصلاح‌اند (ضریب تعدیل، منطقه و نرخ هر منبع).
          </p>
        ) : null}

        {showCatalog ? (
          <div className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-100 px-4 py-2.5 text-[12.5px] font-bold text-ink-900">
              فهرست نرخ بازار ایران — {feed?.asOfJalali ?? "نسخه مرجع"}
            </div>
            <div className="thin-scroll max-h-[300px] overflow-y-auto p-3">
              <table className="w-full text-[11.5px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["شرح", "دسته", "واحد", "مصوب ۱۴۰۵", "بازار آزاد"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-right font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CATALOG.map((item) => (
                    <tr key={item.key} className="border-t border-slate-100">
                      <td className="px-2.5 py-1.5">{item.name}</td>
                      <td className="px-2.5 py-1.5 text-slate-500">
                        {item.category === "labor" ? "نیروی انسانی" : item.category === "equipment" ? "ماشین‌آلات" : "مصالح"}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-500">{item.unit}</td>
                      <td className="px-2.5 py-1.5">{item.official1405 ? formatCompact(item.official1405) : "—"}</td>
                      <td className="px-2.5 py-1.5 font-semibold">{formatCompact(item.market)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] leading-6 text-slate-500">
              منابع: {feed?.sources?.join(" • ") ?? "مصوبه شورای عالی کار، فهرست‌بهای واحد پایه، میانگین بازار مصالح"}
              {feed?.feedConfigured ? " — فید لحظه‌ای فعال است." : " — برای اتصال فید لحظه‌ای، آدرس فید را در تنظیمات سرور ثبت کنید."}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ----------------------------- step 2 -------------------------------- */

export function StepActivities({ project, analysis, api }: { project: ProjectInput; analysis: ProjectAnalysis; api: ProjectApi }) {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="space-y-5">
      {analysis.warnings.length || analysis.errors.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12.5px] leading-6 text-amber-800">
          {analysis.errors.map((e) => (
            <p key={e}>⛔ {e}</p>
          ))}
          {analysis.warnings.map((w) => (
            <p key={w}>⚠️ {w}</p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="تعداد فعالیت" value={toPersianDigits(analysis.activities.length)} hint={`${toPersianDigits(analysis.schedule.phases.length)} فاز کاری`} />
        <StatTile label="مدت پروژه" value={`${toPersianDigits(analysis.schedule.workingDays)} روز کاری`} hint={`پایان: ${formatJalali(analysis.schedule.finishDate, { withMonthName: false })}`} />
        <StatTile
          label="فعالیت‌های بحرانی"
          value={toPersianDigits(analysis.criticalPath.length)}
          tone={analysis.criticalPath.length ? "bad" : "neutral"}
          hint="شناوری صفر روز کاری"
        />
        <StatTile label="بودجه تجمیعی" value={formatCompact(analysis.costs.budget)} tone="accent" hint="شامل منابع، مصالح و هزینه ثابت" />
      </div>

      <Card>
        <CardHeader
          title="فعالیت‌ها و ساختار شکست کار"
          subtitle="فقط عنوان و مدت را وارد کنید؛ زمان‌بندی، شناوری و مسیر بحرانی به‌صورت خودکار محاسبه می‌شود."
          icon={<span className="text-lg">🧱</span>}
          action={<Badge tone="info">ویرایش زنده</Badge>}
        />
        <div className="space-y-4 p-5">
          <QuickAdd project={project} api={api} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              📥 درون‌ریزی از اکسل / متن
            </Button>
            <Button variant="secondary" size="sm" onClick={() => api.addActivity()}>
              + فعالیت دستی
            </Button>
            <Button variant="ghost" size="sm" onClick={() => api.addMilestone()}>
              + نقطه کنترل
            </Button>
            <span className="ms-auto text-[11px] text-slate-500">
              میان‌بر: در فیلد بالا نام را بنویسید و Enter بزنید
            </span>
          </div>
          <ActivityTable project={project} analysis={analysis} api={api} />
        </div>
      </Card>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} project={project} api={api} />
    </div>
  );
}

/* ----------------------------- step 3 -------------------------------- */

export function StepResources({ project, analysis, api }: { project: ProjectInput; analysis: ProjectAnalysis; api: ProjectApi }) {
  return (
    <div className="space-y-5">
      <PricingPanel project={project} analysis={analysis} api={api} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="منابع تعریف‌شده" value={toPersianDigits(project.resources.length)} />
        <StatTile label="هزینه منابع" value={formatCompact(analysis.resources.reduce((s, r) => s + r.cost, 0))} />
        <StatTile
          label="منابع بیش از ظرفیت"
          value={toPersianDigits(analysis.overallocatedResources)}
          tone={analysis.overallocatedResources ? "bad" : "ok"}
          hint={analysis.overallocatedResources ? "نیاز به هموارسازی منابع" : "تخصیص متعادل"}
        />
        <StatTile label="هزینه پیش‌بینی تا پایان" value={formatCompact(analysis.costs.estimateAtCompletion)} tone="accent" />
      </div>

      <Card>
        <CardHeader title="منابع پروژه" subtitle="نرخ روزانه و ظرفیت مجاز هر منبع را وارد کنید؛ هزینه‌ها و بار کاری به‌صورت خودکار محاسبه می‌شود." icon={<span className="text-lg">👷</span>} />
        <div className="p-5">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  {["نام منبع", "نوع", "نرخ بازار", "نرخ روزانه", "ظرفیت مجاز", "واحد-روز", "اوج تخصیص", "بهره‌وری", "هزینه"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-right font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {project.resources.map((resource) => {
                  const row = analysis.resources.find((r) => r.id === resource.id);
                  const over = row?.overallocated;
                  return (
                    <tr key={resource.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <Input value={resource.name} onChange={(e) => api.updateResource(resource.id, { name: e.target.value })} className="min-w-[160px] py-1.5" />
                        {resource.rateSource ? (
                          <span className="mt-1 block text-[10px] text-slate-500">{resource.rateSource}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={resource.rateKey ?? ""}
                          onChange={(e) => api.linkResourceRate(resource.id, e.target.value)}
                          className="min-w-[170px] py-1.5 text-[11.5px]"
                        >
                          <option value="">— بدون اتصال —</option>
                          {CATALOG.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={resource.type}
                          onChange={(e) => api.updateResource(resource.id, { type: e.target.value as ProjectInput["resources"][number]["type"] })}
                          className="min-w-[120px] py-1.5"
                        >
                          <option value="labor">نیروی انسانی</option>
                          <option value="equipment">ماشین‌آلات</option>
                          <option value="material">مصالح</option>
                          <option value="cost">هزینه / خدمات</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={0} value={resource.rate} onChange={(e) => api.updateResource(resource.id, { rate: Number(e.target.value) })} className="w-32 py-1.5" />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={0} value={resource.capacity} onChange={(e) => api.updateResource(resource.id, { capacity: Number(e.target.value) })} className="w-24 py-1.5" />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{toPersianDigits(row?.totalUnits ?? 0)}</td>
                      <td className="px-3 py-2">
                        {over ? <Badge tone="bad">{toPersianDigits(row?.peakUnits ?? 0)} ⚠</Badge> : <span className="text-slate-600">{toPersianDigits(row?.peakUnits ?? 0)}</span>}
                      </td>
                      <td className="w-[120px] px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={row?.utilization ?? 0} tone={over ? "bad" : "info"} />
                          <span className="w-10 text-[11px] text-slate-500">{formatPercent(row?.utilization ?? 0)}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700">{formatCompact(row?.cost ?? 0)}</td>
                    </tr>
                  );
                })}
                {!project.resources.length ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">منبعی تعریف نشده است.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => api.addResource()}>
              + افزودن منبع
            </Button>
            {!project.resources.length ? (
              <p className="text-[11.5px] text-slate-500">
                منبعی تعریف نشده است؛ در این حالت تنها هزینه‌های ثابت و مصالح فعالیت‌ها در برآورد لحاظ می‌شود.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="تحلیل هزینه فازها" subtitle="برآورد بودجه و هزینه واقعی هر فاز به‌صورت خودکار تجمیع شده است." icon={<span className="text-lg">💰</span>} />
        <div className="p-5">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                {["فاز", "تعداد فعالیت", "مدت", "پیشرفت", "بودجه", "هزینه واقعی"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-right font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.costs.byPhase.map((phase) => (
                <tr key={phase.phase} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-ink-900">{phase.phase}</td>
                  <td className="px-3 py-2 text-slate-500">{toPersianDigits(analysis.schedule.phases.find((p) => p.name === phase.phase)?.activityCount ?? 0)}</td>
                  <td className="px-3 py-2 text-slate-500">{toPersianDigits(analysis.schedule.phases.find((p) => p.name === phase.phase)?.duration ?? 0)} روز</td>
                  <td className="w-[140px] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={phase.progress} />
                      <span className="w-10 text-[11px]">{formatPercent(phase.progress)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatCompact(phase.budget)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatCompact(phase.actual)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-3 py-2.5" colSpan={4}>جمع کل</td>
                <td className="whitespace-nowrap px-3 py-2.5">{formatCompact(analysis.costs.budget)}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{formatCompact(analysis.costs.actual)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- step 4 -------------------------------- */

export function StepCalendar({ project, api }: { project: ProjectInput; api: ProjectApi }) {
  const days = [6, 0, 1, 2, 3, 4, 5];
  const toggleDay = (day: number) => {
    const current = project.calendar.workDays.includes(day)
      ? project.calendar.workDays.filter((d) => d !== day)
      : [...project.calendar.workDays, day];
    api.setCalendar({ workDays: current.sort() });
  };
  const holidays = project.calendar.holidays;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="تقویم کاری پروژه" subtitle="روزهای کاری، ساعت کار و تعطیلات را تعیین کنید؛ همه محاسبات زمان‌بندی بر اساس این تقویم انجام می‌شود." icon={<span className="text-lg">🗓️</span>} />
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <span className="mb-2 block text-[12.5px] font-semibold text-slate-700">روزهای کاری هفته</span>
            <div className="flex flex-wrap gap-2">
              {days.map((day) => {
                const active = project.calendar.workDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`min-w-[92px] rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition ${
                      active ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"
                    }`}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="ساعت کاری در هر روز">
            <Input
              type="number"
              min={1}
              max={24}
              value={project.calendar.hoursPerDay}
              onChange={(e) => api.setCalendar({ hoursPerDay: Number(e.target.value) })}
            />
          </Field>
          <div className="flex items-end">
            <Badge tone="info">
              {toPersianDigits(project.calendar.workDays.length)} روز کاری در هفته ·{" "}
              {toPersianDigits(project.calendar.workDays.length * project.calendar.hoursPerDay)} ساعت
            </Badge>
          </div>
          <div className="md:col-span-2">
            <Field label="روزهای تعطیل (تاریخ میلادی، با کاما جدا کنید)" hint="مثلاً 2026-03-21, 2026-03-22">
              <Input
                dir="ltr"
                value={holidays.join(", ")}
                onChange={(e) =>
                  api.setCalendar({
                    holidays: e.target.value
                      .split(",")
                      .map((d) => d.trim())
                      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
                  })
                }
              />
            </Field>
            {holidays.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {holidays.map((h) => (
                  <Badge key={h} tone="warn">
                    {formatJalali(h, { withMonthName: false })}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Baseline (مبنای مقایسه)" subtitle="با ثبت Baseline، انحراف زمان‌بندی و هزینه پروژه در گزارش قابل تحلیل می‌شود." icon={<span className="text-lg">📌</span>} />
        <div className="flex flex-wrap items-center gap-3 p-5">
          {project.baseline ? (
            <>
              <Badge tone="ok">{project.baseline.name} · {toPersianDigits(project.baseline.activities.length)} فعالیت</Badge>
              <Button variant="secondary" size="sm" onClick={() => api.clearBaseline()}>
                حذف Baseline
              </Button>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-500">هنوز Baseline‌ای ثبت نشده است. با ثبت، امکان مقایسه برنامه فعلی با مبنای تأییدشده فراهم می‌شود.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- step 5 -------------------------------- */

export function StepMilestonesRisks({ project, api }: { project: ProjectInput; api: ProjectApi }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="نقاط کنترل (Milestones)" subtitle="رویدادهای کلیدی پروژه؛ با اتصال به فعالیت، تاریخ آن به‌صورت خودکار محاسبه می‌شود." icon={<span className="text-lg">🚩</span>} />
        <div className="space-y-3 p-5">
          {project.milestones.map((milestone) => (
            <div key={milestone.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_220px_auto]">
              <Input value={milestone.name} onChange={(e) => api.updateMilestone(milestone.id, { name: e.target.value })} />
              <Select value={milestone.activityId ?? ""} onChange={(e) => api.updateMilestone(milestone.id, { activityId: e.target.value || undefined })}>
                <option value="">— بدون اتصال به فعالیت —</option>
                {project.activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
              <Button variant="danger" size="sm" onClick={() => api.removeMilestone(milestone.id)}>
                حذف
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => api.addMilestone()}>
            + افزودن نقطه کنترل
          </Button>
          {!project.milestones.length ? (
            <p className="mt-1 text-[11.5px] text-slate-500">
              نقطه کنتری ثبت نشده است. نقاط کنترل، رویدادهای کلیدی مانند «پایان فونداسیون» یا «تحویل موقت» هستند و
              تاریخ آن‌ها به‌صورت خودکار از فعالیت متناظر محاسبه می‌شود.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="ریسک‌های پروژه" subtitle="احتمال و اثر را از ۱ تا ۵ انتخاب کنید؛ ماتریس ریسک و ارزش در معرض ریسک خودکار محاسبه می‌شود." icon={<span className="text-lg">⚠️</span>} />
        <div className="thin-scroll overflow-x-auto p-5">
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                {["عنوان ریسک", "دسته", "احتمال", "اثر", "اثر زمانی (روز)", "اثر مالی", "امتیاز", "راهکار کاهش", ""].map((h) => (
                  <th key={h} className="px-2 py-2.5 text-right font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {project.risks.map((risk) => {
                const score = risk.probability * risk.impact;
                return (
                  <tr key={risk.id} className="border-t border-slate-100">
                    <td className="min-w-[180px] px-2 py-2"><Input value={risk.title} onChange={(e) => api.updateRisk(risk.id, { title: e.target.value })} className="py-1.5" /></td>
                    <td className="px-2 py-2"><Input value={risk.category} onChange={(e) => api.updateRisk(risk.id, { category: e.target.value })} className="w-28 py-1.5" /></td>
                    <td className="px-2 py-2"><Input type="number" min={1} max={5} value={risk.probability} onChange={(e) => api.updateRisk(risk.id, { probability: Number(e.target.value) })} className="w-16 py-1.5" /></td>
                    <td className="px-2 py-2"><Input type="number" min={1} max={5} value={risk.impact} onChange={(e) => api.updateRisk(risk.id, { impact: Number(e.target.value) })} className="w-16 py-1.5" /></td>
                    <td className="px-2 py-2"><Input type="number" min={0} value={risk.scheduleImpact} onChange={(e) => api.updateRisk(risk.id, { scheduleImpact: Number(e.target.value) })} className="w-20 py-1.5" /></td>
                    <td className="px-2 py-2"><Input type="number" min={0} value={risk.costImpact} onChange={(e) => api.updateRisk(risk.id, { costImpact: Number(e.target.value) })} className="w-28 py-1.5" /></td>
                    <td className="px-2 py-2">
                      <Badge tone={score >= 20 ? "bad" : score >= 12 ? "warn" : "ok"}>{toPersianDigits(score)}</Badge>
                    </td>
                    <td className="min-w-[200px] px-2 py-2"><Input value={risk.mitigation ?? ""} onChange={(e) => api.updateRisk(risk.id, { mitigation: e.target.value })} className="py-1.5" /></td>
                    <td className="px-2 py-2">
                      <Button variant="danger" size="sm" onClick={() => api.removeRisk(risk.id)}>حذف</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => api.addRisk()}>
              + افزودن ریسک
            </Button>
            {!project.risks.length ? (
              <p className="text-[11.5px] text-slate-500">
                ریسکی ثبت نشده است. برای هر ریسک، احتمال و اثر را از ۱ تا ۵ انتخاب کنید تا ماتریس ریسک و ارزش در
                معرض ریسک محاسبه شود.
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- step 6 -------------------------------- */

export function StepOutput({
  reportSections,
  setReportSections,
  analysis,
  project,
  api,
}: {
  reportSections: string[];
  setReportSections: (sections: string[]) => void;
  analysis: ProjectAnalysis;
  project: ProjectInput;
  api: ProjectApi;
}) {
  const groups = Array.from(new Set(REPORT_SECTIONS.map((s) => s.group)));
  const toggle = (key: string) =>
    setReportSections(reportSections.includes(key) ? reportSections.filter((s) => s !== key) : [...reportSections, key]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="بخش‌های گزارش را انتخاب کنید"
          subtitle="گزارش خروجی به‌صورت یک سند مهندسی استاندارد A4 با جلد، سرصفحه، جدول‌های حرفه‌ای و شماره‌گذاری تولید می‌شود."
          icon={<span className="text-lg">📄</span>}
          action={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReportSections(REPORT_SECTIONS.map((s) => s.key))}>
                انتخاب همه
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReportSections(DEFAULT_REPORT_SECTIONS)}>
                پیش‌فرض
              </Button>
            </div>
          }
        />
        <div className="space-y-5 p-5">
          {groups.map((group) => (
            <div key={group}>
              <h4 className="mb-2 text-[12px] font-bold text-slate-500">{group}</h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {REPORT_SECTIONS.filter((s) => s.group === group).map((section) => {
                  const active = reportSections.includes(section.key);
                  return (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => toggle(section.key)}
                      className={`rounded-xl border p-3 text-right transition ${
                        active ? "border-brand-500 bg-brand-50/60" : "border-slate-200 bg-white hover:border-brand-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-ink-900">{section.label}</span>
                        <span
                          className={`flex size-4 items-center justify-center rounded-[5px] border text-[10px] text-white ${
                            active ? "border-brand-600 bg-brand-600" : "border-slate-300"
                          }`}
                        >
                          {active ? "✓" : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-slate-500">{section.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <ScenarioPanel project={project} analysis={analysis} />

      <Card>
        <CardHeader title="پیش‌نمایش شاخص‌های کلیدی" subtitle="این مقادیر به‌صورت خودکار از موتور محاسباتی پروژه استخراج شده‌اند." icon={<span className="text-lg">📊</span>} />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {analysis.kpis.slice(0, 8).map((kpi) => (
            <StatTile
              key={kpi.key}
              label={kpi.label}
              value={kpi.key === "finish" ? formatJalali(kpi.value, { withMonthName: false }) : kpi.value}
              hint={kpi.hint}
              tone={kpi.status === "good" ? "ok" : kpi.status === "watch" ? "warn" : "bad"}
            />
          ))}
        </div>
        <div className="border-t border-slate-100 px-5 py-4 text-[12px] leading-6 text-slate-500">
          {analysis.summary.bullets.slice(0, 3).map((b) => (
            <p key={b}>• {b}</p>
          ))}
          <p className="mt-2 text-slate-500">
            واحد پول: {project.meta.currency === "IRR" ? "ریال" : project.meta.currency === "USD" ? "دلار" : "یورو"}
          </p>
        </div>
      </Card>
    </div>
  );
}
