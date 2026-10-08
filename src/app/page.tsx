import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { Logo, LogoMark, CREATOR_CREDIT_FULL } from "@/components/Logo";
import { renderGanttSvg } from "@/lib/report/gantt-svg";
import { analyzeProject } from "@/lib/engine/analysis";
import { buildProjectFromTemplate } from "@/lib/templates";
import { REPORT_SECTIONS, EXPORT_FORMATS } from "@/lib/validation";
import { RATE_CATALOG } from "@/lib/market/rates";
import { METHODS, standardsFor } from "@/lib/standards";
import { formatCompact, formatJalali, formatPercent, toPersianDigits } from "@/lib/date-fa";

const FEATURES = [
  { icon: "🧮", title: "موتور محاسباتی CPM", body: "زمان‌بندی پیشرفته با مسیر بحرانی، شناوری کل و آزاد، وابستگی‌های FS/SS/FF/SF با Lag و تقویم کاری واقعی پروژه." },
  { icon: "📊", title: "گانت چارت حرفه‌ای", body: "نمودار گانت استاندارد با مسیر بحرانی، درصد پیشرفت، خط تاریخ وضعیت، نقاط کنترل و نمودار شبکه‌ای." },
  { icon: "👷", title: "تخصیص و هموارسازی منابع", body: "ظرفیت، نرخ، اوج تخصیص و بهره‌وری هر منبع به‌صورت خودکار محاسبه و بیش‌تخصیص‌ها شناسایی می‌شود." },
  { icon: "💰", title: "کنترل هزینه و EVM", body: "بودجه، هزینه واقعی، ارزش کسب‌شده، شاخص‌های SPI/CPI و برآورد هزینه در پایان (EAC)." },
  { icon: "📈", title: "قیمت‌گذاری لحظه‌ای بازار ایران", body: "نرخ مصوب دستمزد، ماشین‌آلات و مصالح با میانگین بازار، ضریب منطقه‌ای، بالاسری، سود، ذخیره احتیاطی و تعدیل ماهانه." },
  { icon: "⚠️", title: "تحلیل ریسک و تأخیر", body: "ماتریس احتمال–اثر، ارزش در معرض ریسک و شناسایی خودکار فعالیت‌های دارای تأخیر." },
  { icon: "📄", title: "خروجی چندفرمته حرفه‌ای", body: "گزارش A4 با جلد و امضا، کارپوشه اکسل چندشییتی، CSV، JSON و فایل قابل بازکردن در Microsoft Project." },
  { icon: "⚡", title: "سرعت و سادگی", body: "محاسبات در مرورگر و بدون انتظار؛ بدون نیاز به نصب، ثبت‌نام یا آموزش تخصصی." },
];

const STEPS = [
  { step: "۱", title: "ورودی ساده", body: "نوع پروژه را انتخاب کنید، فعالیت‌ها و مدت‌ها را وارد کنید. ساختار WBS، منابع، نرخ‌های بازار و ریسک‌های پیشنهادی آماده است.", icon: "✏️" },
  { step: "۲", title: "پردازش هوشمند", body: "موتور اختصاصی HERMIPLAN زمان‌بندی، مسیر بحرانی، شناوری، تخصیص منابع، هزینه، تعدیل و شاخص‌های عملکرد را محاسبه می‌کند.", icon: "⚙️" },
  { step: "۳", title: "خروجی حرفه‌ای", body: "گزارش مهندسی آماده ارائه به کارفرما، مشاور، مدیر یا استاد؛ همراه با بسته کامل فایل‌ها در ۷ فرمت.", icon: "📈" },
];

const TYPES = [
  ["🏗️", "ساختمان (مسکونی / اداری)", "گودبرداری، فونداسیون، اسکلت، نازک‌کاری، پایان‌کار", "عمرانی"],
  ["🛣️", "پل و راه", "ژئوتکنیک، شمع‌کوبی، رокумент، عرشه، آسفالت", "عمرانی"],
  ["🧰", "نوسازی و بازسازی", "ارزیابی، تخریب، مقاوم‌سازی، بازسازی، تحویل", "عمرانی"],
  ["🔌", "زیرساخت", "شبکه آب، برق، کابل‌کشی، تست و راه‌اندازی", "عمرانی"],
  ["📐", "طراحی معماری", "مفهوم، طرح تفصیلی، نقشه اجرایی، نظارت", "طراحی"],
  ["💻", "نرم‌افزار", "دیسکاوری، معماری، توسعه، تست، انتشار", "فناوری"],
  ["🏭", "تولید و صنعت", "طراحی فرآیند، تأمین، مونتاژ، تولید آزمایشی", "صنعت"],
  ["🔬", "پژوهش", "پروپوزال، داده‌گیری، تحلیل، نگارش، دفاع", "پژوهش"],
  ["🎪", "رویداد", "طراحی، تأمین، بازاریابی، اجرا، جمع‌بندی", "رویداد"],
  ["📁", "پروژه عمومی", "ساختار ساده و قابل تنظیم برای هر پروژه", "عمومی"],
];

