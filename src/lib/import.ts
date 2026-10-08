import { toLatinDigits } from "./date-fa";
import type { ActivityInput, ProjectInput } from "./engine/types";

/**
 * HERMIPLAN — fast capture parser.
 *
 * Lets engineers paste an activity list straight from Excel / CSV / a text file
 * and get a fully scheduled project. Accepts tab, comma and semicolon separated
 * values, Persian digits, header rows and Persian duration units.
 */

export interface ParsedActivityRow {
  name: string;
  duration: number;
  phase?: string;
  progress?: number;
  predecessors: string[];
  cost?: number;
  notes?: string;
}

export interface ParseResult {
  rows: ParsedActivityRow[];
  errors: string[];
  detected: { columns: string[]; hadHeader: boolean; separator: string };
}

const SEPARATORS = ["\t", ";", ","];

/** working-day equivalents for Persian duration units */
const UNIT_MULTIPLIERS: { token: string; factor: number }[] = [
  { token: "هفته", factor: 5 },
  { token: "هفتگی", factor: 5 },
  { token: "ماه", factor: 22 },
  { token: "ماهانه", factor: 22 },
  { token: "ساعت", factor: 0.125 },
  { token: "day", factor: 1 },
  { token: "روز", factor: 1 },
];

export function parseDuration(raw: string): number {
  // normalise the Persian/European decimal comma before stripping punctuation
  const normalised = toLatinDigits(String(raw ?? "")).replace(/(\d),(\d)/g, "$1.$2");
  const value = normalised.replace(/[^\d.]/g, "");
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  const text = toLatinDigits(String(raw ?? ""));
  const unit = UNIT_MULTIPLIERS.find((item) => text.includes(item.token));
  const duration = unit ? number * unit.factor : number;
  // half-days are meaningful, anything finer is rounded
  return Math.max(0, Math.round(duration * 2) / 2);
}

function parseNumber(raw: string): number {
  const value = Number(toLatinDigits(String(raw ?? "")).replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function parsePredecessors(raw: string): string[] {
  if (!raw) return [];
  return toLatinDigits(raw)
    .split(/[,؛;\n|+]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^(fs|ss|ff|sf)[:\-]*/i, "").trim())
    .filter(Boolean);
}

/**
 * Splits one line with quote awareness so `Excavation,"8,5"` keeps the decimal
 * comma inside a single cell instead of being cut into two fields.
 */
function splitBy(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === separator) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function splitLine(line: string): { cells: string[]; separator: string } | null {
  for (const separator of SEPARATORS) {
    if (line.includes(separator)) {
      return { cells: splitBy(line, separator), separator };
    }
  }
  return null;
}

const HEADER_HINTS = ["نام", "فعالیت", "شرح", "مدت", "duration", "task", "name", "فاز", "wbs"];

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return HEADER_HINTS.filter((hint) => joined.includes(hint)).length >= 2;
}

/** Column order used when no header row is present. */
const DEFAULT_COLUMNS = ["name", "duration", "phase", "progress", "predecessors", "cost", "notes"];

const HEADER_ALIASES: Record<string, string> = {
  نام: "name",
  "نام فعالیت": "name",
  فعالیت: "name",
  شرح: "name",
  "شرح فعالیت": "name",
  عنوان: "name",
  task: "name",
  name: "name",
  "activity name": "name",
  مدت: "duration",
  "مدت (روز)": "duration",
  "مدت زمان": "duration",
  duration: "duration",
  days: "duration",
  فاز: "phase",
  "بسته کاری": "phase",
  phase: "phase",
  "دپارتمان": "phase",
  پیشرفت: "progress",
  "درصد پیشرفت": "progress",
  progress: "progress",
  "percent complete": "progress",
  پیشنیاز: "predecessors",
  "پیش‌نیاز": "predecessors",
  "پیشنیازها": "predecessors",
  "پیش‌نیازها": "predecessors",
  predecessor: "predecessors",
  predecessors: "predecessors",
  هزینه: "cost",
  "هزینه ثابت": "cost",
  cost: "cost",
  budget: "cost",
  توضیح: "notes",
  توضیحات: "notes",
  notes: "notes",
};

function resolveColumn(cell: string): string | undefined {
  const key = cell.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[key.replace(/\s+/g, " ")];
}

