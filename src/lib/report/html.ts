import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusLabel, statusTone, type BadgeTone, type ProjectAnalysis, type ProjectInput, type ProjectType, type Status } from "@/lib/engine/types";
import { formatCompact, formatJalali, formatNumber, toPersianDigits } from "@/lib/date-fa";

/**
 * Standalone, self-contained HTML report.
 * Used inside the delivery package so the recipient can view and print the
 * report without any server dependency (File → Print → PDF).
 */

/**
 * The report is meant to be printed and archived, so it must not depend on the
 * network: the Vazirmatn variable font (SIL OFL, `public/fonts/OFL.txt`) is
 * embedded as a data URI, exactly like a PDF embeds its fonts. Without this a
 * recipient behind a firewall would get fallback typography, and every open of
 * the file would call out to a third-party CDN.
 *
 * The base64 payload is read once per process (≈150 KB on the wire). If the file
 * is missing — a broken deployment — the document falls back to the CDN link
 * below rather than rendering in an unexpected typeface with no explanation.
 */
const EMBEDDED_FONT = (() => {
  try {
    const bytes = readFileSync(join(process.cwd(), "public", "fonts", "Vazirmatn-variable.woff2"));
    return bytes.toString("base64");
  } catch {
    return "";
  }
})();

const FONT_FACE_CSS = EMBEDDED_FONT
  ? `@font-face{font-family:"Vazirmatn";src:url(data:font/woff2;base64,${EMBEDDED_FONT}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}`
  : "";

const FALLBACK_FONT_LINK: string = EMBEDDED_FONT
  ? ""
  : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"/>`;

const RATE_KIND_LABEL: Record<string, string> = {
  "official-wage": "نرخ رسمی (بدون سند در سامانه)",
  "market-quote": "بازار (نقل بازار)",
  "reference-estimate": "برآوردی/داده مرجع",
};

/** escapes untrusted project text before it is embedded in the HTML report */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const LOGO_MARK = `<svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lp" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0e2745"/><stop offset="100%" stop-color="#123a66"/></linearGradient><linearGradient id="lb" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#8ab2e3"/><stop offset="100%" stop-color="#ffffff"/></linearGradient></defs><path d="M32 2.6 57.4 17.3v29.4L32 61.4 6.6 46.7V17.3z" fill="url(#lp)"/><path d="M14.5 24.5c7.4-6.6 15.2-8.6 23.3-6" fill="none" stroke="#e2a13a" stroke-width="2.6" stroke-linecap="round"/><rect x="17" y="36" width="7.5" height="9" rx="1.8" fill="url(#lb)" opacity=".55"/><rect x="27.5" y="31" width="7.5" height="14" rx="1.8" fill="url(#lb)" opacity=".8"/><rect x="38" y="25.5" width="7.5" height="19.5" rx="1.8" fill="#eeb95c"/><rect x="17" y="47.5" width="28.5" height="2.4" rx="1.2" fill="rgba(255,255,255,.35)"/></svg>`;

