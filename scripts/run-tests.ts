/**
 * Test entry point: runs every deterministic (database-free) suite in order and
 * fails with the first non-zero exit code.
 *
 *   npm test
 *
 * Database/API suites need a live server and a migrated database:
 *   npm run test:api
 */
import { spawnSync } from "node:child_process";

const SUITES: { name: string; file: string }[] = [
  { name: "موتور — بررسی مستقل (محاسبه دستی)", file: "scripts/engine-verification.ts" },
  { name: "موتور — رگرسیون محدودیت/مبنا/EVM", file: "scripts/engine-regressions.ts" },
  { name: "موتور — دود (قالب‌ها)", file: "scripts/engine-smoke.ts" },
  { name: "خروجی‌ها و موارد مرزی", file: "scripts/edge-case-audit.ts" },
  { name: "امنیت — توابع پایه", file: "scripts/security-checks.ts" },
  { name: "درون‌ریزی و قالب‌ها", file: "scripts/import-parser.test.ts" },
  { name: "رگرسیون قالب‌ها", file: "scripts/template-regression.ts" },
  { name: "تاریخچه — تفاوت نسخه‌ها", file: "scripts/version-diff-check.ts" },
  { name: "فایل پشتیبان پروژه — رفت‌وبرگشت و ردِ فایل نامعتبر", file: "scripts/project-file-check.ts" },
  // No server required: the local half of the artifact checks runs here, and the
  // HTTP half activates by itself when BASE_URL is set.
  { name: "خروجی — صحت فایل‌های XLSX/CSV/HTML/بسته", file: "scripts/export-check.ts" },
];

let failed = 0;
const summary: { name: string; ok: boolean; seconds: string }[] = [];
for (const suite of SUITES) {
  console.log(`\n══════ ${suite.name} ══════`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["--import", "tsx", suite.file], {
    stdio: "inherit",
    env: process.env,
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ok = result.status === 0;
  summary.push({ name: suite.name, ok, seconds });
  if (!ok) {
    failed += 1;
    // `result.signal` matters: a killed process (for example by the OOM killer
    // in a small sandbox) is a different failure from a failed assertion.
    console.error(
      `✘ ${suite.file} با کد ${result.status}${result.signal ? ` (سیگنال ${result.signal})` : ""} متوقف شد`,
    );
  }
}

// One compact index of what ran: when a suite fails, the reader should not have
// to scroll back through several hundred lines to find out which one.
console.log("\n══════ خلاصه ══════");
for (const row of summary) console.log(`${row.ok ? "✔" : "✘"} ${row.seconds.padStart(5)}s  ${row.name}`);

console.log(
  failed === 0
    ? `\n══════ همه ${SUITES.length} مجموعه تست موفق بودند ══════`
    : `\n✘ ${failed} مجموعه تست ناموفق بود`,
);
process.exit(failed === 0 ? 0 : 1);
