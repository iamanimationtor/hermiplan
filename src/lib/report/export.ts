import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

type Row = (string | number)[];

export interface Sheet {
  name: string;
  headers: string[];
  rows: Row[];
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
    rows: [
      ["نام پروژه", input.meta.name],
      ["کد پروژه", input.meta.code ?? ""],
      ["نوع پروژه", input.meta.type],
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
      ["پیشرفت فیزیکی (٪)", a.progress.overall],
      ["پیشرفت برنامه‌ای (٪)", a.progress.planned],
      ["SPI", a.progress.schedulePerformanceIndex],
      ["CPI", a.progress.costPerformanceIndex],
      ["امتیاز سلامت", a.health.score],
    ],
  });

  sheets.push({
    name: "Activities",
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
      act.budgetCost,
      act.actualCost,
      act.resourceNames.join("، "),
    ]),
  });

  sheets.push({
    name: "Milestones",
    headers: ["عنوان نقطه کنترل", "فاز", "تاریخ", "وضعیت", "فعالیت مرتبط"],
    rows: a.milestones.map((m) => [
      m.name,
      m.phase,
      m.date,
      m.status === "reached" ? "محقق‌شده" : m.status === "late" ? "در تأخیر" : "در پیش رو",
      m.linkedActivityCode ?? "",
    ]),
  });

  sheets.push({
    name: "Resources",
    headers: ["منبع", "نوع", "نرخ روزانه", "ظرفیت", "واحد-روز تخصیص", "اوج تخصیص", "تاریخ اوج", "بهره‌وری (٪)", "هزینه"],
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
    rows: a.costs.byPhase.map((p) => [p.phase, p.budget, p.actual, p.progress]),
  });

  sheets.push({
    name: "Risks",
    headers: ["ریسک", "دسته", "احتمال", "اثر", "امتیاز", "سطح", "اثر زمانی (روز)", "اثر مالی", "راهکار کاهش", "مسئول"],
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
    rows: input.resources.map((r) => [r.name, r.rateKey ?? "—", r.unit ?? "—", r.rate, r.rateSource ?? "نرخ دستی کاربر", r.capacity]),
  });

  if (a.pricing.escalation.months.length) {
    sheets.push({
      name: "Escalation",
      headers: ["ماه", "روز کاری", "هزینه برنامه‌ای", "ضریب تعدیل", "هزینه تعدیل‌شده", "مبلغ تعدیل"],
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
    rows: a.standards.map((s2) => [s2.code, s2.title, s2.scope === "national" ? "ملی" : "بین‌المللی", s2.body]),
  });

  if (a.baseline.available) {
    sheets.push({
      name: "Baseline",
      headers: ["کد", "فعالیت", "شروع مبنا", "شروع فعلی", "پایان مبنا", "پایان فعلی", "انحراف (روز)", "بودجه مبنا", "بودجه فعلی"],
      rows: a.baseline.changedActivities.map((c) => [
        c.code,
        c.name,
        c.baselineStart,
        c.currentStart,
        c.baselineFinish,
        c.currentFinish,
        c.varianceDays,
        c.baselineCost,
        c.currentCost,
      ]),
    });
  }

  return sheets;
}

/** neutralises spreadsheet formula injection (=, +, -, @, tab, CR) in untrusted cells */
function csvSafe(value: string): string {
  return /^[=+@\t\r]/.test(value) ? `'${value}` : value;
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

  const worksheets = sheets
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
