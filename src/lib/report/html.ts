import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import { formatCompact, formatJalali, formatNumber, formatPercent, toPersianDigits } from "@/lib/date-fa";

/**
 * Standalone, self-contained HTML report.
 * Used inside the delivery package so the recipient can view and print the
 * report without any server dependency (File → Print → PDF).
 */

/** escapes untrusted project text before it is embedded in the HTML report */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const LOGO_MARK = `<svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lp" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0e2745"/><stop offset="100%" stop-color="#123a66"/></linearGradient><linearGradient id="lb" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#8ab2e3"/><stop offset="100%" stop-color="#ffffff"/></linearGradient></defs><path d="M32 2.6 57.4 17.3v29.4L32 61.4 6.6 46.7V17.3z" fill="url(#lp)"/><path d="M14.5 24.5c7.4-6.6 15.2-8.6 23.3-6" fill="none" stroke="#e2a13a" stroke-width="2.6" stroke-linecap="round"/><rect x="17" y="36" width="7.5" height="9" rx="1.8" fill="url(#lb)" opacity=".55"/><rect x="27.5" y="31" width="7.5" height="14" rx="1.8" fill="url(#lb)" opacity=".8"/><rect x="38" y="25.5" width="7.5" height="19.5" rx="1.8" fill="#eeb95c"/><rect x="17" y="47.5" width="28.5" height="2.4" rx="1.2" fill="rgba(255,255,255,.35)"/></svg>`;

const CSS = `
:root{--navy:#12335a;--ink:#101a24;--line:#d7dee6}
*{box-sizing:border-box}
body{margin:0;background:#eef1f5;color:var(--ink);font-family:Vazirmatn,Tahoma,system-ui,sans-serif;font-size:11.4px;line-height:1.85;direction:rtl}
.sheet{width:210mm;min-height:297mm;margin:10mm auto;padding:16mm 14mm;background:#fff;box-shadow:0 10px 40px rgba(9,30,60,.15);position:relative}
header.cover{border-bottom:2px solid var(--navy);padding-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
h1{margin:0;font-size:24px;font-weight:900;color:#0d1f39}
h2{font-size:15px;margin:0}
.sec{margin:18px 0 26px}
.sec>.t{display:flex;gap:10px;align-items:center;border-bottom:2px solid var(--navy);padding-bottom:6px;margin-bottom:12px;color:var(--navy)}
.sec .idx{display:inline-flex;min-width:26px;height:26px;align-items:center;justify-content:center;border-radius:6px;background:var(--navy);color:#fff;font-weight:700;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:10.4px}
th{background:var(--navy);color:#fff;padding:6px 7px;border:1px solid #0e2946;text-align:right;font-weight:600;white-space:nowrap}
td{border:1px solid var(--line);padding:5px 7px;vertical-align:middle}
tbody tr:nth-child(even) td{background:#f4f7fa}
tfoot td{background:#e8eef4;font-weight:700}
.kv td{padding:6px 8px}
.kv td.k{width:34%;font-weight:600;color:#2a3f52}
.callout{border-right:4px solid var(--navy);background:#f3f7fb;padding:10px 12px;border-radius:0 6px 6px 0}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:10px}
.kpi b{display:block;font-size:15px;margin-top:3px;color:var(--navy)}
.note{font-size:9.6px;color:#5b6b7b;margin-top:6px}
footer{position:absolute;bottom:8mm;left:14mm;right:14mm;display:flex;justify-content:space-between;border-top:1px solid #e2e8ee;padding-top:4px;font-size:9px;color:#6b7a8a}
.badge{display:inline-block;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}
.g{background:#dcfce7;color:#166534}.w{background:#fef3c7;color:#92400e}.b{background:#fee2e2;color:#991b1b}
@media print{.no-print{display:none}@page{size:A4;margin:12mm 11mm}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;break-after:page}footer{display:none}thead{display:table-header-group}tr{break-inside:avoid}}
`;

