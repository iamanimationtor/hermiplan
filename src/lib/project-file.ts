/**
 * Portable project file — the escape hatch for cookie-bound work.
 *
 * A guest's projects live in the database but are *found* through a cookie in one
 * browser. Change device, clear cookies, or move to a new preview origin and the
 * owner is locked out of their own work: the report route answers 404 because the
 * caller is, correctly, not the owner. This file is the honest way across that
 * gap, and it is deliberately dumb: JSON in, JSON out, validated again on entry.
 *
 * Design rules:
 *  • The file is a *document*, not a credential. It grants no access to the
 *    server copy; importing it creates a new project for the current visitor.
 *  • Nothing is trusted on the way back in: the payload goes through the same
 *    `parseProjectInput` schema as the API, so a hand-edited or truncated file
 *    fails loudly instead of producing a half-valid project.
 *  • Unknown report-section keys are dropped rather than forwarded, so an old
 *    file cannot resurrect a section that no longer exists.
 */
import { DEFAULT_REPORT_SECTIONS, REPORT_SECTIONS, parseProjectInput } from "@/lib/validation";
import type { ProjectInput } from "@/lib/engine/types";

export const PROJECT_FILE_FORMAT = "hermiplan-project";
export const PROJECT_FILE_VERSION = 1;
/** A project with thousands of activities stays well below this. */
export const PROJECT_FILE_MAX_BYTES = 8 * 1024 * 1024;

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  project: ProjectInput;
  reportOptions: { sections: string[] };
}

export type ProjectFileReadResult =
  | { ok: true; project: ProjectInput; sections: string[] }
  | { ok: false; reason: string };

/** Keeps only keys the application still knows about, in the canonical order. */
export function sanitizeReportSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_REPORT_SECTIONS];
  const wanted = new Set(value.filter((item): item is string => typeof item === "string"));
  const kept = REPORT_SECTIONS.filter((section) => wanted.has(section.key)).map((section) => section.key);
  return kept.length ? kept : [...DEFAULT_REPORT_SECTIONS];
}

export function buildProjectFile(
  project: ProjectInput,
  sections: string[],
  now: Date = new Date(),
): ProjectFile {
  return {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    exportedAt: now.toISOString(),
    project,
    reportOptions: { sections: sanitizeReportSections(sections) },
  };
}

export function serializeProjectFile(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

/** Parses and re-validates a file produced by `buildProjectFile`. */
export function parseProjectFile(text: string): ProjectFileReadResult {
  if (text.length > PROJECT_FILE_MAX_BYTES) {
    return { ok: false, reason: "حجم فایل بیش از حد مجاز است." };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: "فایل JSON معتبر نیست." };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "ساختار فایل پشتیبان شناخته نشد." };
  }
  const candidate = payload as Partial<ProjectFile>;
  if (candidate.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, reason: "این فایل، پشتیبان پروژه HERMIPLAN نیست." };
  }
  if (typeof candidate.formatVersion === "number" && candidate.formatVersion > PROJECT_FILE_VERSION) {
    return {
      ok: false,
      reason: "این فایل با نسخهٔ جدیدتری ساخته شده است؛ برنامه را به‌روزرسانی کنید.",
    };
  }
  if (!candidate.project || typeof candidate.project !== "object") {
    // An empty payload must not "restore" an empty project over real work.
    return { ok: false, reason: "فایل، پروژه‌ای در خود ندارد." };
  }
  try {
    const project = parseProjectInput(candidate.project);
    return {
      ok: true,
      project,
      sections: sanitizeReportSections(candidate.reportOptions?.sections),
    };
  } catch {
    return { ok: false, reason: "محتوای پروژه در فایل معتبر نیست." };
  }
}
