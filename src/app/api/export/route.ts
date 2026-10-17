import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/engine/analysis";
import { EXPORT_FORMATS, parseProjectInput, reportOptionsSchema, type ExportFormat } from "@/lib/validation";
import { buildCsv, buildSheets, CSV_SHEET_OPTIONS } from "@/lib/report/export";
import { buildXlsx } from "@/lib/report/xlsx";
import { buildExcelXml } from "@/lib/report/xls";
import { buildMsProjectXml } from "@/lib/report/msproject";
import { buildReportHtml } from "@/lib/report/html";
import { buildProjectJson } from "@/lib/report/json";
import { buildDeliveryPackage } from "@/lib/report/package";
import { renderGanttSvg, type GanttLink } from "@/lib/report/gantt-svg";
import { clientKey, rateLimit, RATE_RULES } from "@/lib/server/rate-limit";
import { readJsonBody } from "@/lib/server/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function wellFormedUnicode(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\uFFFD" : character;
  }).join("");
}

function filenamePart(name: string): string {
  const cleaned = Array.from(wellFormedUnicode(name).normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, ""))
    .slice(0, 72)
    .join("");
  return cleaned || "project";
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(wellFormedUnicode(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDisposition(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "") || "HERMIPLAN-export";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function fileHeaders(filename: string, type: string): HeadersInit {
  const textual = type.startsWith("text/") || ["application/json", "application/xml", "application/vnd.ms-excel"].includes(type);
  return {
    "Content-Type": textual ? `${type}; charset=utf-8` : type,
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.some((format) => format.id === value);
}

export async function POST(request: Request) {
  const limited = rateLimit(clientKey(request, "export"), RATE_RULES.export);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "تعداد درخواست‌های خروجی بیش از حد مجاز است. کمی صبر کنید." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as {
    project?: unknown;
    format?: string;
    kind?: string;
    reportUrl?: string;
    reportOptions?: unknown;
  };

  const requestedFormat = body.format ?? "xlsx";
  if (typeof requestedFormat !== "string" || !isExportFormat(requestedFormat)) {
    return NextResponse.json({ error: "فرمت خروجی پشتیبانی نمی‌شود" }, { status: 400 });
  }
  const format = requestedFormat;

  let input;
  try {
    input = parseProjectInput(body.project ?? {});
  } catch (error) {
    return NextResponse.json(
      { error: "داده پروژه نامعتبر است", detail: (error as Error).message },
      { status: 422 },
    );
  }
  let reportOptions;
  try {
    reportOptions = reportOptionsSchema.parse(body.reportOptions ?? {});
  } catch (error) {
    return NextResponse.json(
      { error: "گزینه‌های گزارش نامعتبر است", detail: (error as Error).message },
      { status: 422 },
    );
  }

  const analysis = analyzeProject(input);
  const projectName = filenamePart(input.meta.name || "project");
  const base = `HERMIPLAN-${projectName}`;
  const sheets = format === "xlsx" || format === "xls" || format === "csv" || format === "package"
    ? buildSheets(analysis, input)
    : undefined;

  switch (format) {
    case "pdf": {
      // Compatibility id retained: this is a self-contained printable HTML
      // document, not a server-rendered PDF binary.
      const links: GanttLink[] = input.activities.flatMap((activity) =>
        activity.predecessors.map((dependency) => ({ from: dependency.predecessorId, to: activity.id })),
      );
      const ganttSvg = renderGanttSvg({
        gantt: analysis.gantt,
        links,
        showArrows: reportOptions.includeGanttDependencyArrows,
        statusDate: input.meta.statusDate,
        compact: analysis.gantt.rows.length > 90,
      });
      const html = buildReportHtml(input, analysis, ganttSvg, reportOptions);
      return new NextResponse(html, {
        headers: fileHeaders(`${base}-Report.html`, "text/html"),
      });
    }
    case "xlsx": {
      const workbook = buildXlsx(sheets ?? []);
      return new NextResponse(workbook as unknown as BodyInit, {
        headers: fileHeaders(`${base}-Data.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      });
    }
    case "xls": {
      return new NextResponse(buildExcelXml(sheets ?? []), {
        headers: fileHeaders(`${base}-Data.xls`, "application/vnd.ms-excel"),
      });
    }
    case "csv": {
      const kind = body.kind ?? "activities";
      const option = typeof kind === "string" ? CSV_SHEET_OPTIONS.find((candidate) => candidate.id === kind) : undefined;
      if (!option) return NextResponse.json({ error: "نوع جدول CSV پشتیبانی نمی‌شود" }, { status: 400 });
      const sheet = sheets?.find((candidate) => candidate.name === option.sheetName);
      if (!sheet) {
        return NextResponse.json({ error: "برای این پروژه داده‌ای در این جدول وجود ندارد" }, { status: 422 });
      }
      return new NextResponse(buildCsv(sheet), {
        headers: fileHeaders(`${base}-${sheet.name}.csv`, "text/csv"),
      });
    }
    case "json": {
      return new NextResponse(buildProjectJson(input, analysis, reportOptions), {
        headers: fileHeaders(`${base}-Project.json`, "application/json"),
      });
    }
    case "msproject": {
      return new NextResponse(buildMsProjectXml(input, analysis), {
        headers: fileHeaders(`${base}-MSProject.xml`, "application/xml"),
      });
    }
    case "package": {
      const links: GanttLink[] = input.activities.flatMap((activity) =>
        activity.predecessors.map((dependency) => ({ from: dependency.predecessorId, to: activity.id })),
      );
      const ganttSvg = renderGanttSvg({
        gantt: analysis.gantt,
        links,
        showArrows: reportOptions.includeGanttDependencyArrows,
        statusDate: input.meta.statusDate,
        compact: analysis.gantt.rows.length > 90,
      });
      const archive = buildDeliveryPackage(input, analysis, {
        ganttSvg,
        reportUrl: body.reportUrl ?? "",
        author: input.meta.manager,
        reportOptions,
      });
      return new NextResponse(archive as unknown as BodyInit, {
        headers: fileHeaders(`${base}-Package.zip`, "application/zip"),
      });
    }
  }
}