const CSS = `${FONT_FACE_CSS}
:root{--navy:#12335a;--ink:#101a24;--line:#d7dee6;--muted:#5b6b7b}
*{box-sizing:border-box}
body{margin:0;background:#eef1f5;color:var(--ink);font-family:Vazirmatn,Tahoma,system-ui,sans-serif;font-size:11.4px;line-height:1.85;direction:rtl;font-feature-settings:"ss01"}
.sheet{width:210mm;min-height:297mm;margin:10mm auto;padding:16mm 14mm 20mm;background:#fff;box-shadow:0 10px 40px rgba(9,30,60,.15);position:relative}
header.cover{border-bottom:2px solid var(--navy);padding-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
h1{margin:0;font-size:24px;font-weight:900;color:#0d1f39}
h2{font-size:15px;margin:0}
h3,h4{margin:18px 0 6px;font-size:12.5px;color:var(--navy)}
.sec{margin:18px 0 26px}
.sec>.t{display:flex;gap:10px;align-items:center;border-bottom:2px solid var(--navy);padding-bottom:6px;margin-bottom:12px;color:var(--navy)}
.sec .idx{display:inline-flex;min-width:26px;height:26px;align-items:center;justify-content:center;border-radius:6px;background:var(--navy);color:#fff;font-weight:700;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:10.4px;margin:6px 0 2px}
th{background:var(--navy);color:#fff;padding:6px 7px;border:1px solid #0e2946;text-align:right;font-weight:600;white-space:nowrap}
td{border:1px solid var(--line);padding:5px 7px;vertical-align:middle;line-height:1.7}
tbody tr:nth-child(even) td{background:#f4f7fa}
tfoot td{background:#e8eef4;font-weight:700}
.kv td{padding:6px 8px}
.kv td.k{width:34%;font-weight:600;color:#2a3f52}
.indent{display:inline-block;padding-right:14px}
.crit{color:#b42318;font-weight:700}
.callout{border-right:4px solid var(--navy);background:#f3f7fb;padding:10px 12px;border-radius:0 6px 6px 0}
.bullets{margin:10px 0 0;padding-right:18px}
.bullets li{margin:4px 0;line-height:1.95;break-inside:avoid}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:10px}
.kpi b{display:block;font-size:15px;margin-top:3px;color:var(--navy)}
.note{font-size:9.6px;color:var(--muted);margin-top:6px;line-height:1.9}
.warn-mark{display:inline-block;margin-left:4px;color:#b45309;direction:ltr}
footer{position:absolute;bottom:8mm;left:14mm;right:14mm;display:flex;justify-content:space-between;border-top:1px solid #e2e8ee;padding-top:4px;font-size:9px;color:#6b7a8a}
.badge{display:inline-block;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}
.g{background:#dcfce7;color:#166534}.w{background:#fef3c7;color:#92400e}.b{background:#fee2e2;color:#991b1b}
.n{background:#eef2f6;color:#475569}
/* screen-only helper */
.no-print{}
.no-screen{display:none}
.toc ol{margin:6px 0 0;padding-right:20px;columns:2;column-gap:26px;font-size:10.6px;line-height:2.1}
.toc li{break-inside:avoid}
@media screen and (max-width:720px){.sheet{width:auto;min-height:0;margin:0;padding:14px;box-shadow:none}body{font-size:12px}table{font-size:10px}.kpis{grid-template-columns:repeat(2,1fr)}}
/*
 * Print rules — this is what the PDF actually is.
 *
 * A report is printed to be signed and archived, so the paper copy has to be
 * complete on its own: every page carries the project name and page number
 * (CSS counters, so they stay right when content shifts), a section never
 * starts at the tail of a page, and a table header repeats on every page it
 * spans. Sizes are in pt because print media ignores px scaling.
 */
@page{size:A4;margin:14mm 12mm 18mm}
@media print{
  .no-print{display:none!important}
  html,body{background:#fff}
  body{font-size:9.6pt;line-height:1.75}
  .sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;break-before:page}
  /* The cover opens the document; every later sheet starts a fresh page. This
     direction of the rule cannot leave a blank page at the end, whereas
     "break-after:page" on the last sheet does. */
  .cover-sheet{break-before:auto}
  h1{font-size:19pt}h2{font-size:12pt}h3,h4{font-size:10pt}
  .sec{margin:10pt 0 14pt;break-inside:auto}
  .sec>.t{break-after:avoid;break-inside:avoid}
  /* A heading alone at the bottom of a page is the classic print defect. */
  h2,h3,h4{break-after:avoid;break-inside:avoid}
  table{font-size:8.3pt;width:100%}
  th{white-space:normal;padding:3.5pt 4pt;font-size:8pt}
  td{padding:3pt 4pt}
  thead{display:table-header-group}
  tfoot{display:table-row-group}
  tr{break-inside:avoid}
  .kpis{grid-template-columns:repeat(4,1fr);break-inside:avoid}
  .kpi{break-inside:avoid}
  .callout,.note{break-inside:avoid}
  /* Tables wider than the text column scroll on screen; on paper they must fit,
     so the print variant wraps instead of clipping. */
  .wide-wrap{overflow:visible!important;border:0!important;padding:0!important}
  svg{max-width:100%;height:auto}
  /* The chart is the one element whose value is destroyed by shrinking: it
     carries 21 rows of tiny labels. Give it a full page and let the SVG scale
     to the text column instead of squeezing it under a table. */
  .gantt-wrap{break-before:page;overflow:visible!important}
  a{color:inherit;text-decoration:none}
  .no-screen{display:block}
  .toc{break-after:page}
  .toc ol{columns:2}
  .cover-sheet{min-height:0}
  .toc-sheet{break-before:page}
}
`