export default function HomePage() {
  const demo = analyzeProject(buildProjectFromTemplate("construction"));
  const ganttSvg = renderGanttSvg({ gantt: demo.gantt, showArrows: false });
  const laborRates = RATE_CATALOG.filter((r) => r.category === "labor").slice(0, 5);
  const materialRates = RATE_CATALOG.filter((r) => r.category === "material").slice(0, 5);
  const basis = standardsFor("construction");

  return (
    <div id="top" className="min-h-screen bg-white">
      <SiteNav />

      {/* ------------------------------- hero ------------------------------- */}
      <section className="hp-mesh hp-grid-bg relative overflow-hidden pb-24 pt-28 text-white lg:pb-28 lg:pt-36">
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[620px] -translate-x-1/2 rounded-full bg-brand-500/25 blur-[140px]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3.5 py-1.5 text-[11.5px] font-semibold text-accent-300">
              <span className="size-1.5 animate-pulse rounded-full bg-accent-400" />
              Simple Input → Smart Processing → Professional Output
            </span>
            <h1 className="mt-6 text-[32px] font-black leading-[1.28] tracking-tight sm:text-[44px] lg:text-[50px]">
              مدیریت پروژه حرفه‌ای،
              <br />
              <span className="text-gradient">بدون پیچیدگی ابزارهای تخصصی</span>
            </h1>
            <p className="mt-5 max-w-xl text-[14px] leading-8 text-slate-300 sm:text-[15px]">
              HERMIPLAN برای مهندسان، مدیران پروژه، پیمانکاران، مشاوران و دانشجویان طراحی شده است.
              اطلاعات پروژه را در چند مرحله ساده وارد کنید؛ سیستم تمام محاسبات تخصصی — زمان‌بندی، مسیر بحرانی،
              شناوری، تخصیص منابع، هزینه، تعدیل قیمت و ریسک — را انجام می‌دهد و یک گزارش مهندسی استاندارد تحویل می‌دهد.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/builder"
                className="inline-flex items-center gap-2 rounded-2xl bg-accent-500 px-6 py-3.5 text-[14px] font-bold text-ink-950 shadow-xl shadow-accent-600/25 transition hover:bg-accent-400 active:scale-[0.98]"
              >
                ساخت پروژه و دریافت گزارش
                <span>→</span>
              </Link>
              <a
                href="#output"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/8 px-6 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/14"
              >
                مشاهده نمونه خروجی
              </a>
            </div>
            <p className="mt-4 text-[12px] text-slate-400">
              بدون ثبت‌نام، بدون نصب، بدون نیاز به آموزش تخصصی · ذخیره خودکار در مرورگر شما
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-5 border-t border-white/10 pt-6 sm:grid-cols-4">
              {[
                ["۱۰۰٪", "محاسبات deterministic"],
                ["۱۰", "قالب آماده پروژه"],
                ["۲۱", "بخش گزارش حرفه‌ای"],
                ["۷", "فرمت خروجی فایل"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-[22px] font-extrabold text-white">{value}</dt>
                  <dd className="mt-0.5 text-[11px] leading-5 text-slate-400">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* live engine preview */}
          <div className="animate-fade-up animate-float">
            <div className="hp-ring-accent rounded-3xl border border-white/12 bg-white/95 p-4 shadow-2xl shadow-black/50 backdrop-blur">
              <div className="flex items-center justify-between px-1 pb-3">
                <div>
                  <p className="text-[11px] text-slate-400">پیش‌نمایش زنده موتور پروژه</p>
                  <p className="text-[13px] font-extrabold text-ink-900">
                    {toPersianDigits(demo.activities.length)} فعالیت · پروژه ساختمانی
                  </p>
                </div>
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10.5px] font-bold text-brand-700">
                  پایان: {formatJalali(demo.schedule.finishDate, { withMonthName: false })}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pb-3">
                {[
                  ["مدت پروژه", `${toPersianDigits(demo.schedule.workingDays)} روز`],
                  ["فعالیت بحرانی", toPersianDigits(demo.criticalPath.length)],
                  ["برآورد نهایی", formatCompact(demo.pricing.breakdown.total)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-2.5 text-center">
                    <p className="text-[9.5px] text-slate-400">{label}</p>
                    <p className="mt-0.5 text-[12.5px] font-extrabold text-brand-800">{value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div dangerouslySetInnerHTML={{ __html: ganttSvg }} />
              </div>
              <div className="mt-3 flex items-center gap-2 px-1">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${demo.progress.overall}%` }} />
                </div>
                <span className="text-[11px] font-bold text-slate-600">{formatPercent(demo.progress.overall, 1)}</span>
              </div>
              <p className="mt-2 px-1 text-[10px] leading-5 text-slate-400">
                نرخ‌ها بر مبنای {demo.pricing.seriesLabel} — {demo.pricing.asOfJalali} · تعدیل {toPersianDigits(demo.pricing.escalationRatePerMonth)}٪ ماهانه
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------- how -------------------------------- */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-[12px] font-bold tracking-widest text-brand-600">فرآیند کار</span>
          <h2 className="mt-3 text-[26px] font-black leading-tight text-ink-900 sm:text-[32px]">
            سه مرحله، از ایده تا گزارش قابل ارائه
          </h2>
          <p className="mt-4 text-[14px] leading-8 text-slate-500">
            شما لازم نیست بدانید مسیر بحرانی چگونه محاسبه می‌شود یا Float چیست؛ HERMIPLAN این پیچیدگی‌ها را در پشت صحنه مدیریت می‌کند.
          </p>
        </div>
        <div className="relative mt-14 grid gap-5 md:grid-cols-3">
          <div className="pointer-events-none absolute inset-x-[16%] top-[52px] hidden h-px bg-gradient-to-l from-brand-200 via-brand-400 to-accent-300 md:block" />
          {STEPS.map((item) => (
            <div key={item.step} className="hp-card hp-card-hover relative p-6 text-center md:text-right">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 text-2xl text-white shadow-lg shadow-brand-900/20 md:mx-0">
                {item.icon}
              </div>
              <span className="absolute left-5 top-5 text-[34px] font-black leading-none text-slate-100">{item.step}</span>
              <h3 className="mt-4 text-[16px] font-bold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-[13px] leading-7 text-slate-500">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ features ----------------------------- */}
      <section id="features" className="relative overflow-hidden bg-slate-50 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-[12px] font-bold tracking-widest text-brand-600">موتور پروژه</span>
              <h2 className="mt-3 text-[26px] font-black leading-tight text-ink-900 sm:text-[32px]">
                قدرت ابزارهای تخصصی، پشت یک تجربه ساده
              </h2>
            </div>
            <p className="max-w-md text-[13px] leading-7 text-slate-500">
              تمام محاسبات توسط موتور اختصاصی و مستقل سیستم انجام می‌شود؛ نه در دست کاربر و نه وابسته به هوش مصنوعی.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="hp-card hp-card-hover p-5">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-xl">{feature.icon}</span>
                <h3 className="mt-4 text-[15px] font-bold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-[12.5px] leading-7 text-slate-500">{feature.body}</p>
              </div>
            ))}
          </div>

          <div className="hp-card mt-8 grid gap-6 p-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <h3 className="text-[17px] font-black text-ink-900">روش‌های محاسباتی استاندارد</h3>
              <p className="mt-2 text-[12.5px] leading-7 text-slate-500">
                هر عدد در گزارش HERMIPLAN از یک روش شناخته‌شده مهندسی می‌آید؛ بدون عدد جادویی و بدون تخمین غیرقابل ردیابی.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {METHODS.map((method) => (
                  <span key={method.code} className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-[11px] font-semibold text-brand-700">
                    {method.code}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {basis.standards.map((standard) => (
                <div key={standard.code} className="rounded-2xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[12px] font-bold text-ink-900">{standard.code}</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">{standard.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------- types ------------------------------- */}
      <section id="types" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-[12px] font-bold tracking-widest text-brand-600">انواع پروژه</span>
          <h2 className="mt-3 text-[26px] font-black leading-tight text-ink-900 sm:text-[32px]">
            برای هر پروژه، یک ساختار آماده و استاندارد
          </h2>
          <p className="mt-4 text-[14px] leading-8 text-slate-500">
            در پنل ساخت پروژه می‌توانید قالب‌ها را بر اساس حوزه، سطح پیچیدگی و مدت فیلتر و مرتب کنید.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TYPES.map(([icon, title, body, domain]) => (
            <div key={title} className="hp-card hp-card-hover group p-5">
              <div className="flex items-start justify-between">
                <span className="text-2xl">{icon}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">{domain}</span>
              </div>
              <h3 className="mt-3 text-[14.5px] font-bold text-ink-900">{title}</h3>
              <p className="mt-1.5 text-[12px] leading-6 text-slate-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ market ------------------------------ */}
      <section id="market" className="hp-mesh relative overflow-hidden py-20 text-white lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div>
              <span className="text-[12px] font-bold tracking-widest text-accent-400">بازار ایران</span>
              <h2 className="mt-3 text-[26px] font-black leading-tight sm:text-[32px]">
                هزینه‌ها با نرخ‌های به‌روز بازار محاسبه می‌شوند
              </h2>
              <p className="mt-4 text-[13.5px] leading-8 text-slate-300">
                نرخ نیروی انسانی بر مبنای مصوبات رسمی دستمزد، و نرخ مصالح و ماشین‌آلات بر مبنای میانگین بازار.
                ضریب منطقه‌ای، بالاسری، سود پیمانکار، ذخیره احتیاطی و تعدیل ماهانه به‌صورت خودکار اعمال می‌شود.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  ["۳ سری نرخ", "مصوب ۱۴۰۵ / مصوب ۱۴۰۴ / بازار آزاد"],
                  ["۳۷ ردیف نرخ", "نیروی انسانی، ماشین‌آلات و مصالح"],
                  ["تعدیل ماهانه", "بر پایه کارکرد واقعی هر ماه"],
                  ["ساختار برآورد", "مستقیم + بالاسری + سود + احتیاط"],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/12 bg-white/6 p-4">
                    <p className="text-[13px] font-bold text-white">{title}</p>
                    <p className="mt-1 text-[11.5px] leading-6 text-slate-300">{body}</p>
                  </div>
                ))}
              </div>
              <Link
                href="/builder"
                className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-accent-500 px-6 py-3.5 text-[14px] font-bold text-ink-950 transition hover:bg-accent-400"
              >
                قیمت‌گذاری پروژه خودم
              </Link>
            </div>

            <div className="rounded-3xl border border-white/12 bg-white p-5 text-ink-900 shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <p className="text-[12.5px] font-bold">فهرست نرخ بازار ایران</p>
                  <p className="mt-0.5 text-[10.5px] text-slate-400">نسخه مرجع — {demo.pricing.asOfJalali}</p>
                </div>
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700">ریال / واحد</span>
              </div>
              <table className="mt-3 w-full text-[11.5px]">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-2 text-right font-semibold">شرح</th>
                    <th className="py-2 text-right font-semibold">مصوب ۱۴۰۵</th>
                    <th className="py-2 text-right font-semibold">بازار آزاد</th>
                  </tr>
                </thead>
                <tbody>
                  {[...laborRates, ...materialRates].map((rate) => (
                    <tr key={rate.key} className="border-t border-slate-100">
                      <td className="py-1.5">
                        <span className="block font-semibold text-ink-900">{rate.name}</span>
                        <span className="text-[10px] text-slate-400">{rate.unit}</span>
                      </td>
                      <td className="py-1.5 text-slate-600">{rate.official1405 ? formatCompact(rate.official1405) : "—"}</td>
                      <td className="py-1.5 font-bold text-brand-700">{formatCompact(rate.market)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-bold text-ink-900">نمونه ساختار برآورد (پروژه ساختمانی نمونه)</p>
                <div className="mt-2 space-y-1.5 text-[11px]">
                  {[
                    ["هزینه‌های مستقیم", formatCompact(demo.pricing.breakdown.direct)],
                    ["بالاسری + سود + احتیاط", formatCompact(demo.pricing.breakdown.overhead + demo.pricing.breakdown.profit + demo.pricing.breakdown.contingency)],
                    ["تعدیل قیمت", formatCompact(demo.pricing.breakdown.escalation)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-slate-500">
                      <span>{label}</span>
                      <span className="font-semibold text-ink-900">{value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                    <span className="font-bold text-ink-900">برآورد نهایی</span>
                    <span className="text-[13px] font-extrabold text-brand-700">{formatCompact(demo.pricing.breakdown.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------ output ------------------------------ */}
      <section id="output" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <span className="text-[12px] font-bold tracking-widest text-brand-600">خروجی گزارش</span>
            <h2 className="mt-3 text-[26px] font-black leading-tight text-ink-900 sm:text-[32px]">
              یک گزارش واقعی، نه یک Print ساده از صفحه سایت
            </h2>
            <p className="mt-4 text-[13.5px] leading-8 text-slate-500">
              خروجی HERMIPLAN مانند یک گزارش مهندسی و مدیریتی استاندارد طراحی شده است: صفحه جلد، خلاصه مدیریتی،
              سرصفحه و پاورقی، شماره صفحه، جدول‌های حرفه‌ای با تکرار سرستون، نمودار گانت و شبکه‌ای، تحلیل ارزش کسب‌شده،
              تعدیل قیمت، ماتریس ریسک، مبنای استانداردها و صفحه امضا.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {EXPORT_FORMATS.map((format) => (
                <div key={format.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 font-mono text-[10px] font-bold text-brand-700">
                    .{format.ext}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-bold text-ink-900">{format.label}</span>
                    <span className="block truncate text-[10.5px] text-slate-500">{format.hint}</span>
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/builder"
              className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-brand-700 px-6 py-3.5 text-[14px] font-bold text-white transition hover:bg-brand-600"
            >
              همین حالا گزارش پروژه خود را بسازید
            </Link>
          </div>
          <div className="hp-card p-5">
            <p className="mb-3 text-[12.5px] font-bold text-ink-900">بخش‌های قابل انتخاب در گزارش ({toPersianDigits(REPORT_SECTIONS.length)} بخش)</p>
            <div className="thin-scroll grid max-h-[520px] gap-2 overflow-y-auto sm:grid-cols-2">
              {REPORT_SECTIONS.map((section) => (
                <div key={section.key} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                  <p className="text-[12px] font-semibold text-ink-900">{section.label}</p>
                  <p className="mt-0.5 text-[10.5px] leading-5 text-slate-500">{section.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------- about ------------------------------ */}
      <section id="about" className="bg-slate-50 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="hp-card grid gap-8 p-8 md:grid-cols-[1.4fr_1fr] md:items-center lg:p-10">
            <div>
              <span className="text-[12px] font-bold tracking-widest text-brand-600">درباره HERMIPLAN</span>
              <h2 className="mt-3 text-[24px] font-black leading-tight text-ink-900 sm:text-[28px]">
                سادگی در مقابل کاربر، دقت مهندسی در پشت سیستم
              </h2>
              <p className="mt-4 text-[13.5px] leading-8 text-slate-600">
                HERMIPLAN با این اعتقاد ساخته شده که یادگیری ابزارهای پیچیده مدیریت پروژه نباید مانع اجرای دقیق پروژه‌ها باشد.
                استفاده از امکانات اصلی پلتفرم نیازمند ثبت‌نام نیست؛ ثبت‌نام تنها برای قابلیت‌هایی مانند ذخیره دائمی پروژه،
                Workspace و دسترسی از دستگاه‌های مختلف طراحی شده است.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ["Simplicity", "ورودی ساده و قابل فهم برای مهندس"],
                  ["Engineering Accuracy", "محاسبات دقیق و قابل تست"],
                  ["Professional Output", "خروجی در سطح گزارش‌های مهندسی"],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[12.5px] font-bold text-brand-700">{title}</p>
                    <p className="mt-1 text-[11.5px] leading-6 text-slate-500">{body}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-ink-950 p-6 text-center text-white hp-mesh">
              <span className="mx-auto flex items-center justify-center">
                <LogoMark size="xl" />
              </span>
              <p className="mt-4 text-[15px] font-extrabold">HERMIPLAN</p>
              <p className="mt-1 text-[11.5px] text-slate-400">Project Intelligence Platform</p>
              <div className="my-5 h-px bg-white/10" />
              <p className="text-[11px] text-slate-400">Founder / Creator</p>
              <p className="mt-1 text-[17px] font-bold tracking-tight">Mohammad Shirmardi</p>
              <p className="mt-3 text-[10.5px] text-slate-500">محمد شیرمردی</p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------ footer ----------------------------- */}
      <footer className="hp-bottom-safe border-t border-slate-200 bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center sm:px-6">
          <Logo tagline="Project Intelligence Platform" />
          <p className="max-w-xl text-[12px] leading-6 text-slate-500">
            پلتفرم مدیریت، برنامه‌ریزی و تحلیل پروژه — ورودی ساده، پردازش هوشمند، خروجی حرفه‌ای
          </p>
          <p className="text-[12.5px] font-bold text-slate-700">{CREATOR_CREDIT_FULL}</p>
          <nav className="flex flex-wrap items-center justify-center gap-5 text-[12px] text-slate-500">
            <Link href="/builder" className="transition hover:text-brand-700">ساخت پروژه</Link>
            <a href="#features" className="transition hover:text-brand-700">امکانات</a>
            <a href="#market" className="transition hover:text-brand-700">بازار و قیمت‌گذاری</a>
            <a href="#about" className="transition hover:text-brand-700">درباره</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
