import type { GanttModel } from "@/lib/engine/types";
import { jalaliMonthLabel } from "@/lib/date-fa";

/**
 * Pure, dependency-free Gantt chart SVG renderer.
 * Shared by the browser UI and the server-side export pipeline (HTML report,
 * delivery package) so both always render an identical chart.
 */

export interface GanttLink {
  from: string;
  to: string;
}

export interface GanttRenderOptions {
  gantt: GanttModel;
  links?: GanttLink[];
  showArrows?: boolean;
  statusDate?: string;
  compact?: boolean;
}

const esc = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function renderGanttSvg({
  gantt,
  links = [],
  showArrows = true,
  statusDate,
  compact = false,
}: GanttRenderOptions): string {
  if (!gantt?.rows?.length) return "";

  const total = Math.max(gantt.totalOffsets, 1);
  const labelWidth = compact ? 150 : 230;
  const headerHeight = 34;
  const rowHeight = compact ? 20 : 26;
  const dayWidth =
    total <= 40 ? 22 : total <= 90 ? 13 : total <= 200 ? 7 : total <= 400 ? 4 : 2.2;
  const chartWidth = Math.max(total * dayWidth, 120);
  const width = labelWidth + chartWidth;
  const height = headerHeight + gantt.rows.length * rowHeight + 8;
  const rowY = (index: number) => headerHeight + index * rowHeight + rowHeight / 2;
  const indexOf = new Map(gantt.rows.map((row, i) => [row.id, i]));

  const parts: string[] = [];

  parts.push(
    `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:100%;display:block;font-family:inherit;direction:ltr" role="img" aria-label="نمودار گانت پروژه" xmlns="http://www.w3.org/2000/svg">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<rect x="${labelWidth}" y="0" width="${chartWidth}" height="${headerHeight}" fill="#f1f5f9"/>`);
  parts.push(`<rect x="0" y="0" width="${labelWidth}" height="${headerHeight}" fill="#12335a"/>`);
  parts.push(
    `<text x="${labelWidth - 8}" y="22" text-anchor="end" fill="#ffffff" font-size="11" font-weight="700">فعالیت</text>`,
  );

  // month segments
  const segments: { start: number; end: number; label: string }[] = [];
  gantt.dates.forEach((date, offset) => {
    const label = jalaliMonthLabel(date);
    const last = segments[segments.length - 1];
    if (!last || last.label !== label) segments.push({ start: offset, end: offset, label });
    else last.end = offset;
  });

  segments.forEach((segment, i) => {
    const x = labelWidth + segment.start * dayWidth;
    const w = Math.max((segment.end - segment.start + 1) * dayWidth, 1);
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(
      `<text x="${x + w / 2}" y="21" text-anchor="middle" fill="#334155" font-size="9.5" font-weight="600">${esc(segment.label)}</text>`,
    );
    void i;
  });

  // rows
  gantt.rows.forEach((row, index) => {
    const y = rowY(index);
    const isPhase = row.kind === "phase";
    parts.push(
      `<rect x="0" y="${y - rowHeight / 2}" width="${labelWidth}" height="${rowHeight}" fill="${isPhase ? "#f8fafc" : index % 2 ? "#ffffff" : "#fbfdff"}"/>`,
    );
    parts.push(
      `<line x1="0" y1="${y + rowHeight / 2}" x2="${width}" y2="${y + rowHeight / 2}" stroke="#eef2f7" stroke-width="0.6"/>`,
    );
    parts.push(
      `<text x="${labelWidth - 10}" y="${y + 3.6}" text-anchor="end" fill="${isPhase ? "#0f2c4d" : "#334155"}" font-size="${isPhase ? 10.5 : 9.6}" font-weight="${isPhase ? 700 : 400}">${esc(isPhase ? row.name : `${row.code} · ${row.name}`)}</text>`,
    );

    if (isPhase) {
      parts.push(
        `<rect x="${labelWidth + row.startOffset * dayWidth}" y="${y - 3}" width="${Math.max((row.endOffset - row.startOffset) * dayWidth, 2)}" height="6" rx="3" fill="#12335a" opacity="0.85"/>`,
      );
    } else if (row.kind === "milestone") {
      const cx = labelWidth + row.startOffset * dayWidth;
      parts.push(
        `<path d="M ${cx} ${y - 5} l 5 5 l -5 5 l -5 -5 z" fill="${row.critical ? "#b91c1c" : "#12335a"}"/>`,
      );
    } else {
      const barX = labelWidth + row.startOffset * dayWidth;
      const barW = Math.max((row.endOffset - row.startOffset) * dayWidth, 2);
      const barH = compact ? 10 : 12;
      const barY = y - (compact ? 5 : 6);
      parts.push(
        `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="2.5" fill="${row.critical ? "#fecaca" : "#dbeafe"}" stroke="${row.critical ? "#b91c1c" : "#3b82f6"}" stroke-width="0.9"/>`,
      );
      if (row.progress > 0) {
        parts.push(
          `<rect x="${barX}" y="${barY}" width="${Math.max((barW * row.progress) / 100, 1)}" height="${barH}" rx="2.5" fill="${row.critical ? "#b91c1c" : "#2563eb"}"/>`,
        );
      }
    }
  });

  // dependency links
  if (showArrows) {
    links.forEach((link, i) => {
      const fromIndex = indexOf.get(link.from);
      const toIndex = indexOf.get(link.to);
      if (fromIndex === undefined || toIndex === undefined) return;
      const from = gantt.rows[fromIndex];
      const to = gantt.rows[toIndex];
      if (!from || !to || from.kind === "phase" || to.kind === "phase") return;
      const x1 = labelWidth + from.endOffset * dayWidth;
      const y1 = rowY(fromIndex);
      const x2 = labelWidth + to.startOffset * dayWidth;
      const y2 = rowY(toIndex);
      const midX = x1 + Math.max(6, (x2 - x1) / 2);
      parts.push(
        `<g stroke="#94a3b8" stroke-width="0.7" fill="none" opacity="0.75"><path d="M ${x1} ${y1} H ${midX} V ${y2} H ${x2 - 3}"/><path d="M ${x2 - 3} ${y2} l -4 -2.5 v 5 z" fill="#94a3b8" stroke="none"/></g>`,
      );
      void i;
    });
  }

  // status date marker
  const statusOffset = statusDate ? gantt.dates.findIndex((d) => d === statusDate) : -1;
  if (statusOffset >= 0) {
    const x = labelWidth + statusOffset * dayWidth;
    parts.push(`<line x1="${x}" y1="${headerHeight}" x2="${x}" y2="${height}" stroke="#d97706" stroke-width="1.4" stroke-dasharray="4 3"/>`);
    parts.push(`<rect x="${x - 26}" y="2" width="52" height="12" rx="3" fill="#d97706"/>`);
    parts.push(
      `<text x="${x}" y="11" text-anchor="middle" fill="#fff" font-size="7.5" font-weight="700">وضعیت</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
