import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/engine/analysis";
import { parseProjectInput, type ExportFormat } from "@/lib/validation";
import { buildCsv, buildExcelXml, buildSheets } from "@/lib/report/export";
import { buildXlsx } from "@/lib/report/xlsx";
import { buildMsProjectXml } from "@/lib/report/msproject";
import { buildReportHtml } from "@/lib/report/html";
import { buildDeliveryPackage } from "@/lib/report/package";
import { REPORT_SECTIONS } from "@/lib/validation";
import { renderGanttSvg, type GanttLink } from "@/lib/report/gantt-svg";
import { checkRateLimit, clientKey, RATE_RULES, retryAfterHeaders } from "@/lib/server/rate-limit";
import { csrfRejection, isSameOriginRequest, jsonError, payloadTooLarge, readJson, validationErrorResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_SHEET_MAP: Record<string, string> = {
  activities: "Activities",
  milestones: "Milestones",
  resources: "Resources",
  costs: "Costs",
  risks: "Risks",
  delays: "Delays",
  baseline: "Baseline",
  info: "Info",
  pricing: "Pricing",
  escalation: "Escalation",
};

function fileHeaders(filename: string, type: string): HeadersInit {
  return {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejection();

  const limited = await checkRateLimit(clientKey(request, "export"), RATE_RULES.export);
  if (!limited.allowed) {
    return jsonError(429, "تعداد درخواست‌های خروجی بیش از حد مجاز است. کمی صبر کنید.", {}, retryAfterHeaders(limited));
  }
  if (payloadTooLarge(request, MAX_BODY_BYTES)) {
    return jsonError(413, "حجم داده پروژه بیش از حد مجاز است");
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonError(400, "بدنه درخواست معتبر نیست");
  const body = parsed.body as { project?: unknown; format?: string; kind?: string; reportUrl?: string };

  let input;
  try {
    input = parseProjectInput(body.project ?? {});
  } catch (error) {
    return validationErrorResponse(error, "export");
  }
  const analysis = analyzeProject(input);
  const format = (body.format ?? "xlsx") as ExportFormat;
  const base = `HERMIPLAN-${encodeURIComponent((input.meta.name || "project").replace(/[^\w\u0600-\u06FF-]+/g, "-").slice(0, 36))}`;

  const links: GanttLink[] = input.activities.flatMap((activity) =>
    activity.predecessors.map((dep) => ({ from: dep.predecessorId, to: activity.id })),
  );

  const ganttSvg = renderGanttSvg({
    gantt: analysis.gantt,
    links,
    showArrows: true,
    statusDate: input.meta.statusDate,
    compact: analysis.gantt.rows.length > 90,
  });

  switch (format) {
    case "pdf": {
      // The PDF is the print-ready report route; return the full HTML document so
      // the client can open a dedicated print window with the exact A4 layout.
      const html = buildReportHtml(input, analysis, ganttSvg);
      return new NextResponse(html, {
        headers: fileHeaders(`${base}-Report.html`, "text/html"),
      });
    }
    case "xlsx": {
      const workbook = buildXlsx(buildSheets(analysis, input));
      return new NextResponse(workbook as unknown as BodyInit, {
        headers: fileHeaders(`${base}-Data.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      });
    }
    case "xls": {
      return new NextResponse(buildExcelXml(buildSheets(analysis, input)), {
        headers: fileHeaders(`${base}-Data.xls`, "application/vnd.ms-excel"),
      });
    }
    case "csv": {
      const sheets = buildSheets(analysis, input);
      const sheetName = CSV_SHEET_MAP[body.kind ?? "activities"] ?? "Activities";
      const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[1] ?? sheets[0];
      return new NextResponse(buildCsv(sheet), {
        headers: fileHeaders(`${base}-${sheet.name}.csv`, "text/csv"),
      });
    }
    case "json": {
      const payload = JSON.stringify(
        {
          meta: { ...input.meta, reportSections: REPORT_SECTIONS.length },
          project: input,
          analysis,
        },
        null,
        2,
      );
      return new NextResponse(payload, { headers: fileHeaders(`${base}-Project.json`, "application/json") });
    }
    case "msproject": {
      return new NextResponse(buildMsProjectXml(input, analysis), {
        headers: fileHeaders(`${base}-MSProject.xml`, "application/xml"),
      });
    }
    case "package": {
      const archive = buildDeliveryPackage(input, analysis, {
        ganttSvg,
        reportUrl: body.reportUrl ?? "",
        author: input.meta.manager,
      });
      return new NextResponse(archive as unknown as BodyInit, {
        headers: fileHeaders(`${base}-Package.zip`, "application/zip"),
      });
    }
    default:
      return jsonError(400, "فرمت خروجی پشتیبانی نمی‌شود");
  }
}
