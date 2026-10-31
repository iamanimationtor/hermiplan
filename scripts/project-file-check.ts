/**
 * Portable project file — round-trip and rejection tests.
 *
 *   npx tsx scripts/project-file-check.ts
 *
 * The backup file is the only path that moves a project between browsers, so it
 * has two failure modes that must never happen silently: losing data on the way
 * out, and accepting a tampered file on the way in. Both are asserted here
 * against the real schema (`parseProjectInput`), not a copy of it.
 */
import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  buildProjectFile,
  parseProjectFile,
  sanitizeReportSections,
  serializeProjectFile,
} from "../src/lib/project-file";
import { REPORT_SECTIONS, DEFAULT_REPORT_SECTIONS } from "../src/lib/validation";
import { buildProjectFromTemplate } from "../src/lib/templates";

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

const project = buildProjectFromTemplate("construction");
const file = buildProjectFile(project, REPORT_SECTIONS.map((section) => section.key), new Date("2026-01-02T03:04:05Z"));

console.log("▶ ۱. ساخت فایل");
check(file.format === PROJECT_FILE_FORMAT, "برچسب فرمت درست است", String(file.format));
check(file.formatVersion === PROJECT_FILE_VERSION, "نسخهٔ فرمت نوشته می‌شود");
check(file.exportedAt === "2026-01-02T03:04:05.000Z", "زمان صدور ISO و قابل خواندن است", file.exportedAt);
check(file.project.activities.length > 0, "پروژهٔ قالب فعالیت دارد", String(file.project.activities.length));

const text = serializeProjectFile(file);
check(text.startsWith("{\n  \"format\""), "خروجی JSON خوانا (indent) است");
check(JSON.parse(text).project.meta.name === project.meta.name, "JSON معتبر و نام پروژه در آن هست");

console.log("\n▶ ۲. بازگردانی بدون از دست دادن داده");
const read = parseProjectFile(text);
check(read.ok, "فایلِ خودِ برنامه پذیرفته می‌شود", read.ok ? "" : read.reason);
if (read.ok) {
  check(read.project.meta.name === project.meta.name, "نام پروژه حفظ شد");
  check(read.project.meta.statusDate === project.meta.statusDate, "تاریخ وضعیت حفظ شد");
  check(read.project.activities.length === project.activities.length, "تعداد فعالیت‌ها حفظ شد", `${read.project.activities.length}/${project.activities.length}`);
  check(
    read.project.activities.every((activity, index) => activity.duration === project.activities[index]?.duration),
    "مدت همهٔ فعالیت‌ها یکی است",
  );
  check(
    JSON.stringify(read.project.activities.map((a) => a.predecessors)) ===
      JSON.stringify(project.activities.map((a) => a.predecessors)),
    "وابستگی‌ها (نوع/Lag) حفظ شدند",
  );
  check(read.project.resources.length === project.resources.length, "منابع حفظ شدند", `${read.project.resources.length}/${project.resources.length}`);
  check(read.project.milestones.length === project.milestones.length, "نقاط عطف حفظ شدند");
  check(read.project.calendar.workDays.length === project.calendar.workDays.length, "تقویم کاری حفظ شد");
  check(read.sections.length === REPORT_SECTIONS.length, "همهٔ بخش‌های گزارش حفظ شدند", String(read.sections.length));
  check(
    read.project.meta.currency === project.meta.currency,
    "واحد پول حفظ شد",
  );
}

console.log("\n▶ ۳. رد فایل‌های نامعتبر (بدون حدس)");
const cases: [string, string][] = [
  ["JSON خراب", "{ not json"],
  ["فرمت دیگر", JSON.stringify({ format: "something-else", project })],
  ["بدون پروژه", JSON.stringify({ format: PROJECT_FILE_FORMAT, formatVersion: 1 })],
  ["نسخهٔ آینده", JSON.stringify({ format: PROJECT_FILE_FORMAT, formatVersion: 99, project })],
  ["پروژهٔ بی‌ساختار", JSON.stringify({ format: PROJECT_FILE_FORMAT, formatVersion: 1, project: { activities: "nope" } })],
  ["آرایه به‌جای شیء", "[]"],
];
for (const [label, payload] of cases) {
  const result = parseProjectFile(payload);
  check(!result.ok, `${label} رد می‌شود`, result.ok ? "پذیرفته شد!" : result.reason);
}

console.log("\n▶ ۴. بخش‌های گزارش");
check(
  sanitizeReportSections(["kpis", "ghost-section", 42]).join(",") === "kpis",
  "کلید ناشناخته و غیررشته حذف می‌شوند",
  sanitizeReportSections(["kpis", "ghost-section", 42]).join(","),
);
check(
  sanitizeReportSections(["costs", "kpis"]).join(",") === "kpis,costs",
  "ترتیب بخش‌ها به ترتیب سند یکسان می‌شود",
  sanitizeReportSections(["costs", "kpis"]).join(","),
);
check(
  sanitizeReportSections(undefined).length === DEFAULT_REPORT_SECTIONS.length,
  "ورودی خالی ⇒ بخش‌های پیش‌فرض",
);
check(
  sanitizeReportSections(["ghost"]).length === DEFAULT_REPORT_SECTIONS.length,
  "اگر هیچ کلید معتبری نماند، پیش‌فرض برمی‌گردد",
);

console.log("\n▶ ۵. پروژه‌های دیگر قالب‌ها هم پشتیبان می‌شوند");
for (const template of ["construction", "software", "event", "general"] as const) {
  try {
    const sample = buildProjectFromTemplate(template);
    const restored = parseProjectFile(serializeProjectFile(buildProjectFile(sample, ["summary"])));
    check(
      restored.ok && restored.project.activities.length === sample.activities.length,
      `قالب «${template}» رفت‌وبرگشت می‌شود`,
      restored.ok ? "" : restored.reason,
    );
  } catch {
    check(false, `قالب «${template}» ساخته نشد`);
  }
}

console.log(
  failures.length === 0
    ? `\n✔ ${passed} بررسی فایل پروژه — همه موفق`
    : `\n✘ ${passed} موفق / ${failures.length} ناموفق`,
);
if (failures.length) {
  for (const failure of failures) console.log(`   - ${failure}`);
  process.exit(1);
}