/**
 * A cell value that already contains markup (a badge, a bold total, an indent).
 *
 * Table cells are **escaped by default**. Wrapping trusted markup in `raw()`
 * makes the exception explicit at the call site instead of hoping that no
 * caller ever forgets to pre-escape. Before this existed, `<b>` and
 * `<span class="badge">` were escaped into the cells and readers literally saw
 * `<span style="padding-right:18px">1.1</span>` printed in the report.
 */
class RawHtml {
  constructor(readonly value: string) {}
}
const raw = (value: string) => new RawHtml(value);

type Cell = string | number | RawHtml;

function cellHtml(cell: Cell | undefined): string {
  if (cell instanceof RawHtml) return cell.value;
  return esc(cell);
}

/** Wraps already-escaped markup for a table cell without re-escaping it. */
const markup = (html: string) => new RawHtml(html);

/**
 * Percent for display, RTL-safe.
 *
 * In RTL text a trailing `%` is *bidi-ambiguous*: "۰%" renders as "%۰" in some
 * runs and "۰٪" in others, so the same report mixed both. Leading the value with
 * the Persian percent sign (U+066A) puts the mark where it reads correctly and
 * matches the rest of the product.
 */
function pct(value: number | string, digits = 0): string {
  if (typeof value === "string" && !/^[\d.,-]+$/.test(value)) return value;
  const text = typeof value === "number" ? formatNumber(value, digits) : value;
  const digitsText = toPersianDigits(text);
  // A leading "." is bidi-neutral: in an RTL cell "۰.۵" was painted as "۵.۰".
  // Wrapping the numeric run keeps its own left-to-right order, so the printed
  // value always reads exactly as the engine produced it.
  const numeric = /[.٫]/.test(digitsText) ? `<bdi>${digitsText}</bdi>` : digitsText;
  return `${numeric}٪`;
}

