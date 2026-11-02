import { createZip, type ZipEntry } from "./zip";
import { buildCsv, buildSheets, type Sheet } from "./export";
import { buildXlsx } from "./xlsx";
import { buildExcelXml } from "./xls";
import { buildMsProjectXml } from "./msproject";
import { buildReportHtml } from "./html";
import { buildProjectJson } from "./json";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import type { ReportOptions } from "@/lib/validation";

export interface DeliveryOptions {
  ganttSvg: string;
  reportUrl: string;
  author?: string;
  reportOptions?: Partial<ReportOptions>;
}

function readMe(project: ProjectInput, analysis: ProjectAnalysis, options: DeliveryOptions, csvSheets: Sheet[]): string {
  const lines = [
    "════════════════════════════════════════════════════════",
    "  HERMIPLAN — بسته تحویل پروژه (Delivery Package)",
    "════════════════════════════════════════════════════════",
    "",
    `نام پروژه: ${project.meta.name}`,
    `کد پروژه: ${project.meta.code ?? "—"}`,
    `نوع پروژه: ${project.meta.type}`,
    `کارفرما: ${project.meta.client ?? "—"}`,
    `پیمانکار: ${project.meta.contractor ?? "—"}`,
    `مدیر پروژه: ${project.meta.manager ?? "—"}`,
    `تاریخ شروع برنامه (ISO/Gregorian): ${analysis.schedule.startDate}`,
    `تاریخ پایان برنامه (ISO/Gregorian): ${analysis.schedule.finishDate}`,
    `مدت پروژه: ${analysis.schedule.workingDays} روز کاری`,
    `تعداد فعالیت: ${analysis.activities.length}`,
    `واحد پول: ${project.meta.currency}`,
    `بودجه مستقیم محاسبه‌شده: ${analysis.costs.budget.toLocaleString("en-US")} ${project.meta.currency}`,
    `برآورد نهایی: ${analysis.pricing.breakdown.total.toLocaleString("en-US")} ${project.meta.currency}`,
    `مبنای قیمت‌گذاری: ${analysis.pricing.seriesLabel} — منطقه ${analysis.pricing.regionLabel}`,
    `تاریخ مرجع نرخ بازار: ${analysis.pricing.asOfJalali} (${analysis.pricing.asOf})`,
    `تولید تحلیل: ${analysis.generatedAt}`,
    "",
    "──────────────────── فایل‌های اصلی ────────────────────",
    "  Report.html       گزارش مستقل؛ برای PDF در مرورگر باز کرده و Print → Save as PDF را انتخاب کنید.",
    "  Data.xlsx         فایل واقعی Office Open XML با تاریخ و اعداد نوع‌دار، فیلتر، سطر ثابت و گانت جدولی.",
    "  Data.xls          SpreadsheetML 2003 برای Excelهای قدیمی؛ XML است، نه فایل باینری BIFF.",
    "  MSProject.xml     تبادل زمان‌بندی، روابط، تقویم و تخصیص منابع در قالب MSPDI.",
    "  Project.json      ورودی کامل پروژه، تحلیل و گزینه‌های گزارش برای تبادل سیستمی.",
    "",
    "──────────────────── CSVها ────────────────────",
    `  تعداد جدول‌های CSV: ${csvSheets.length}`,
    ...csvSheets.map((sheet) => `  CSV/${sheet.name}.csv`),
    "",
    "──────────────────── نکات داده ────────────────────",
    "• تاریخ‌های جدول‌های قابل‌ویرایش در Excel به‌صورت تاریخ واقعی Gregorian ذخیره شده‌اند و ستون شمسی کنار آن‌ها برای نمایش HERMIPLAN آمده است.",
    "• مقادیر مسیر بحرانی، شناوری، EVM، هزینه و منابع از تحلیل موتور HERMIPLAN گرفته شده‌اند؛ محاسبه‌نشده‌ها جعل نمی‌شوند.",
    "• در صورت وجود خطا یا هشدار زمان‌بندی، جزئیات در شیت Checks و در Project.json آمده است.",
    "• MSProject.xml شامل فیلدهای مدل زمان‌بندی است؛ برای داده‌های اختصاصی ریسک، قیمت‌گذاری و ورودی کامل از Project.json استفاده کنید.",
    `• لینک آنلاین گزارش: ${options.reportUrl || "—"}`,
    "• خروجی چاپ/PDF در این بسته فایل HTML خودبسنده است؛ ساخت PDF واقعی به انتخاب Print → Save as PDF در مرورگر انجام می‌شود.",
    "",
    "HERMIPLAN — Created by Mohammad Shirmardi",
  ];
  return lines.join("\r\n");
}

function csvFileName(sheetName: string): string {
  const safe = sheetName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return `${safe || "Data"}.csv`;
}

/** Assembles all independently downloadable table/report artifacts in a ZIP. */
export function buildDeliveryPackage(
  project: ProjectInput,
  analysis: ProjectAnalysis,
  options: DeliveryOptions,
): Uint8Array {
  const sheets = buildSheets(analysis, project);
  const csvSheets = sheets;
  const entries: ZipEntry[] = [
    { name: "README.txt", content: readMe(project, analysis, options, csvSheets) },
    {
      name: "Report.html",
      content: buildReportHtml(project, analysis, options.ganttSvg, {
        ...options.reportOptions,
        author: options.author,
      }),
    },
    { name: "Data.xlsx", content: buildXlsx(sheets) },
    { name: "Data.xls", content: buildExcelXml(sheets) },
    { name: "MSProject.xml", content: buildMsProjectXml(project, analysis) },
    { name: "Project.json", content: buildProjectJson(project, analysis, options.reportOptions) },
    ...csvSheets.map((sheet) => ({ name: `CSV/${csvFileName(sheet.name)}`, content: buildCsv(sheet) })),
  ];

  return createZip(entries, { compressionLevel: 6 });
}
