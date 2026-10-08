import type { GanttModel } from "@/lib/engine/types";
import { renderGanttSvg } from "@/lib/report/gantt-svg";

/* =================================================================== */
/* Gantt chart — deterministic SVG, safe for server rendering           */
/* =================================================================== */

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

/** Renders the shared, pure SVG Gantt (identical in UI and exported files). */
export function GanttChart(options: GanttRenderOptions) {
  const svg = renderGanttSvg(options);
  if (!svg) return null;
  return <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/* =================================================================== */
/* Network diagram (activity-on-node)                                   */
/* =================================================================== */

export function NetworkDiagram({
  nodes,
  links,
}: {
  nodes: { id: string; code: string; name: string; es: number; duration: number; critical: boolean; phaseIndex: number }[];
  links: { from: string; to: string }[];
}) {
  if (!nodes.length) return null;
  const columnWidth = 132;
  const rowHeight = 58;
  const nodeWidth = 118;
  const nodeHeight = 46;

  const positions = new Map<string, { x: number; y: number }>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rowsByPhase = new Map<number, number>();
  nodes.forEach((node) => {
    const row = rowsByPhase.get(node.phaseIndex) ?? 0;
    rowsByPhase.set(node.phaseIndex, row + 1);
    positions.set(node.id, { x: node.es * columnWidth * 0.16 + 8, y: node.phaseIndex * 3 * rowHeight + row * rowHeight });
  });

  const maxX = Math.max(...[...positions.values()].map((p) => p.x)) + nodeWidth + 20;
  const maxY = Math.max(...[...positions.values()].map((p) => p.y)) + nodeHeight + 20;

  return (
    <svg viewBox={`0 0 ${maxX} ${maxY}`} width="100%" style={{ display: "block", direction: "ltr" }} role="img" aria-label="نمودار شبکه‌ای پروژه">
      <rect x={0} y={0} width={maxX} height={maxY} fill="#fff" />
      {links.map((link, i) => {
        const from = positions.get(link.from);
        const to = positions.get(link.to);
        if (!from || !to) return null;
        const x1 = from.x + nodeWidth;
        const y1 = from.y + nodeHeight / 2;
        const x2 = to.x;
        const y2 = to.y + nodeHeight / 2;
        const critical = nodeById.get(link.from)?.critical && nodeById.get(link.to)?.critical;
        return (
          <g key={i} stroke={critical ? "#b91c1c" : "#94a3b8"} strokeWidth={critical ? 1.5 : 0.9} fill="none">
            <path d={`M ${x1} ${y1} C ${x1 + 22} ${y1}, ${x2 - 22} ${y2}, ${x2 - 2} ${y2}`} />
          </g>
        );
      })}
      {nodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        return (
          <g key={node.id}>
            <rect
              x={pos.x}
              y={pos.y}
              width={nodeWidth}
              height={nodeHeight}
              rx={5}
              fill={node.critical ? "#fef2f2" : "#f8fafc"}
              stroke={node.critical ? "#b91c1c" : "#12335a"}
              strokeWidth={node.critical ? 1.6 : 1}
            />
            <text x={pos.x + 6} y={pos.y + 15} fontSize={9} fontWeight={700} fill="#0f2c4d">
              {node.code}
            </text>
            <text x={pos.x + 6} y={pos.y + 28} fontSize={7.6} fill="#475569">
              {node.name.length > 24 ? `${node.name.slice(0, 24)}…` : node.name}
            </text>
            <text x={pos.x + 6} y={pos.y + 40} fontSize={7.4} fill={node.critical ? "#b91c1c" : "#64748b"}>
              {node.duration === 0 ? "Milestone" : `${node.duration} روز`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* =================================================================== */
/* Histograms & gauges                                                  */
/* =================================================================== */

export function ResourceHistogram({
  series,
  capacity,
}: {
  series: { date: string; units: number }[];
  capacity: number;
}) {
  if (!series.length) return null;
  const width = 520;
  const height = 130;
  const pad = 26;
  const max = Math.max(capacity, ...series.map((s) => s.units), 1) * 1.15;
  const barWidth = (width - pad * 2) / series.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", direction: "ltr" }} role="img" aria-label="نمودار بار منبع">
      <line x1={pad} y1={height - 20} x2={width - pad} y2={height - 20} stroke="#cbd5e1" />
      {capacity > 0 ? (
        <g>
          <line
            x1={pad}
            y1={height - 20 - (capacity / max) * (height - 40)}
            x2={width - pad}
            y2={height - 20 - (capacity / max) * (height - 40)}
            stroke="#dc2626"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text x={pad + 2} y={height - 24 - (capacity / max) * (height - 40)} fontSize={7.5} fill="#dc2626">
            ظرفیت
          </text>
        </g>
      ) : null}
      {series.map((point, i) => {
        const barHeight = (point.units / max) * (height - 40);
        const over = capacity > 0 && point.units > capacity;
        return (
          <rect
            key={i}
            x={pad + i * barWidth}
            y={height - 20 - barHeight}
            width={Math.max(barWidth - 0.6, 0.6)}
            height={barHeight}
            fill={over ? "#ef4444" : "#2563eb"}
            opacity={0.85}
          />
        );
      })}
      <text x={pad} y={12} fontSize={8} fill="#475569">
        اوج: {Math.max(...series.map((s) => s.units)).toLocaleString("en-US")}
      </text>
    </svg>
  );
}

export function BarChart({
  data,
  formatter,
}: {
  data: { label: string; value: number; tone?: "ok" | "warn" | "bad" | "info" }[];
  formatter?: (value: number) => string;
}) {
  if (!data.length) return null;
  const width = 520;
  const rowHeight = 24;
  const height = data.length * rowHeight + 8;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const colors = { ok: "#16a34a", warn: "#d97706", bad: "#dc2626", info: "#1f4a80" };
  return (
    <div>
      {data.map((item, i) => (
        <div key={i} className="mb-1.5 flex items-center gap-2">
          <span className="w-[34%] truncate text-[10px] text-slate-600">{item.label}</span>
          <span className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-100">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${(Math.abs(item.value) / max) * 100}%`, background: colors[item.tone ?? "info"] }}
            />
          </span>
          <span className="w-[22%] text-left text-[10px] font-semibold text-slate-700" dir="ltr">
            {formatter ? formatter(item.value) : item.value.toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HealthGauge({ score, status }: { score: number; status: "good" | "watch" | "critical" }) {
  const size = 120;
  const radius = 48;
  const circumference = Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = status === "good" ? "#16a34a" : status === "watch" ? "#d97706" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${size} 70`} width={size} style={{ display: "block", direction: "ltr" }} role="img" aria-label="شاخص سلامت پروژه">
      <path d="M 12 62 A 48 48 0 0 1 108 62" fill="none" stroke="#e2e8f0" strokeWidth={10} strokeLinecap="round" />
      <path
        d="M 12 62 A 48 48 0 0 1 108 62"
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
      />
      <text x={60} y={52} textAnchor="middle" fontSize={20} fontWeight={800} fill="#0f2c4d">
        {score}
      </text>
    </svg>
  );
}