function table(headers: string[], rows: (string | number)[][], footer?: (string | number)[]) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>${
    footer ? `<tfoot><tr>${footer.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr></tfoot>` : ""
  }</table>`;
}

function kpiCard(label: string, value: string, tone = "g") {
  return `<div class="kpi"><span style="font-size:9.5px;color:#64748b">${esc(label)}</span><b>${esc(value)}</b><span class="badge ${tone}" style="margin-top:4px">${tone === "g" ? "مطلوب" : tone === "w" ? "قابل پایش" : "بحرانی"}</span></div>`;
}

export function buildReportHtml(
  project: ProjectInput,
  analysis: ProjectAnalysis,
  ganttSvg: string,
): string {
  const a = analysis;
  const currency = project.meta.currency;
  const money = (value: number) => (currency === "IRR" ? formatCompact(value) : formatNumber(value));
  let index = 0;
  const next = () => ++index;
  const statusText =
    a.health.status === "good" ? "در وضعیت مطلوب" : a.health.status === "watch" ? "نیازمند پایش" : "در وضعیت بحرانی";

  const sections: string[] = [];

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>خلاصه مدیریتی</h2></div>
    <div class="callout"><b>${esc(a.summary.headline)}</b></div>
    <ul style="font-size:11px;line-height:2">${a.summary.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>مشخصات پروژه</h2></div>
    <table class="kv"><tbody>${[
      ["نام پروژه", esc(project.meta.name)],
      ["نوع پروژه", esc(project.meta.type)],
      ["کارفرما", esc(project.meta.client ?? "—")],
      ["پیمانکار", esc(project.meta.contractor ?? "—")],
      ["مشاور", esc(project.meta.consultant ?? "—")],
      ["مدیر پروژه", esc(project.meta.manager ?? "—")],
      ["تاریخ شروع", formatJalali(a.schedule.startDate)],
      ["تاریخ پایان", formatJalali(a.schedule.finishDate)],
      ["مدت پروژه", `${toPersianDigits(a.schedule.workingDays)} روز کاری`],
      ["تقویم کاری", `${toPersianDigits(a.schedule.workDayCount)} روز در هفته · ${toPersianDigits(a.schedule.hoursPerDay)} ساعت`],
      ["مبنای قیمت‌گذاری", esc(`${a.pricing.seriesLabel} — منطقه ${a.pricing.regionLabel} (تاریخ نرخ: ${a.pricing.asOfJalali})`)],
      ["نرخ تعدیل ماهانه", `${toPersianDigits(a.pricing.escalationRatePerMonth)}٪`],
    ]
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`)
      .join("")}</tbody></table></div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>شاخص‌های کلیدی عملکرد</h2></div>
    <div class="kpis">${a.kpis
      .slice(0, 8)
      .map((kpi) =>
        kpiCard(
          kpi.label,
          kpi.key === "finish" ? formatJalali(kpi.value, { withMonthName: false }) : kpi.value,
          kpi.status === "good" ? "g" : kpi.status === "watch" ? "w" : "b",
        ),
      )
      .join("")}</div></div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>ساختار شکست کار (WBS)</h2></div>
    ${table(
      ["کد", "شرح", "مدت", "شروع", "پایان", "پیشرفت", "بودجه"],
      a.wbs.flatMap((phase) => [
        [
          `<b>${phase.wbs}</b>`,
          `<b>${phase.name}</b>`,
          toPersianDigits(phase.duration ?? 0),
          formatJalali(phase.startDate ?? "", { withMonthName: false }),
          formatJalali(phase.finishDate ?? "", { withMonthName: false }),
          formatPercent(phase.progress ?? 0, 0),
          money(phase.budget ?? 0),
        ],
        ...phase.children.map((child) => [
          `<span style="padding-right:18px">${child.wbs}</span>`,
          `<span style="padding-right:18px">${child.name}</span>`,
          toPersianDigits(child.duration ?? 0),
          formatJalali(child.startDate ?? "", { withMonthName: false }),
          formatJalali(child.finishDate ?? "", { withMonthName: false }),
          formatPercent(child.progress ?? 0, 0),
          money(child.budget ?? 0),
        ]),
      ]),
    )}</div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>زمان‌بندی و شناوری فعالیت‌ها</h2></div>
    ${table(
      ["کد", "فعالیت", "مدت", "شروع", "پایان", "شناوری کل", "شناوری آزاد", "بحرانی"],
      a.activities.map((act) => [
        act.code,
        act.name,
        toPersianDigits(act.duration),
        formatJalali(act.startDate, { withMonthName: false }),
        formatJalali(act.finishDate, { withMonthName: false }),
        act.totalFloat === 0 ? "بحرانی" : toPersianDigits(act.totalFloat),
        toPersianDigits(act.freeFloat),
        act.critical ? "● بله" : "خیر",
      ]),
    )}</div>`);

  if (ganttSvg) {
    sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>نمودار گانت</h2></div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:6px;overflow:auto">${ganttSvg}</div></div>`);
  }

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>هزینه، تعدیل و برآورد نهایی</h2></div>
    ${table(
      ["شرح", "مبلغ"],
      [
        ["هزینه‌های مستقیم (کار، ماشین، مصالح)", money(a.pricing.breakdown.direct)],
        [`هزینه‌های بالاسری (${toPersianDigits(a.pricing.breakdown.overhead ? project.pricing?.overheadPercent ?? 17 : 0)}٪)`, money(a.pricing.breakdown.overhead)],
        [`سود پیمانکار (${toPersianDigits(project.pricing?.profitPercent ?? 10)}٪)`, money(a.pricing.breakdown.profit)],
        [`ذخیره احتیاطی (${toPersianDigits(project.pricing?.contingencyPercent ?? 5)}٪)`, money(a.pricing.breakdown.contingency)],
        ["تعدیل قیمت (بر پایه کارکرد ماهانه)", money(a.pricing.breakdown.escalation)],
        ["<b>جمع برآورد نهایی</b>", `<b>${money(a.pricing.breakdown.total)}</b>`],
      ],
    )}
    <p class="note">مبنای نرخ‌ها: ${esc(a.pricing.seriesLabel)} — ${esc(a.pricing.asOfJalali)}؛ منطقه: ${esc(a.pricing.regionLabel)}؛ ضریب تعدیل عمومی: ${toPersianDigits(a.pricing.indexFactor)}٪</p>
    ${
      a.pricing.escalation.months.length
        ? table(
            ["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب تعدیل", "هزینه تعدیل‌شده", "مبلغ تعدیل"],
            a.pricing.escalation.months.map((m) => [
              m.label,
              toPersianDigits(m.workingDays),
              money(m.plannedValue),
              toPersianDigits(m.factor),
              money(m.adjustedValue),
              money(m.escalation),
            ]),
          )
        : ""
    }</div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>منابع و تخصیص</h2></div>
    ${table(
      ["منبع", "واحد", "ظرفیت", "واحد-روز", "اوج تخصیص", "بهره‌وری", "هزینه", "مبنای نرخ"],
      a.resources.map((r) => [
        r.name,
        project.resources.find((x) => x.id === r.id)?.unit ?? "—",
        toPersianDigits(r.capacity),
        toPersianDigits(r.totalUnits),
        r.overallocated ? `${toPersianDigits(r.peakUnits)} ⚠` : toPersianDigits(r.peakUnits),
        formatPercent(r.utilization, 0),
        money(r.cost),
        project.resources.find((x) => x.id === r.id)?.rateSource ?? "—",
      ]),
    )}</div>`);

  if (a.risks.length) {
    sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>ریسک‌های پروژه</h2></div>
      ${table(
        ["ریسک", "دسته", "احتمال", "اثر", "امتیاز", "سطح", "اثر زمانی", "اثر مالی", "راهکار کاهش"],
        a.risks.map((r) => [
          r.title,
          r.category,
          toPersianDigits(r.probability),
          toPersianDigits(r.impact),
          toPersianDigits(r.score),
          r.level === "critical" ? "بحرانی" : r.level === "high" ? "بالا" : r.level === "medium" ? "متوسط" : "کم",
          `${toPersianDigits(r.scheduleImpact)} روز`,
          money(r.costImpact),
          r.mitigation ?? "—",
        ]),
      )}</div>`);
  }

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>وضعیت و سلامت پروژه</h2></div>
    ${table(
      ["حوزه", "وضعیت", "توضیح"],
      a.health.signals.map((s) => [
        s.label,
        `<span class="badge ${s.status === "good" ? "g" : s.status === "watch" ? "w" : "b"}">${s.status === "good" ? "مطلوب" : s.status === "watch" ? "قابل پایش" : "بحرانی"}</span>`,
        s.detail,
      ]),
    )}
    <p class="note">امتیاز سلامت پروژه: ${toPersianDigits(a.health.score)} از ۱۰۰ — ${statusText}</p></div>`);

  sections.push(`<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>تأیید و امضا</h2></div>
    ${table(
      ["سمت", "نام", "امضا", "تاریخ"],
      [
        ["تهیه‌کننده / برنامه‌ریز", esc(project.meta.manager ?? "—"), "", ""],
        ["کنترل پروژه", "—", "", ""],
        ["دستگاه نظارت / مشاور", esc(project.meta.consultant ?? "—"), "", ""],
        ["کارفرما", esc(project.meta.client ?? "—"), "", ""],
      ],
    )}
    <p class="note" style="margin-top:14px">HERMIPLAN — Created by Mohammad Shirmardi · تولید گزارش: ${esc(formatJalali(project.meta.statusDate))}</p></div>`);

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<title>گزارش ${esc(project.meta.name)} | HERMIPLAN</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>
<style>${CSS}</style></head>
<body>
  <div class="no-print" style="direction:rtl;font-family:Vazirmatn,Tahoma,sans-serif;background:#0a1c37;color:#e2e8f0;padding:14px 18px;font-size:12.5px;line-height:2">
    <b>HERMIPLAN</b> — برای تولید PDF از این گزارش، فایل را در مرورگر باز کنید و
    <span style="direction:ltr;display:inline-block">Ctrl+P</span> → «Save as PDF» را انتخاب کنید؛ خروجی A4 با صفحه‌بندی و سرستون‌های تکرارشونده ساخته می‌شود.
    <span style="opacity:.65">Created by Mohammad Shirmardi</span>
  </div>
  <div class="sheet">
    <header class="cover">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          ${LOGO_MARK}
          <p style="margin:0;font-size:10px;letter-spacing:.3em;color:#1f4a80;font-weight:700">HERMIPLAN</p>
        </div>
        <h1>گزارش مدیریت، زمان‌بندی و کنترل پروژه</h1>
        <p style="margin:6px 0 0;color:#475569;font-size:12px">${esc(project.meta.name)}</p>
      </div>
      <div style="text-align:left;font-size:10px;color:#64748b">
        <p style="margin:0">تاریخ گزارش: ${formatJalali(project.meta.statusDate)}</p>
        <p style="margin:0">مبنای نرخ: ${a.pricing.asOfJalali}</p>
      </div>
    </header>
    ${sections.join("\n")}
    <footer><span>HERMIPLAN — Project Intelligence Platform</span><span>Created by Mohammad Shirmardi</span></footer>
  </div>
</body></html>`;
}