function table(headers: string[], rows: Cell[][], footer?: Cell[]) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cellHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>${
    footer ? `<tfoot><tr>${footer.map((cell) => `<td>${cellHtml(cell)}</td>`).join("")}</tr></tfoot>` : ""
  }</table>`;
}

/** Printed mirror of the app's `statusTone`/`statusLabel` (single definition). */
const TONE_CLASS: Record<BadgeTone, string> = { ok: "g", warn: "w", bad: "b", neutral: "n" };

function kpiCard(label: string, value: string, status: Status) {
  return `<div class="kpi"><span style="font-size:9.5px;color:#64748b">${esc(label)}</span><b>${esc(value)}</b><span class="badge ${TONE_CLASS[statusTone(status)]}" style="margin-top:4px">${statusLabel(status)}</span></div>`;
}

/**
 * Percent values arrive as numbers; `??` alone would print 0 for a legitimately
 * zero rate, so the fallback is applied only when the field is truly absent.
 */
function asPercent(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Pricing defaults live in one place (`lib/market/engine.ts`). They are repeated
 * here only as the *display* fallback for an input that carries no pricing block
 * at all; keeping the numbers in one named object makes the drift obvious.
 */
const DEFAULT_PRICING_PERCENT = { overhead: 17, profit: 10, contingency: 5 } as const;

/**
 * Project types are stored as stable English codes (`construction`, `it`,
 * …). A client-facing report must not print the code — buildwizard shows the
 * Persian label, and the report has to agree with the screen it accompanies.
 */
const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  construction: "ساختمان (مسکونی / اداری)",
  civil: "عمرانی و زیرساخت",
  architecture: "طراحی و معماری",
  infrastructure: "زیرساخت و تأسیسات",
  software: "نرم‌افزار و فناوری",
  manufacturing: "صنعت و تولید",
  research: "پژوهش",
  event: "رویداد",
  renovation: "نوسازی و بازسازی",
  general: "عمومی (چندمنظوره)",
};

const CONSTRAINT_NAMES: Record<string, string> = {
  ASAP: "در اولین زمان ممکن",
  SNET: "شروع نه زودتر از",
  MSO: "باید در تاریخ شروع شود",
  FNLT: "پایان نه دیرتر از",
};

/** Human readable constraint cell, including a violation marker. */
function constraintLabel(activity: { constraint: { type: string; date?: string; conflict?: string } }): string {
  const type = activity.constraint?.type ?? "ASAP";
  if (type === "ASAP") return "—";
  const name = CONSTRAINT_NAMES[type] ?? type;
  const date = activity.constraint.date ? ` ${activity.constraint.date}` : "";
  return activity.constraint.conflict ? `${name}${date} ⚠ ${esc(activity.constraint.conflict)}` : `${name}${date}`;
}

export function buildReportHtml(
  project: ProjectInput,
  analysis: ProjectAnalysis,
  ganttSvg: string,
): string {
  const a = analysis;
  const currency = project.meta.currency;
  const money = (value: number) =>
    currency === "IRR" ? (value === 0 ? "۰" : formatCompact(value)) : formatNumber(value);
  let index = 0;
  const next = () => ++index;
  const statusText =
    a.health.status === "good" ? "در وضعیت مطلوب" : a.health.status === "watch" ? "نیازمند پایش" : "در وضعیت بحرانی";

  const sections: string[] = [];
  /** Section titles in render order — the printed table of contents. */
  const contents: string[] = [];
  const section = (title: string, body: string) => {
    contents.push(title);
    sections.push(
      `<div class="sec"><div class="t"><span class="idx">${toPersianDigits(next())}</span><h2>${title}</h2></div>${body}</div>`,
    );
  };

  section("خلاصه مدیریتی", `<div class="callout"><b>${esc(a.summary.headline)}</b></div>
    <ul class="bullets">${a.summary.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);

  if (a.diagnostics.length || a.unschedulable.length) {
    const statusLabel =
      a.status === "valid"
        ? "تحلیل معتبر"
        : a.status === "warning"
          ? "تحلیل معتبر همراه با هشدار"
          : a.status === "inconsistent"
            ? "زمان‌بندی ناسازگار (تعارض محدودیت/منطق)"
            : "تحلیل نامعتبر (خطای داده یا گراف وابستگی)";
    section("وضعیت تحلیل و هشدارهای مهندسی", `<div class="callout"><b>${esc(statusLabel)}</b></div>
      ${table(
        ["شدت", "دسته", "پیام", "راه‌حل"],
        a.diagnostics.map((d) => [
          d.severity === "error" ? raw("<b>خطا</b>") : "هشدار",
          d.kind === "data"
            ? "داده"
            : d.kind === "cycle"
              ? "چرخه وابستگی"
              : d.kind === "dependency"
                ? "منطق شبکه"
                : d.kind === "constraint"
                  ? "محدودیت زمانی"
                  : d.kind === "capacity"
                    ? "ظرفیت منابع"
                    : "تقویم",
          esc(d.message),
          esc(d.remedy ?? "—"),
        ]),
      )}
      ${
        a.unschedulable.length
          ? `<p class="note">فعالیت‌های بدون زمان‌بندی معتبر: ${a.unschedulable
              .map((u) => esc(`${u.code} — ${u.name} (${u.reason})`))
              .join(" · ")}</p>`
          : ""
      }`);
  }

  section("مشخصات پروژه", `<table class="kv"><tbody>${[
      ["نام پروژه", esc(project.meta.name)],
      ["نوع پروژه", esc(PROJECT_TYPE_LABEL[project.meta.type] ?? project.meta.type)],
      ["کارفرما", esc(project.meta.client ?? "—")],
      ["پیمانکار", esc(project.meta.contractor ?? "—")],
      ["مشاور", esc(project.meta.consultant ?? "—")],
      ["مدیر پروژه", esc(project.meta.manager ?? "—")],
      ["تاریخ شروع", formatJalali(a.schedule.startDate)],
      ["تاریخ پایان", formatJalali(a.schedule.finishDate)],
      ["مدت پروژه", `${toPersianDigits(a.schedule.workingDays)} روز کاری`],
      ["تقویم کاری", `${toPersianDigits(a.schedule.workDayCount)} روز در هفته · ${toPersianDigits(a.schedule.hoursPerDay)} ساعت`],
      ["مبنای قیمت‌گذاری", esc(`${a.pricing.seriesLabel} — منطقه ${a.pricing.regionLabel} (تاریخ نرخ: ${a.pricing.asOfJalali})`)],
      ["نرخ تعدیل ماهانه", `${pct(a.pricing.escalationRatePerMonth)}`],
    ]
      .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`)
      .join("")}</tbody></table>`);

  section("شاخص‌های کلیدی عملکرد", `<div class="kpis">${a.kpis
      .slice(0, 8)
      .map((kpi) =>
        kpiCard(
          kpi.label,
          // `schedule.finish` arrives as an ISO date; render it like every other
          // date in the report instead of passing the ISO string through.
          kpi.key === "finish" ? formatJalali(kpi.value) : kpi.value,
          kpi.status,
        ),
      )
      .join("")}</div>`);

  section("ساختار شکست کار (WBS)", `${table(
      ["کد", "شرح", "مدت", "شروع", "پایان", "پیشرفت", "بودجه"],
      a.wbs.flatMap((phase) => [
        [
          raw(`<b>${esc(phase.wbs)}</b>`),
          raw(`<b>${esc(phase.name)}</b>`),
          toPersianDigits(phase.duration ?? 0),
          formatJalali(phase.startDate ?? ""),
          formatJalali(phase.finishDate ?? ""),
          pct(phase.progress ?? 0, 0),
          money(phase.budget ?? 0),
        ],
        ...phase.children.map((child) => [
          raw(`<span class="indent">${esc(child.wbs)}</span>`),
          raw(`<span class="indent">${esc(child.name)}</span>`),
          toPersianDigits(child.duration ?? 0),
          formatJalali(child.startDate ?? ""),
          formatJalali(child.finishDate ?? ""),
          pct(child.progress ?? 0, 0),
          money(child.budget ?? 0),
        ]),
      ]),
    )}`);

  section("زمان‌بندی و شناوری فعالیت‌ها", `${table(
      ["کد", "فعالیت", "مدت", "شروع", "پایان", "شناوری کل", "شناوری آزاد", "بحرانی", "محدودیت"],
      a.activities.map((act) => [
        act.code,
        act.name,
        toPersianDigits(act.duration),
        formatJalali(act.startDate),
        formatJalali(act.finishDate),
        // A float *column* must hold float values only. Printing the word
        // "بحرانی" here duplicated the critical flag in the neighbouring column
        // and made the column unreadable as a number series; a dash keeps the
        // meaning (zero float) while staying numerically honest.
        act.totalFloat === 0 ? "۰" : toPersianDigits(act.totalFloat),
        toPersianDigits(act.freeFloat),
        act.critical ? raw('<span class="crit">● بله</span>') : "خیر",
        constraintLabel(act),
      ]),
    )}`);

  if (ganttSvg) {
    section(
    "نمودار گانت",
    `<div class="gantt-wrap" style="border:1px solid var(--line);border-radius:8px;padding:6px;overflow:auto">${ganttSvg}</div>`,
  );
  }

  section("پیشرفت و مدیریت ارزش کسب‌شده (EVM)", `${table(
      ["سنجه", "مقدار", "تعریف"],
      [
        ["پیشرفت زمان‌محور (وزن: مدت کاری)", markup(pct(a.progress.timeBased, 1)), "Σ(مدت × کسر برنامه‌ای) ÷ Σ مدت"],
        [
          "پیشرفت فیزیکی (وزن: بودجه)",
          a.progress.physical === null
            ? "اندازه‌گیری نشده"
            : markup(`${pct(a.progress.physical, 1)} <span style="color:#64748b">(پوشش ${pct(a.progress.physicalCoverage)} بودجه)</span>`),
          "Σ(مقدار اجرا ÷ مقدار برنامه) × بودجه فعالیت",
        ],
        [
          "پیشرفت مالی (وزن: بودجه)",
          a.progress.financial === null ? "قابل محاسبه نیست" : markup(pct(a.progress.financial, 1)),
          "ارزش کسب‌شده ÷ بودجه کل",
        ],
        ["پیشرفت برنامه‌ای تا تاریخ وضعیت", markup(pct(a.progress.planned, 1)), "تاریخ وضعیت = آغاز همان روز کاری"],
        ["PV / EV", `${money(a.evm.pv)} / ${money(a.evm.ev)}`, "ارزش برنامه‌ای / ارزش کسب‌شده"],
        ["AC", a.evm.ac === null ? "ثبت نشده" : money(a.evm.ac), markup(`پوشش هزینه واقعی: ${pct(a.evm.costDataCoverage)} بودجه`)],
        ["SV / CV", markup(`${money(a.evm.sv)} / ${a.evm.cv === null ? "قابل محاسبه نیست" : money(a.evm.cv)}`), "EV − PV / EV − AC"],
        ["SPI / CPI", `${a.evm.spi === null ? "قابل محاسبه نیست" : toPersianDigits(a.evm.spi)} / ${a.evm.cpi === null ? "قابل محاسبه نیست" : toPersianDigits(a.evm.cpi)}`, "EV ÷ PV / EV ÷ AC"],
        ["BAC / EAC / ETC / VAC", `${money(a.evm.bac)} / ${a.evm.eac === null ? "—" : money(a.evm.eac)} / ${a.evm.etc === null ? "—" : money(a.evm.etc)} / ${a.evm.vac === null ? "—" : money(a.evm.vac)}`, "EAC = BAC ÷ CPI"],
      ],
    )}${a.evm.notes
      .map((note) => `<p class="note"><span class="warn-mark" aria-hidden="true">⚠</span> ${esc(note)}</p>`)
      .join("")}`);

  if (a.milestones.length) {
    section("نقاط کنترل (Milestones)", `${table(
        ["عنوان", "فاز", "تاریخ", "وضعیت", "فعالیت مرتبط"],
        a.milestones.map((m) => [
          m.name,
          m.phase,
          m.date ? formatJalali(m.date) : "بدون تاریخ",
          m.status === "reached" ? "محقق‌شده" : m.status === "late" ? "در تأخیر" : m.status === "unscheduled" ? "زمان‌بندی‌نشده" : "در پیش رو",
          m.linkedActivityCode ?? "—",
        ]),
      )}`);
  }

  if (a.baseline.available) {
    section("مقایسه با مبنای برنامه (Baseline)", `<p class="note">بیشینه جابه‌جایی شروع: ${toPersianDigits(a.baseline.maxStartSlipDays)} روز کاری — بیشینه جابه‌جایی پایان: ${toPersianDigits(a.baseline.maxFinishSlipDays)} روز کاری — تغییر هزینه: ${money(a.baseline.costVariance)}</p>
      ${table(
        ["کد", "فعالیت", "شروع مبنا", "شروع فعلی", "انحراف شروع", "پایان مبنا", "پایان فعلی", "انحراف پایان", "تغییر مدت"],
        a.baseline.changedActivities.map((c) => [
          c.code,
          c.name,
          formatJalali(c.baselineStart),
          formatJalali(c.currentStart),
          toPersianDigits(c.startVarianceDays),
          formatJalali(c.baselineFinish),
          formatJalali(c.currentFinish),
          toPersianDigits(c.finishVarianceDays),
          toPersianDigits(c.durationChange),
        ]),
      )}`);
  }

  section("هزینه، سناریوی افزایش هزینه و برآورد نهایی", `${table(
      ["شرح", "مبلغ"],
      [
        ["هزینه‌های مستقیم (کار، ماشین، مصالح)", money(a.pricing.breakdown.direct)],
        // The rate is the *input* percentage, not derived from the amount: a
        // formula like `overhead ? overheadPercent : 0` printed "0٪" over a
        // non-zero amount whenever the two disagreed by rounding.
        [`هزینه‌های بالاسری (${pct(asPercent(project.pricing?.overheadPercent, DEFAULT_PRICING_PERCENT.overhead))})`, money(a.pricing.breakdown.overhead)],
        [`سود پیمانکار (${pct(asPercent(project.pricing?.profitPercent, DEFAULT_PRICING_PERCENT.profit))})`, money(a.pricing.breakdown.profit)],
        [`ذخیره احتیاطی (${pct(asPercent(project.pricing?.contingencyPercent, DEFAULT_PRICING_PERCENT.contingency))})`, money(a.pricing.breakdown.contingency)],
        ["سناریوی افزایش هزینه (تورم مرکب ماهانه — نه تعدیل قراردادی)", money(a.pricing.breakdown.escalation)],
        [raw("<b>جمع برآورد نهایی</b>"), raw(`<b>${esc(money(a.pricing.breakdown.total))}</b>`)],
      ],
    )}
    <p class="note">مبنای نرخ‌ها: ${a.pricing.seriesLabel} — ${a.pricing.asOfJalali}؛ منطقه: ${a.pricing.regionLabel}؛ ضریب تعدیل عمومی: ${pct(a.pricing.indexFactor)}`
      + `${a.pricing.ratePolicy ? ` — ${a.pricing.ratePolicy.note}` : ""}`
      + `${a.pricing.escalation.note ? ` — ${a.pricing.escalation.note}` : ""}</p>
    ${
      a.pricing.escalation.months.length
        ? table(
            ["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب افزایش هزینه", "هزینه افزایش‌یافته", "مبلغ افزایش"],
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
    }
    ${
      a.pricing.rates.length
        ? `<h3 class="h3">نرخ‌های اعمال‌شده روی منابع پروژه</h3>${table(
            ["منبع", "نوع داده", "واحد", "ارز", "نرخ اعمال‌شده", "تاریخ مرجع", "سند / پیوند", "اعتبار منبع"],
            a.pricing.rates.map((rate) => [
              esc(rate.name),
              esc(RATE_KIND_LABEL[rate.provenance?.kind ?? "reference-estimate"]),
              esc(rate.unit ?? "—"),
              esc(rate.provenance?.currency ?? "IRR"),
              money(rate.rate),
              formatJalali(rate.provenance?.asOfIso ?? a.pricing.asOf),
              esc(
                rate.provenance?.sourceRef || rate.provenance?.sourceUrl
                  ? [rate.provenance.sourceRef, rate.provenance.sourceUrl].filter(Boolean).join(" · ")
                  : "سند ثبت نشده",
              ),
              esc(rate.verified ? "تأییدشده" : "تأییدنشده (داده مرجع)"),
            ]),
          )}<p class="note">نرخ ستون «نرخ اعمال‌شده» همان نرخی است که در محاسبات این پروژه به‌کار رفته است؛
            اختلاف نرخ نمایش‌داده‌شده و نرخ اعمال‌شده در این سامانه وجود ندارد. سند رسمی هیچ ردیف در سامانه
            نگهداری نمی‌شود، بنابراین همه ردیف‌ها «تأییدنشده» علامت خورده‌اند.</p>`
        : ""
    }`);

  section("منابع و تخصیص (بدون تسطیح خودکار)", `${table(
      ["منبع", "واحد", "ظرفیت", "واحد-روز", "اوج تخصیص", "بهره‌وری", "هزینه", "مبنای نرخ"],
      a.resources.map((r) => [
        r.name,
        project.resources.find((x) => x.id === r.id)?.unit ?? "—",
        toPersianDigits(r.capacity),
        toPersianDigits(r.totalUnits),
        r.overallocated ? `${toPersianDigits(r.peakUnits)} ⚠` : toPersianDigits(r.peakUnits),
        pct(r.utilization, 0),
        money(r.cost),
        project.resources.find((x) => x.id === r.id)?.rateSource ?? "—",
      ]),
    )}`);

  if (a.risks.length) {
    section("ریسک‌های پروژه", `${table(
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
      )}`);
  }

  section("وضعیت و سلامت پروژه", `${table(
      ["حوزه", "وضعیت", "توضیح"],
      a.health.signals.map((s) => [
        s.label,
        raw(
          `<span class="badge ${TONE_CLASS[statusTone(s.status)]}">${statusLabel(s.status)}</span>`,
        ),
        s.detail,
      ]),
    )}
    <p class="note">${
      a.health.status === "na"
        ? "امتیاز سلامت پروژه محاسبه نشد: هیچ سیگنالی برای ارزیابی تعریف نشده است."
        : `امتیاز سلامت پروژه: ${toPersianDigits(a.health.score)} از ۱۰۰ — ${statusText}`
    }</p>`);

  section("تأیید و امضا", `${table(
      ["سمت", "نام", "امضا", "تاریخ"],
      [
        ["تهیه‌کننده / برنامه‌ریز", esc(project.meta.manager ?? "—"), "", ""],
        ["کنترل پروژه", "—", "", ""],
        ["دستگاه نظارت / مشاور", esc(project.meta.consultant ?? "—"), "", ""],
        ["کارفرما", esc(project.meta.client ?? "—"), "", ""],
      ],
    )}
    <p class="note" style="margin-top:14px">HERMIPLAN — Created by Mohammad Shirmardi · تولید گزارش: ${esc(formatJalali(project.meta.statusDate))}</p>`);

  /**
   * Printed table of contents.
   *
   * The PDF is handed to a client or an auditor as a document, not scrolled on a
   * screen, so it needs an index — and the index has to agree with the numbered
   * section headings. Both are generated from the same `contents` array, so they
   * cannot drift apart.
   */
  const coverToc = contents.length
    ? `<nav class="toc"><h3 style="margin-top:18px">فهرست مطالب</h3><ol>${contents
        .map((title) => `<li>${esc(title)}</li>`)
        .join("")}</ol></nav>`
    : "";

  /**
   * Running footer for paper.
   *
   * A `position:fixed` element repeats on every printed page in Chromium, which
   * makes it the right vehicle for identity (project + date + product) and the
   * wrong one for page numbers: every page would show the same number. Page
   * numbering is therefore left to the print engine, which writes "1/8" in the
   * page margin. The earlier footer claimed a number with `counter(page)` and
   * rendered "صفحه 0 / 0" — Chromium does not implement that counter in print.
   */
  const printFurniture = `<div class="print-footer no-screen">
      <span>${esc(project.meta.name)}</span>
      <span>HERMIPLAN · ${formatJalali(project.meta.statusDate)}</span>
    </div>`;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>گزارش ${esc(project.meta.name)} | HERMIPLAN</title>
${FALLBACK_FONT_LINK}
<style>${CSS}</style></head>
<body>
  <div class="no-print" style="direction:rtl;font-family:Vazirmatn,Tahoma,sans-serif;background:#0a1c37;color:#e2e8f0;padding:14px 18px;font-size:12.5px;line-height:2">
    <b>HERMIPLAN</b> — برای تولید PDF از این گزارش، فایل را در مرورگر باز کنید و
    <span style="direction:ltr;display:inline-block">Ctrl+P</span> → «Save as PDF» را انتخاب کنید؛ خروجی A4 با صفحه‌بندی و سرستون‌های تکرارشونده ساخته می‌شود.
    <span style="opacity:.65">Created by Mohammad Shirmardi</span>
  </div>
  <div class="sheet cover-sheet">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="display:flex;align-items:center;gap:10px">
        ${LOGO_MARK}
        <div>
          <p style="margin:0;font-size:11px;letter-spacing:.34em;color:#1f4a80;font-weight:800">HERMIPLAN</p>
          <p style="margin:0;font-size:9px;color:#7b8a99">Project Intelligence Platform</p>
        </div>
      </div>
      <div style="text-align:left;font-size:10px;color:#64748b">
        <p style="margin:0">تاریخ گزارش: ${formatJalali(project.meta.statusDate)}</p>
        <p style="margin:0">مبنای نرخ: ${a.pricing.asOfJalali}</p>
        <p style="margin:0">کد پروژه: ${esc(project.meta.code ?? "—")}</p>
      </div>
    </div>

    <div style="margin-top:52mm;border-top:3px solid var(--navy);border-bottom:1px solid #c8d3de;padding:22px 0">
      <p style="margin:0;font-size:10.5px;letter-spacing:.18em;color:#1f4a80;font-weight:700">گزارش مدیریت، زمان‌بندی و کنترل پروژه</p>
      <h1 style="margin:8px 0 10px;font-size:26pt;line-height:1.35">${esc(project.meta.name)}</h1>
      <p style="margin:0;color:#43566a;font-size:11.5px">${esc(
        [PROJECT_TYPE_LABEL[project.meta.type] ?? project.meta.type, project.meta.location ?? ""].filter(Boolean).join(" — "),
      )}</p>
    </div>

    <table class="kv" style="margin-top:18px;font-size:10.5px"><tbody>
      <tr><td class="k">کارفرما</td><td>${esc(project.meta.client ?? "—")}</td><td class="k">مشاور</td><td>${esc(project.meta.consultant ?? "—")}</td></tr>
      <tr><td class="k">پیمانکار</td><td>${esc(project.meta.contractor ?? "—")}</td><td class="k">مدیر پروژه</td><td>${esc(project.meta.manager ?? "—")}</td></tr>
      <tr><td class="k">تاریخ شروع</td><td>${formatJalali(a.schedule.startDate)}</td><td class="k">تاریخ پایان</td><td>${formatJalali(a.schedule.finishDate)}</td></tr>
      <tr><td class="k">مدت کل</td><td>${toPersianDigits(a.schedule.workingDays)} روز کاری <span style="color:#7b8a99">(${toPersianDigits(a.schedule.calendarDays)} روز تقویمی)</span></td><td class="k">تعداد فعالیت</td><td>${toPersianDigits(a.activities.length)}</td></tr>
      <tr><td class="k">برآورد نهایی</td><td colspan="3"><b>${money(a.pricing.breakdown.total)} ${currency === "IRR" ? "ریال" : currency}</b></td></tr>
    </tbody></table>

    <div style="margin-top:14px" class="callout"><b>${esc(a.summary.headline)}</b></div>
  </div>

  <div class="sheet toc-sheet">
    ${coverToc}
  </div>

  <div class="sheet">
    ${sections.join("\n")}
    <footer><span>HERMIPLAN — Project Intelligence Platform</span><span>Created by Mohammad Shirmardi</span></footer>
  </div>
  ${printFurniture}
</body></html>`;
}
