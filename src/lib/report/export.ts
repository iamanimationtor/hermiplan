import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

type Row = (string | number)[];

/** Human labels for the ten `ProjectType` codes (the raw code is an id, not a value). */
const PROJECT_TYPE_LABEL: Record<ProjectInput["meta"]["type"], string> = {
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

/**
 * How a column must be stored *and* displayed in a spreadsheet.
 *
 * Numbers have to stay numbers (so Excel can sum a budget column) while still
 * being *shown* the way the report shows them. One format for the whole sheet
 * cannot do that: it printed "2 days" as "2.00" and turned percentages into
 * raw decimals. Each sheet therefore declares its column kinds, and the xlsx
 * writer maps each kind to its own number format.
 *
 *  • `text`    — bullets, codes, Persian sentences (stored as text)
 *  • `wbs`     — "1.2.3" outline numbers (text on purpose: 1.10 ≠ 1.1)
 *  • `integer` — whole counts (activities, days, personnel)
 *  • `decimal` — indices and ratios with one decimal (SPI, productivity)
 *  • `money`   — currency, thousands separators, no decimals
 *  • `percent` — a 0..100 number from the engine (54.2 means 54.2%). The
 *                workbook divides it by 100 so Excel's own `0.0%` format shows
 *                "54.2%" and `SUM()`/averages stay meaningful.
 *  • `date`    — ISO `yyyy-mm-dd`, stored as a real Excel date
 */
export type ColumnKind = "text" | "wbs" | "integer" | "decimal" | "money" | "percent" | "date";

export interface Sheet {
  name: string;
  headers: string[];
  rows: Row[];
  /** Parallel to `headers`; missing entries default to `text`. */
  columnKinds?: ColumnKind[];
}

const xmlEscape = (value: string | number): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function buildSheets(analysis: ProjectAnalysis, input: ProjectInput): Sheet[] {
  const a = analysis;
  const sheets: Sheet[] = [];

  sheets.push({
    name: "Info",
    headers: ["فیلد", "مقدار"],
    columnKinds: ["text", "text"],
    rows: [
      ["نام پروژه", input.meta.name],
      ["کد پروژه", input.meta.code ?? ""],
      ["نوع پروژه", PROJECT_TYPE_LABEL[input.meta.type] ?? input.meta.type],
      ["کارفرما", input.meta.client ?? ""],
      ["پیمانکار", input.meta.contractor ?? ""],
      ["مشاور", input.meta.consultant ?? ""],
      ["مدیر پروژه", input.meta.manager ?? ""],
      ["موقعیت", input.meta.location ?? ""],
      ["تاریخ شروع", a.schedule.startDate],
      ["تاریخ پایان", a.schedule.finishDate],
      ["مدت (روز کاری)", a.schedule.workingDays],
      ["مدت (روز تقویمی)", a.schedule.calendarDays],
      ["ساعت کاری روزانه", a.schedule.hoursPerDay],
      ["تعداد فعالیت", a.activities.length],
      ["تعداد فاز", a.schedule.phases.length],
      ["بودجه تجمیعی", a.costs.budget],
      ["هزینه واقعی تا امروز", a.costs.actual],
      ["پیشرفت زمان‌محور — مدت‌وزنی (٪)", a.progress.timeBased],
      ["پیشرفت فیزیکی — مقدار اجرا (٪)", a.progress.physical ?? "ثبت نشده"],
      ["پیشرفت مالی — EV/BAC (٪)", a.progress.financial ?? "قابل محاسبه نیست"],
      ["پوشش پیشرفت فیزیکی (٪ بودجه)", a.progress.physicalCoverage],
      ["پیشرفت برنامه‌ای (٪)", a.progress.planned],
      ["SPI (EV/PV)", a.evm.spi ?? "قابل محاسبه نیست"],
      ["CPI (EV/AC)", a.evm.cpi ?? "قابل محاسبه نیست"],
      ["EAC = BAC/CPI", a.evm.eac ?? "قابل محاسبه نیست"],
      ["ETC = EAC − AC", a.evm.etc ?? "قابل محاسبه نیست"],
      ["VAC = BAC − EAC", a.evm.vac ?? "قابل محاسبه نیست"],
      ["پوشش داده هزینه واقعی (٪ بودجه)", a.evm.costDataCoverage],
      ["وضعیت تحلیل", a.status],
      ["امتیاز سلامت", a.health.score],
    ],
  });

  sheets.push({
    name: "Activities",
    // WBS/K, code, title, phase, duration, start, finish, LS, LF, TF, FF,
    // critical, progress, constraint, status, budget, actual, resources
    columnKinds: ["wbs", "text", "text", "text", "integer", "date", "date", "date", "date", "integer", "integer", "text", "percent", "text", "text", "money", "money", "text"],
    headers: [
      "WBS",
      "کد",
      "عنوان فعالیت",
      "فاز",
      "مدت (روز کاری)",
      "تاریخ شروع",
      "تاریخ پایان",
      "شروع دیرترین",
      "پایان دیرترین",
      "شناوری کل",
      "شناوری آزاد",
      "بحرانی",
      "پیشرفت (٪)",
      "محدودیت",
      "وضعیت محدودیت",
      "بودجه",
      "هزینه واقعی",
      "منابع",
    ],
    rows: a.activities.map((act) => [
      act.wbs,
      act.code,
      act.name,
      act.phase,
      act.duration,
      act.startDate,
      act.finishDate,
      act.lateStartDate,
      act.lateFinishDate,
      act.totalFloat,
      act.freeFloat,
      act.critical ? "بله" : "خیر",
      act.progress,
      act.constraint.type ?? "ASAP",
      act.constraint.conflict ?? (act.constraint.applied ? "اعمال‌شده" : "بدون اثر"),
      act.budgetCost,
      act.actualCost,
      act.resourceNames.join("، "),
    ]),
  });

  sheets.push({
    name: "Milestones",
    headers: ["عنوان نقطه کنترل", "فاز", "تاریخ", "وضعیت", "فعالیت مرتبط"],
    columnKinds: ["text", "text", "date", "text", "text"],
    rows: a.milestones.map((m) => [
      m.name,
      m.phase,
      m.date,
      m.status === "reached"
        ? "محقق‌شده"
        : m.status === "late"
          ? "در تأخیر"
          : m.status === "unscheduled"
            ? "زمان‌بندی‌نشده"
            : "در پیش رو",
      m.linkedActivityCode ?? "",
    ]),
  });

  sheets.push({
    name: "Resources",
    headers: ["منبع", "نوع", "نرخ روزانه", "ظرفیت", "واحد-روز تخصیص", "اوج تخصیص", "تاریخ اوج", "بهره‌وری (٪)", "هزینه"],
    columnKinds: ["text", "text", "money", "integer", "integer", "decimal", "date", "percent", "money"],
    rows: a.resources.map((r) => [
      r.name,
      r.type,
      r.rate,
      r.capacity,
      r.totalUnits,
      r.peakUnits,
      r.peakDate,
      r.utilization,
      r.cost,
    ]),
  });

  sheets.push({
    name: "Costs",
    headers: ["فاز", "بودجه", "هزینه واقعی", "پیشرفت (٪)"],
    columnKinds: ["text", "money", "money", "percent"],
    rows: a.costs.byPhase.map((p) => [p.phase, p.budget, p.actual, p.progress]),
  });

  sheets.push({
    name: "Risks",
    headers: ["ریسک", "دسته", "احتمال", "اثر", "امتیاز", "سطح", "اثر زمانی (روز)", "اثر مالی", "راهکار کاهش", "مسئول"],
    columnKinds: ["text", "text", "integer", "integer", "integer", "text", "integer", "money", "text", "text"],
    rows: a.risks.map((r) => [
      r.title,
      r.category,
      r.probability,
      r.impact,
      r.score,
      r.level,
      r.scheduleImpact,
      r.costImpact,
      r.mitigation ?? "",
      r.owner ?? "",
    ]),
  });

  if (a.delays.length) {
    sheets.push({
      name: "Delays",
      headers: ["کد", "فعالیت", "فاز", "پایان برنامه‌ای", "پیشرفت (٪)", "پیشرفت برنامه‌ای (٪)", "تأخیر (روز)", "بحرانی"],
      columnKinds: ["text", "text", "text", "date", "percent", "percent", "integer", "text"],
      rows: a.delays.map((d) => [
        d.code,
        d.name,
        d.phase,
        d.plannedFinish,
        d.progress,
        d.plannedProgress,
        d.slipDays,
        d.critical ? "بله" : "خیر",
      ]),
    });
  }

  sheets.push({
    name: "Pricing",
    headers: ["منبع", "کلید نرخ بازار", "واحد", "نرخ روزانه/قیمت واحد", "مبنای نرخ", "ظرفیت"],
    columnKinds: ["text", "text", "text", "money", "text", "integer"],
    rows: input.resources.map((r) => [r.name, r.rateKey ?? "—", r.unit ?? "—", r.rate, r.rateSource ?? "نرخ دستی کاربر", r.capacity]),
  });

  if (a.pricing.escalation.months.length) {
    sheets.push({
      name: "Escalation",
      headers: ["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب تعدیل", "هزینه تعدیل‌شده", "مبلغ تعدیل"],
      columnKinds: ["text", "integer", "money", "decimal", "money", "money"],
      rows: a.pricing.escalation.months.map((m) => [
        m.label,
        m.workingDays,
        m.plannedValue,
        m.factor,
        m.adjustedValue,
        m.escalation,
      ]),
    });
  }

  sheets.push({
    name: "CostSummary",
    headers: ["شرح", "مبلغ"],
    columnKinds: ["text", "money"],
    rows: [
      ["مبنای قیمت‌گذاری", a.pricing.seriesLabel],
      ["منطقه", a.pricing.regionLabel],
      ["تاریخ مرجع نرخ", a.pricing.asOfJalali],
      ["ضریب تعدیل عمومی (٪)", a.pricing.indexFactor],
      ["هزینه‌های مستقیم", a.pricing.breakdown.direct],
      ["هزینه‌های بالاسری", a.pricing.breakdown.overhead],
      ["سود پیمانکار", a.pricing.breakdown.profit],
      ["ذخیره احتیاطی", a.pricing.breakdown.contingency],
      ["تعدیل قیمت", a.pricing.breakdown.escalation],
      ["جمع برآورد نهایی", a.pricing.breakdown.total],
      ["هزینه واقعی تا تاریخ وضعیت", a.costs.actual],
      ["برآورد هزینه در پایان (EAC)", a.costs.estimateAtCompletion],
    ],
  });

  sheets.push({
    name: "Standards",
    headers: ["کد", "عنوان استاندارد", "سطح", "شرح"],
    columnKinds: ["text", "text", "text", "text"],
    rows: a.standards.map((s2) => [s2.code, s2.title, s2.scope === "national" ? "ملی" : "بین‌المللی", s2.body]),
  });

  if (a.diagnostics.length) {
    sheets.push({
      name: "Diagnostics",
      headers: ["شدت", "دسته", "کد", "پیام", "فعالیت‌های متأثر", "راه‌حل"],
      columnKinds: ["text", "text", "text", "text", "text", "text"],
      rows: a.diagnostics.map((d) => [
        d.severity === "error" ? "خطا" : "هشدار",
        d.kind,
        d.code,
        d.message,
        (d.activityIds ?? []).join("، "),
        d.remedy ?? "",
      ]),
    });
  }

  if (a.baseline.available) {
    sheets.push({
      name: "Baseline",
      columnKinds: ["text", "text", "date", "date", "integer", "date", "date", "integer", "integer", "text", "money", "money"],
      headers: [
        "کد",
        "فعالیت",
        "شروع مبنا",
        "شروع فعلی",
        "انحراف شروع (روز کاری)",
        "پایان مبنا",
        "پایان فعلی",
        "انحراف پایان (روز کاری)",
        "تغییر مدت (روز کاری)",
        "وضعیت نسبت به مبنا",
        "بودجه مبنا",
        "بودجه فعلی",
      ],
      rows: a.baseline.changedActivities.map((c) => [
        c.code,
        c.name,
        c.baselineStart,
        c.currentStart,
        c.startVarianceDays,
        c.baselineFinish,
        c.currentFinish,
        c.finishVarianceDays,
        c.durationChange,
        c.status === "later" ? "عقب‌تر" : c.status === "earlier" ? "زودتر" : c.status === "unknown" ? "نامشخص" : "مطابق برنامه",
        c.baselineCost,
        c.currentCost,
      ]),
    });
  }

  return sheets;
}

/**
 * Converts `percent` columns from the engine's 0..100 scale to the 0..1 scale
 * that Excel's percentage format expects.
 *
 * This is a *view* transform applied once, right before the workbook is
 * written: the CSV, the JSON and every chart keep reading the engine's own
 * 0..100 numbers, so there is still exactly one definition of "percent" in the
 * product. Without it a 54.2% utilisation cell displayed as "5420%", which is
 * worse than a lost decimal.
 */
export function percentColumnsAsFractions(sheets: Sheet[]): Sheet[] {
  return sheets.map((sheet) => {
    const kinds = sheet.columnKinds;
    if (!kinds || !kinds.includes("percent")) return sheet;
    const percentIndexes = kinds.map((kind, index) => (kind === "percent" ? index : -1)).filter((index) => index >= 0);
    return {
      ...sheet,
      rows: sheet.rows.map((row) => {
        const next = [...row];
        for (const index of percentIndexes) {
          const value = next[index];
          if (typeof value === "number" && Number.isFinite(value)) {
            next[index] = Math.round((value / 100) * 10000) / 10000;
          }
        }
        return next;
      }),
    };
  });
}

/**
 * Neutralises spreadsheet formula injection (CWE-1236) in untrusted cells.
 *
 * Excel and Google Sheets treat a cell that starts with `= + - @` or a control
 * character as a formula, so a project titled `=HYPERLINK(...)` would become a
 * live formula in the exported CSV. A leading apostrophe forces the cell to be
 * text. Plain numbers keep their leading minus so `-5` stays a number.
 */
const NUMERIC_CELL = /^-?[\d\u0660-\u0669\u06F0-\u06F9][\d\u0660-\u0669\u06F0-\u06F9,.\s]*$/;

function csvSafe(value: string): string {
  if (/^[=+@\t\r]/.test(value)) return `'${value}`;
  if (value.startsWith("-") && !NUMERIC_CELL.test(value)) return `'${value}`;
  return value;
}

export function buildCsv(sheet: Sheet): string {
  const lines = [sheet.headers.map((h) => csvSafe(String(h ?? ""))).join(",")];
  for (const row of sheet.rows) {
    lines.push(
      row
        .map((cell) => {
          const value = csvSafe(String(cell ?? ""));
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function buildExcelXml(sheets: Sheet[]): string {
  const styleHeader =
    '<Style ss:ID="hdr"><Font ss:FontName="Calibri" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#123A5C" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Center" ss:WrapText="1"/></Style>';
  const styleCell =
    '<Style ss:ID="cell"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE3EA"/></Borders></Style>';

  const worksheets = percentColumnsAsFractions(sheets)
    .map((sheet) => {
      const headerRow = `<Row>${sheet.headers
        .map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
        .join("")}</Row>`;
      const bodyRows = sheet.rows
        .map(
          (row) =>
            `<Row>${row
              .map((cell) =>
                typeof cell === "number" && Number.isFinite(cell)
                  ? `<Cell ss:StyleID="cell"><Data ss:Type="Number">${cell}</Data></Cell>`
                  : `<Cell ss:StyleID="cell"><Data ss:Type="String">${xmlEscape(cell ?? "")}</Data></Cell>`,
              )
              .join("")}</Row>`,
        )
        .join("");
      const cols = sheet.headers
        .map(() => '<Column ss:AutoFitWidth="0" ss:Width="120"/>')
        .join("");
      return `<Worksheet ss:Name="${xmlEscape(sheet.name).slice(0, 30)}"><Table ss:StyleID="cell" ss:DefaultRowHeight="18">${cols}${headerRow}${bodyRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>${styleHeader}${styleCell}</Styles>${worksheets}</Workbook>`;
}
