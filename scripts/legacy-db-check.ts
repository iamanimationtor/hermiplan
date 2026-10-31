/**
 * HERMIPLAN — legacy-database compatibility evidence.
 *
 * Reproduces the database created by the *previous* release (the schema shipped
 * inside the original upload: `is_public` default true, `otp_codes.attempts`
 * text, no `rate_limits`) and then proves that the current migrations upgrade
 * it **without losing a single row**.
 *
 * Usage (against a disposable database only — the script refuses to touch a
 * database that already contains HERMIPLAN tables in prepare mode):
 *
 *   DATABASE_URL=… npx tsx scripts/legacy-db-check.ts prepare
 *   DATABASE_URL=… npm run db:migrate
 *   DATABASE_URL=… npx tsx scripts/legacy-db-check.ts verify
 *   DATABASE_URL=… npx tsx scripts/legacy-db-check.ts rollback
 *   DATABASE_URL=… npx tsx scripts/legacy-db-check.ts verify-rollback
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const PHASE = process.argv[2] ?? "prepare";
let failures = 0;
let checks = 0;

const check = (condition: boolean, message: string, detail?: string) => {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
};
/** Migration files in apply order — the ledger must match them exactly. */
function migrationVersions(): string[] {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
}

const eq = (actual: unknown, expected: unknown, message: string) =>
  check(actual === expected, message, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/** The schema exactly as the previous release created it. */
const LEGACY_DDL = `
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" text NOT NULL,
  "display_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_login_at" timestamp with time zone,
  CONSTRAINT "users_phone_unique" UNIQUE("phone")
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user" uuid,
  "guest_token" text,
  "name" text NOT NULL,
  "project_type" text DEFAULT 'general' NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "input" jsonb NOT NULL,
  "analysis" jsonb,
  "report_options" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "projects_guest_token_idx" ON "projects" ("guest_token");

CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempts" text DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "otp_phone_idx" ON "otp_codes" ("phone");

CREATE TABLE IF NOT EXISTS "sessions" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "project_events_project_idx" ON "project_events" ("project_id");
`;

const PROCEDURE = join(process.cwd(), "drizzle", "0002_security_hardening.rollback.sql");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const tables = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  const names = tables.rows.map((row) => row.table_name);

  if (PHASE === "prepare") {
    console.log("▶ ساخت پایگاه داده نسخه قبلی (legacy) و درج داده‌های موجود");
    if (names.includes("_hermiplan_migrations")) {
      console.error("This database is already managed by the migration runner — refusing to prepare it.");
      process.exit(1);
    }
    const preExisting = names.filter((name) =>
      ["projects", "users", "sessions", "otp_codes", "project_events"].includes(name),
    );
    check(preExisting.length === 0, "پایگاه داده برای سناریوی مهاجرت خالی است", preExisting.join(","));

    await client.query(LEGACY_DDL);
    await client.query(`
      INSERT INTO "users" ("id", "phone", "display_name")
      VALUES ('11111111-1111-4111-8111-111111111111', '09120000001', 'کاربر نسخه قبل');

      INSERT INTO "sessions" ("token", "user_id", "expires_at")
      VALUES ('legacy-session-token', '11111111-1111-4111-8111-111111111111', now() + interval '1 day');

      INSERT INTO "projects" ("id", "guest_token", "name", "is_public", "input")
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'guest-legacy-1', 'پروژه قدیمی عمومی', true,
         '{"meta":{"name":"پروژه قدیمی عمومی","type":"general","currency":"IRR","startDate":"2026-01-03","statusDate":"2026-01-03"},"activities":[]}'::jsonb),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'guest-legacy-2', 'پروژه منتشرشده آگاهانه', true,
         '{"meta":{"name":"پروژه منتشرشده آگاهانه","type":"general","currency":"IRR","startDate":"2026-01-03","statusDate":"2026-01-03"},"activities":[]}'::jsonb);

      INSERT INTO "project_events" ("project_id", "kind", "payload")
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'visibility', '{"isPublic":true}'::jsonb);

      INSERT INTO "otp_codes" ("phone", "code_hash", "expires_at", "attempts")
      VALUES ('09120000009', 'legacy-hash', now() + interval '5 minutes', '3');
    `);

    const counts = await client.query<{ projects: number; users: number; otps: number }>(
      `select (select count(*) from "projects")::int as projects,
              (select count(*) from "users")::int as users,
              (select count(*) from "otp_codes")::int as otps`,
    );
    console.log("  وضعیت اولیه:", JSON.stringify(counts.rows[0]));
    const defaults = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'projects' and column_name = 'is_public'",
    );
    eq(defaults.rows[0]?.column_default, "true", "نسخه قبل: پیش‌فرض is_public برابر true است");
  }

  if (PHASE === "verify") {
    console.log("▶ تأیید مهاجرت روی پایگاه داده نسخه قبل (بدون از دست رفتن داده)");
    const counts = await client.query<{ projects: number; users: number; otps: number; sessions: number }>(
      `select (select count(*) from "projects")::int as projects,
              (select count(*) from "users")::int as users,
              (select count(*) from "otp_codes")::int as otps,
              (select count(*) from "sessions")::int as sessions`,
    );
    const row = counts.rows[0];
    eq(row.projects, 2, "همه پروژه‌های قبلی باقی مانده‌اند");
    eq(row.users, 1, "کاربران باقی مانده‌اند");
    eq(row.otps, 1, "کدهای OTP باقی مانده‌اند");
    eq(row.sessions, 1, "نشست‌های فعال باقی مانده‌اند");

    const projects = await client.query<{ name: string; is_public: boolean; input: string }>(
      'select "name", "is_public", "input"::text as input from "projects" order by "name"',
    );
    const accidental = projects.rows.find((p) => p.name === "پروژه قدیمی عمومی");
    const deliberate = projects.rows.find((p) => p.name === "پروژه منتشرشده آگاهانه");
    eq(accidental?.is_public, false, "انتشار تصادفی گذشته بسته شد (is_public = false)");
    eq(deliberate?.is_public, true, "انتشار ثبت‌شده در رخداد حفظ شد (is_public = true)");
    check(Boolean(accidental?.input.includes("پروژه قدیمی عمومی")), "داده JSON پروژه بدون تغییر باقی مانده است");

    const attemptsType = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_name = 'otp_codes' and column_name = 'attempts'",
    );
    eq(attemptsType.rows[0]?.data_type, "integer", "ستون attempts از text به integer تبدیل شد");
    const attemptsValue = await client.query<{ attempts: number }>('select "attempts" from "otp_codes" limit 1');
    eq(attemptsValue.rows[0]?.attempts, 3, "مقدار شمارنده تلاش‌ها حفظ شد (۳)");

    const shareColumn = await client.query(
      "select 1 from information_schema.columns where table_name = 'projects' and column_name = 'share_expires_at'",
    );
    eq(shareColumn.rowCount, 1, "ستون share_expires_at اضافه شد");
    const rateLimits = await client.query(
      "select 1 from information_schema.tables where table_name = 'rate_limits'",
    );
    eq(rateLimits.rowCount, 1, "جدول rate_limits ساخته شد");

    const fk = await client.query<{ convalidated: boolean }>(
      "select convalidated from pg_constraint where conname = 'projects_owner_user_users_id_fk'",
    );
    eq(fk.rowCount, 1, "کلید خارجی مالکیت اضافه شد");
    eq(fk.rows[0]?.convalidated, false, "کلید خارجی به‌صورت NOT VALID اضافه شد (داده معیوب قدیمی مهاجرت را نمی‌شکند)");

    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    const indexNames = indexes.rows.map((r) => r.indexname);
    for (const required of [
      "projects_owner_idx",
      "projects_updated_idx",
      "sessions_user_idx",
      "sessions_expires_idx",
      "otp_phone_created_idx",
      "project_events_project_kind_idx",
      "rate_limits_window_idx",
    ]) {
      check(indexNames.includes(required), `ایندکس ${required} ساخته شد`);
    }

    const ledger = await client.query<{ version: string }>(
      'select "version" from "_hermiplan_migrations" order by "version"',
    );
    eq(
      ledger.rows.map((r) => r.version).join(","),
      migrationVersions().join(","),
      "دفتر مهاجرت همه فایل‌ها را ثبت کرد",
    );

    // 0003 — share tokens: additive only, so the legacy rows must be untouched.
    const shareTable = await client.query(
      "select 1 from information_schema.tables where table_name = 'project_share_tokens'",
    );
    eq(shareTable.rowCount, 1, "جدول project_share_tokens ساخته شد");
    const shareFk = await client.query<{ delete_rule: string }>(
      `select rc.delete_rule
         from information_schema.referential_constraints rc
         join information_schema.table_constraints tc
           on tc.constraint_name = rc.constraint_name
        where tc.table_name = 'project_share_tokens'`,
    );
    eq(shareFk.rows[0]?.delete_rule, "CASCADE", "حذف پروژه، لینک‌های اشتراک آن را پاک می‌کند (CASCADE)");
    const shareIndexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'project_share_tokens'",
    );
    const shareIndexNames = shareIndexes.rows.map((r) => r.indexname);
    check(shareIndexNames.includes("project_share_tokens_hash_idx"), "ایندکس یکتای هش توکن ساخته شد");
    const countsAfter = await client.query<{ projects: number }>('select count(*)::int as projects from "projects"');
    eq(countsAfter.rows[0]?.projects, 2, "مهاجرت ۰۰۰۳ هیچ پروژه‌ای را حذف نکرد");

    // 0004 — revision history. Additive: the legacy projects are untouched and
    // simply start at version 1 without a back-filled snapshot.
    const historyTable = await client.query(
      "select 1 from information_schema.tables where table_name = 'project_versions'",
    );
    eq(historyTable.rowCount, 1, "جدول project_versions ساخته شد");
    const versionColumn = await client.query<{ column_default: string | null; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_name = 'projects' and column_name = 'version'`,
    );
    eq(versionColumn.rows[0]?.column_default, "1", "ستون projects.version با پیش‌فرض ۱ اضافه شد");
    eq(versionColumn.rows[0]?.is_nullable, "NO", "ستون version اجباری است");
    const versionsOfLegacy = await client.query<{ version: number }>('select version from "projects" order by created_at');
    check(
      versionsOfLegacy.rows.every((row) => row.version === 1),
      "پروژه‌های قدیمی از نسخه ۱ شروع می‌کنند",
    );
    const historyRows = await client.query<{ count: number }>(
      "select count(*)::int as count from project_versions",
    );
    eq(historyRows.rows[0]?.count, 0, "تاریخچه برای پروژه‌های قدیمی از پیش پر نمی‌شود (بی‌دلیل حجم داده دو برابر نمی‌شود)");
    const historyFk = await client.query<{ delete_rule: string }>(
      `select rc.delete_rule
         from information_schema.referential_constraints rc
         join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
        where tc.table_name = 'project_versions'`,
    );
    eq(historyFk.rows[0]?.delete_rule, "CASCADE", "حذف پروژه، تاریخچه آن را هم پاک می‌کند (CASCADE)");
  }

  if (PHASE === "rollback") {
    // Newest first: 0003, then 0002 — the order a real operator would use.
    for (const file of ["0004_project_versions.rollback.sql", "0003_share_tokens.rollback.sql", "0002_security_hardening.rollback.sql"]) {
      console.log(`▶ اجرای rollback رسمی ${file}`);
      const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
      await client.query(sql);
      console.log("  ✓ rollback اجرا شد");
    }
  }

  if (PHASE === "verify-rollback") {
    console.log("▶ تأیید rollback: اسکیمای قبلی بازگشت و داده‌ها سالم ماندند");
    const attemptsType = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_name = 'otp_codes' and column_name = 'attempts'",
    );
    eq(attemptsType.rows[0]?.data_type, "text", "attempts به text بازگشت");
    const rateLimits = await client.query(
      "select 1 from information_schema.tables where table_name = 'rate_limits'",
    );
    eq(rateLimits.rowCount, 0, "جدول rate_limits حذف شد");
    const defaultPublic = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'projects' and column_name = 'is_public'",
    );
    eq(defaultPublic.rows[0]?.column_default, "true", "پیش‌فرض is_public به مقدار قبلی بازگشت");
    const counts = await client.query<{ projects: number }>('select count(*)::int as projects from "projects"');
    eq(counts.rows[0]?.projects, 2, "پروژه‌ها در rollback حذف نشدند");
    const stillPrivate = await client.query<{ is_public: boolean }>(
      `select "is_public" from "projects" where "name" = 'پروژه قدیمی عمومی'`,
    );
    check(stillPrivate.rows[0]?.is_public === false, "rollback عمداً پروژه را دوباره عمومی نکرد (حفاظت از داده)");
    const shareTable = await client.query(
      "select 1 from information_schema.tables where table_name = 'project_share_tokens'",
    );
    eq(shareTable.rowCount, 0, "جدول لینک‌های اشتراک در rollback حذف شد");
    const historyTable = await client.query(
      "select 1 from information_schema.tables where table_name = 'project_versions'",
    );
    eq(historyTable.rowCount, 0, "جدول تاریخچه در rollback حذف شد");
    const versionColumn = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_name = 'projects' and column_name = 'version'",
    );
    eq(versionColumn.rowCount, 0, "ستون version حذف شد (کد نسخه قبلی بدون آن کار می‌کند)");
    const countsAfterRollback = await client.query<{ projects: number }>(
      'select count(*)::int as projects from "projects"',
    );
    eq(countsAfterRollback.rows[0]?.projects, 2, "بازگشت ۰۰۰۴ هیچ پروژه‌ای را حذف نکرد");
  }

  await client.end();
  console.log(
    failures === 0
      ? checks === 0
        ? `\n✔ مرحله «${PHASE}» بدون خطا اجرا شد`
        : `\n✔ مرحله «${PHASE}» با ${checks} بررسی موفق`
      : `\n✘ ${failures} خطا از ${checks} بررسی`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("legacy-db-check failed:", error);
  process.exit(1);
});
