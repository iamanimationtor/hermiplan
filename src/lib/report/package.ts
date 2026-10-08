import { createZip, type ZipEntry } from "./zip";
import { buildCsv, buildSheets, type Sheet } from "./export";
import { buildXlsx } from "./xlsx";
import { buildMsProjectXml } from "./msproject";
import { buildReportHtml } from "./html";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";

export interface DeliveryOptions {
  ganttSvg: string;
  reportUrl: string;
  author?: string;
}

function readMe(project: ProjectInput, analysis: ProjectAnalysis, options: DeliveryOptions): string {
  const lines = [
    "════════════════════════════════════════════════════════",
    "  HERMIPLAN — بسته تحویل پروژه (Delivery Package)",
    "════════════════════════════════════════════════════════",
    "",
    `نام پروژه: ${project.meta.name}`,
    `نوع پروژه: ${project.meta.type}`,
    `کارفرما: ${project.meta.client ?? "—"}`,
    `پیمانکار: ${project.meta.contractor ?? "—"}`,
    `مدیر پروژه: ${project.meta.manager ?? "—"}`,
    `تاریخ شروع: ${analysis.schedule.startDate}`,
    `تاریخ پایان پیش‌بینی‌شده: ${analysis.schedule.finishDate}`,
    `مدت پروژه: ${analysis.schedule.workingDays} روز کاری`,
    `تعداد فعالیت: ${analysis.activities.length}`,
    `بودجه مستقیم: ${analysis.costs.budget.toLocaleString("en-US")} ${project.meta.currency}`,
    `برآورد نهایی (با بالاسری، سود، احتیاط و تعدیل): ${analysis.pricing.breakdown.total.toLocaleString("en-US")} ${project.meta.currency}`,
    `مبنای قیمت‌گذاری: ${analysis.pricing.seriesLabel} — منطقه ${analysis.pricing.regionLabel}`,
    `تاریخ مرجع نرخ بازار: ${analysis.pricing.asOfJalali} (${analysis.pricing.asOf})`,
    `تولید بسته: ${new Date().toISOString()}`,
    "",
    "──────────────────── فهرست فایل‌ها ────────────────────",
    "  1) Report.html      گزارش کامل قابل مشاهده و چاپ (بدون نیاز به اینترنت)",
    "  2) Data.xlsx        کارپوشه اکسل چندشییتی (اطلاعات، فعالیت‌ها، زمان‌بندی،",
    "                      منابع، هزینه، تعدیل، ریسک، استانداردها)",
    "  3) MSProject.xml    فایل قابل بازکردن در Microsoft Project و Primavera P6",
    "  4) Project.json     داده کامل پروژه برای تبادل سیستم‌به‌سیستم",
    "  5) Activities.csv   فهرست فعالیت‌ها با پشتیبانی کامل فارسی",
    "",
    "──────────────────── نکات مهم ────────────────────",
    "• برای PDF: فایل Report.html را در مرورگر باز کرده و Ctrl+P → Save as PDF",
    `• لینک آنلاین گزارش: ${options.reportUrl}`,
    "• زمان‌بندی بر پایه الگوریتم مسیر بحرانی (CPM/PDM) و تحلیل ارزش کسب‌شده (EVM)",
    "• نرخ‌ها بر مبنای فهرست نرخ بازار ایران و مصوبات شورای عالی کار",
    "",
    "HERMIPLAN — Created by Mohammad Shirmardi",
  ];
  return lines.join("\r\n");
}

/** Assembles the complete delivery package as a ZIP archive. */
export function buildDeliveryPackage(
  project: ProjectInput,
  analysis: ProjectAnalysis,
  options: DeliveryOptions,
): Uint8Array {
  const sheets: Sheet[] = buildSheets(analysis, project);
  const entries: ZipEntry[] = [
    { name: "README.txt", content: readMe(project, analysis, options) },
    { name: "Report.html", content: buildReportHtml(project, analysis, options.ganttSvg) },
    {
      name: "Data.xlsx",
      content: buildXlsx(sheets),
    },
    { name: "MSProject.xml", content: buildMsProjectXml(project, analysis) },
    { name: "Project.json", content: JSON.stringify({ project, analysis }, null, 2) },
    {
      name: "Activities.csv",
      content: buildCsv(sheets.find((s) => s.name === "Activities") ?? sheets[0]),
    },
  ];

  return createZip(entries);
}