export function parseActivityImport(text: string): ParseResult {
  const errors: string[] = [];
  const rows: ParsedActivityRow[] = [];
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[+\-=|]+$/.test(line));

  if (!lines.length) {
    return { rows, errors: ["متنی برای درون‌ریزی وارد نشده است."], detected: { columns: [], hadHeader: false, separator: "" } };
  }

  const first = splitLine(lines[0]);
  const separator = first?.separator ?? "";
  const hadHeader = first ? looksLikeHeader(first.cells) : false;

  let columns = DEFAULT_COLUMNS;
  if (hadHeader && first) {
    const mapped = first.cells.map(resolveColumn);
    columns = mapped.map((column, index) => column ?? `unknown_${index}`);
  }

  const startIndex = hadHeader ? 1 : 0;
  for (let i = startIndex; i < lines.length; i += 1) {
    const parsed = splitLine(lines[i]);
    const cells = parsed?.cells ?? [lines[i]];
    const record: Record<string, string> = {};
    columns.forEach((column, index) => {
      if (column && !column.startsWith("unknown_")) record[column] = cells[index] ?? "";
    });

    const name = (record.name ?? cells[0] ?? "").trim();
    if (!name) {
      errors.push(`سطر ${i + 1}: نام فعالیت خالی است و نادیده گرفته شد.`);
      continue;
    }

    const duration = parseDuration(record.duration ?? cells[1] ?? "1");
    if (duration <= 0) {
      errors.push(`سطر ${i + 1} («${name}»): مدت نامعتبر است و ۱ روز در نظر گرفته شد.`);
    }
    const progress = Math.min(100, Math.max(0, parseNumber(record.progress ?? "")));

    rows.push({
      name: name.slice(0, 200),
      duration: duration > 0 ? duration : 1,
      phase: record.phase ? record.phase.slice(0, 120) : undefined,
      progress: progress || undefined,
      predecessors: parsePredecessors(record.predecessors ?? ""),
      cost: record.cost ? Math.max(0, parseNumber(record.cost)) : undefined,
      notes: record.notes ? record.notes.slice(0, 500) : undefined,
    });
  }

  if (!rows.length && !errors.length) {
    errors.push("هیچ سطر قابل شناسایی یافت نشد.");
  }

  return { rows, errors, detected: { columns, hadHeader, separator } };
}

export interface ImportPreview {
  activities: ActivityInput[];
  warnings: string[];
  phaseCount: number;
  linkedPredecessors: number;
}

/** Turns parsed rows into engine-ready activities and links predecessors by code. */
export function buildActivitiesFromImport(
  parsed: ParseResult,
  options: { startCode?: number; defaultPhase?: string; rateKey?: string } = {},
): ImportPreview {
  const warnings: string[] = [...parsed.errors];
  const activities: ActivityInput[] = [];
  const startCode = options.startCode ?? 10;

  parsed.rows.forEach((row, index) => {
    activities.push({
      id: `imp-${Date.now().toString(36)}-${index}`,
      code: `A${startCode + index * 10}`,
      name: row.name,
      phase: row.phase || options.defaultPhase || "فاز ۱ — عملیات اصلی",
      duration: row.duration,
      predecessors: [],
      progress: row.progress ?? 0,
      resources: [],
      fixedCost: row.cost ?? 0,
      materialCost: 0,
      constraintType: "ASAP",
      milestone: false,
      notes: row.notes,
    });
  });

  // resolve predecessors by activity code or by exact/partial name match
  const byCode = new Map(activities.map((a) => [a.code.toUpperCase(), a]));
  const byName = new Map(activities.map((a) => [a.name, a]));
  let linked = 0;

  parsed.rows.forEach((row, index) => {
    const target = activities[index];
    if (!target) return;
    row.predecessors.forEach((reference) => {
      const upper = reference.toUpperCase();
      const match =
        byCode.get(upper) ??
        byName.get(reference) ??
        activities.find((a) => a.code.toUpperCase() === upper || a.name.includes(reference));
      if (match && match.id !== target.id) {
        target.predecessors.push({ predecessorId: match.id, type: "FS", lag: 0 });
        linked += 1;
      } else {
        warnings.push(`پیش‌نیاز «${reference}» برای «${target.name}» یافت نشد و نادیده گرفته شد.`);
      }
    });
  });

  return {
    activities,
    warnings,
    phaseCount: new Set(activities.map((a) => a.phase)).size,
    linkedPredecessors: linked,
  };
}

/** A ready-to-paste sample so users can see the expected format instantly. */
export const IMPORT_SAMPLE = `نام فعالیت	مدت	فاز	پیشرفت	پیش‌نیاز
گودبرداری و تخلیه خاک	8	عملیات خاکی	0	
بتن‌ریزی بند پایه	6	عملیات خاکی	0	A10
آرماتوربندی فونداسیون	12	فونداسیون	0	A20
بتن‌ریزی فونداسیون	4	فونداسیون	0	A30
تست و تحویل	2	پایان‌کار	0	A40`;
