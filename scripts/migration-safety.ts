/**
 * HERMIPLAN — migration runner safety checks (real files, real database).
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/migration-safety.ts
 *
 * These are the properties the deployment runbook relies on, tested rather than
 * assumed:
 *
 *  1. every migration file has a paired `.rollback.sql` (reversibility),
 *  2. a second `db:migrate` applies nothing and changes no timestamps
 *     (idempotency),
 *  3. editing an already-applied file is refused with a non-zero exit
 *     (drift detection), and the ledger is left intact,
 *  4. restoring the original checksum lets the runner proceed again,
 *  5. the baseline rollback refuses to run without its confirmation table and
 *     leaves the schema untouched when it refuses,
 *  6. a full rollback followed by `db:migrate` rebuilds the identical schema,
 *  7. the 0004/0003/0002 rollbacks run, actually remove what they added, and
 *     can be re-applied (steps 5–7 need
 *     MIGRATION_SAFETY_ROLLBACK=1 because they empty the database).
 *
 * It deliberately runs against a **test** database: it edits the ledger row and
 * restores it. Never point it at production.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { SCHEMA_VERSION } from "../src/db/schema";
import { DATABASE_MISSING_MESSAGE, MIGRATION_MESSAGE, isDatabaseUnconfigured, isSchemaError } from "../src/lib/server/schema";
import { DatabaseNotConfiguredError } from "../src/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must point at a TEST database.");
  process.exit(2);
}

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

function runMigrate(): { code: number; output: string } {
  const result = spawnSync("npx", ["tsx", "scripts/migrate.ts"], { encoding: "utf8", env: process.env });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

async function main(): Promise<void> {
  const dir = join(process.cwd(), "drizzle");
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))
    .sort();

  console.log("▶ ۱. هر مهاجرت فایل بازگشت جفت‌شده دارد");
  for (const file of migrations) {
    const rollback = file.replace(/\.sql$/, ".rollback.sql");
    const exists = readdirSync(dir).includes(rollback);
    check(exists, `${file} → ${rollback}`, exists ? "" : "missing");
  }

  // Numbering and the advertised schema version are cheap invariants that break
  // silently: a skipped number, or a new migration without a `SCHEMA_VERSION`
  // bump (the health endpoint would then understate the schema it needs).
  const numbers = migrations.map((file) => Number.parseInt(file.slice(0, 4), 10));
  const sequential = numbers.every((value, index) => value === index + 1);
  check(sequential, "شماره‌گذاری مهاجرت‌ها پیوسته است", numbers.join(","));
  check(
    SCHEMA_VERSION === numbers[numbers.length - 1],
    "SCHEMA_VERSION با آخرین مهاجرت هم‌خوان است",
    `${SCHEMA_VERSION} در برابر ${numbers[numbers.length - 1]}`,
  );

  // A deploy that skipped `db:migrate` must be reported as such, not as a bug.
  // The classifier is what turns "column users.username does not exist" into a
  // 503 with the migration instruction, so it is tested here alongside the
  // runner that creates those columns in the first place.
  console.log("\n▶ ۸. تشخیص پایگاه مهاجرت‌نشده (نقشهٔ خطای اسکیما)");
  check(isSchemaError({ code: "42703" }), "ستون ناموجود (42703) اسکیما شناسایی می‌شود");
  check(isSchemaError({ code: "42P01" }), "جدول ناموجود (42P01) اسکیما شناسایی می‌شود");
  check(isSchemaError({ cause: { cause: { code: "42703" } } }), "خطای پیچیده‌شده در cause هم شناسایی می‌شود");
  check(!isSchemaError({ code: "23505" }), "نقض یکتایی (23505) اسکیما نیست و مسیر ۴۰۹ خودش را نگه می‌دارد");
  check(!isSchemaError(null) && !isSchemaError("boom") && !isSchemaError({ code: 42 }), "مقادیر غیرخطا اسکیما شمرده نمی‌شوند");
  check(
    MIGRATION_MESSAGE.includes("db:migrate") && MIGRATION_MESSAGE.length > 20,
    "پیام راهنما شامل فرمان اجراست و خالی نیست",
    MIGRATION_MESSAGE,
  );

  // The other deployment state: no database at all. It must be recognised as
  // such (503 + instruction), never confused with a code bug or with a schema
  // problem — a wrong classification here sends the operator to the wrong fix.
  check(isDatabaseUnconfigured(new DatabaseNotConfiguredError()), "نبودِ DATABASE_URL شناسایی می‌شود");
  check(
    isDatabaseUnconfigured({ name: "DatabaseNotConfiguredError" }),
    "خطای نبودِ پایگاه حتی پس از عبور از مرز ماژول شناسایی می‌شود",
  );
  check(
    isDatabaseUnconfigured({ cause: { code: "database_unconfigured" } }),
    "کد database_unconfigured در cause هم شناسایی می‌شود",
  );
  check(
    !isDatabaseUnconfigured({ code: "42703" }) && !isDatabaseUnconfigured(new Error("boom")),
    "خطای اسکیما یا خطای معمولی، «نبودِ پایگاه» شمرده نمی‌شود",
  );
  check(
    DATABASE_MISSING_MESSAGE.includes("DATABASE_URL") && DATABASE_MISSING_MESSAGE.length > 20,
    "پیام نبودِ پایگاه، نام متغیر محیطی را می‌گوید",
    DATABASE_MISSING_MESSAGE,
  );

  const client = new Client({ connectionString: url });
  await client.connect();

  console.log("\n▶ ۲. اجرای دوباره چیزی اعمال نمی‌کند (idempotency)");
  const first = runMigrate();
  check(first.code === 0, "اجرای اول موفق است", first.output.trim().split("\n").slice(-1)[0]);
  const before = await client.query<{ version: string; applied_at: Date }>(
    "select version, applied_at from _hermiplan_migrations order by version",
  );
  check(before.rows.length >= migrations.length, "همه مهاجرت‌ها در دفتر ثبت شده‌اند", `${before.rows.length}/${migrations.length}`);

  const second = runMigrate();
  check(second.code === 0, "اجرای دوم بدون خطاست");
  check(/Nothing to do|up to date/i.test(second.output), "اجرای دوم «کاری برای انجام» گزارش می‌کند", second.output.trim().split("\n").slice(-1)[0]);
  const after = await client.query<{ version: string; applied_at: Date }>(
    "select version, applied_at from _hermiplan_migrations order by version",
  );
  check(
    after.rows.length === before.rows.length &&
      after.rows.every((row, index) => row.version === before.rows[index].version &&
        new Date(row.applied_at).getTime() === new Date(before.rows[index].applied_at).getTime()),
    "زمان اعمال هیچ مهاجرتی تغییر نکرد",
  );

  console.log("\n▶ ۳. تغییر فایل اعمال‌شده رد می‌شود (drift detection)");
  const last = before.rows[before.rows.length - 1]?.version;
  const originalChecksum = createHash("sha256")
    .update(readFileSync(join(dir, `${last}.sql`), "utf8"))
    .digest("hex");
  await client.query("update _hermiplan_migrations set checksum = $1 where version = $2", ["tampered", last]);
  const tampered = runMigrate();
  check(tampered.code !== 0, "اجرا با checksum دست‌کاری‌شده با خطا متوقف می‌شود", `exit=${tampered.code}`);
  check(/drift|checksum|تغییر|modified/i.test(tampered.output), "پیام خطا علت را می‌گوید", tampered.output.trim().split("\n").slice(-2).join(" "));

  console.log("\n▶ ۴. بازگردانی checksum، اجرا را سالم می‌کند");
  await client.query("update _hermiplan_migrations set checksum = $1 where version = $2", [originalChecksum, last]);
  const restored = runMigrate();
  check(restored.code === 0, "پس از بازگردانی، اجرا موفق است", `exit=${restored.code}`);
  const ledger = await client.query<{ checksum: string }>(
    "select checksum from _hermiplan_migrations where version = $1",
    [last],
  );
  check(ledger.rows[0]?.checksum === originalChecksum, "checksum دفتر با فایل هم‌خوان است");

  /* ---------------- 5-6. rollback rehearsal (opt-in) ---------------- */
  if (process.env.MIGRATION_SAFETY_ROLLBACK === "1") {
    const snapshot = async (): Promise<string> => {
      const query = await client.query<{ table_name: string; column_name: string; data_type: string }>(`
        SELECT c.table_name, c.column_name, c.data_type
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name <> '_hermiplan_migrations'
         ORDER BY c.table_name, c.column_name
      `);
      return query.rows.map((row) => `${row.table_name}.${row.column_name}:${row.data_type}`).join("\n");
    };
    const beforeRollback = await snapshot();

    console.log("\n▶ ۵. بازگشت بدون تأیید صریح اجرا نمی‌شود (destructive guard)");
    const baselineRollback = readFileSync(join(dir, "0001_baseline.rollback.sql"), "utf8");
    let guarded = false;
    try {
      await client.query(baselineRollback);
    } catch (error) {
      guarded = /Refusing to drop the HERMIPLAN baseline/.test(error instanceof Error ? error.message : "");
      // The file opens its own transaction; the exception leaves the session in
      // an aborted transaction, so roll it back before touching the database
      // again (a real operator would see the same thing in psql).
      await client.query("ROLLBACK").catch(() => undefined);
    }
    check(guarded, "فایل بازگشت پایه بدون جدول تأیید، خطا می‌دهد");
    const survivors = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('projects','users','sessions','otp_codes','project_events')",
    );
    check(Number(survivors.rows[0]?.count) === 5, "پس از تلاش ناموفق، جدول‌ها دست‌نخورده‌اند", `found ${survivors.rows[0]?.count}`);

    console.log("\n▶ ۶. بازگشت کامل و مهاجرت دوباره، همان ساختار را می‌سازد");
    await client.query('CREATE TABLE "_hermiplan_rollback_baseline_ok" ()');
    await client.query(baselineRollback);
    const afterDrop = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('projects','users','sessions','otp_codes','project_events')",
    );
    check(Number(afterDrop.rows[0]?.count) === 0, "همه جدول‌های پایه حذف شدند", `left ${afterDrop.rows[0]?.count}`);
    const ledgerAfterDrop = await client.query<{ count: string }>("select count(*) from _hermiplan_migrations");
    check(Number(ledgerAfterDrop.rows[0]?.count) === 0, "دفتر مهاجرت خالی شد (اجرای بعدی از ۰۰۰۱ شروع می‌کند)");

    const rebuild = runMigrate();
    check(rebuild.code === 0, "اجرای دوباره مهاجرت‌ها موفق است", `exit=${rebuild.code}`);
    const afterRebuild = await snapshot();
    check(afterRebuild === beforeRollback, "ساختار بازسازی‌شده با ساختار پیش از بازگشت یکسان است");

    console.log("\n▶ ۶-ب. بازگشت ۰۰۰۵ با حسابِ بدون شماره متوقف می‌شود (نه حذف داده)");
    await client.query(
      "insert into users (username, password_hash) values ('rollbackprobe', 'scrypt$32768$8$1$x$y')",
    );
    let guardMessage = "";
    try {
      await client.query(readFileSync(join(dir, "0005_user_credentials.rollback.sql"), "utf8"));
    } catch (error) {
      guardMessage = error instanceof Error ? error.message : String(error);
      await client.query("ROLLBACK").catch(() => undefined);
    }
    check(
      /rollback 0005 aborted/.test(guardMessage),
      "حساب بدون شماره ⇒ بازگشت ۰۰۰۵ با پیام روشن متوقف می‌شود",
      guardMessage.split("\n")[0],
    );
    const credentialColumns = await client.query<{ count: string }>(
      "select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('username','password_hash')",
    );
    check(Number(credentialColumns.rows[0]?.count) === 2, "پس از تلاش ناموفق، ستون‌های اعتبارسنجی دست‌نخورده‌اند");
    await client.query("delete from users where username = 'rollbackprobe'");
    const cleanRollback = readFileSync(join(dir, "0005_user_credentials.rollback.sql"), "utf8");
    let cleanError = "";
    try {
      await client.query(cleanRollback);
    } catch (error) {
      cleanError = error instanceof Error ? error.message : String(error);
      await client.query("ROLLBACK").catch(() => undefined);
    }
    check(cleanError === "", "با حذف حساب بدون شماره، بازگشت ۰۰۰۵ کامل می‌شود", cleanError.split("\n")[0]);

    console.log("\n▶ ۷. بازگشت مهاجرت‌های شماره‌دار هم اجرا می‌شود و قابل بازاعمال است");
    for (const version of ["0004_project_versions", "0003_share_tokens", "0002_security_hardening"]) {
      await client.query(readFileSync(join(dir, `${version}.rollback.sql`), "utf8"));
      const row = await client.query("select 1 from _hermiplan_migrations where version = $1", [version]);
      check(row.rowCount === 0, `${version}: ردیف دفتر حذف شد`);
    }
    const droppedTables = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema='public' and table_name in ('project_versions','project_share_tokens','rate_limits')",
    );
    check(Number(droppedTables.rows[0]?.count) === 0, "۰۰۰۲–۰۰۰۴ جدول‌های افزوده را واقعاً حذف کردند", `left ${droppedTables.rows[0]?.count}`);
    const versionColumn = await client.query(
      "select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='version'",
    );
    check(versionColumn.rowCount === 0, "ستون projects.version با بازگشت ۰۰۰۴ حذف شد");
    const usernameColumn = await client.query(
      "select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='username'",
    );
    check(usernameColumn.rowCount === 0, "ستون users.username با بازگشت ۰۰۰۵ حذف شد");
    const phoneNullable = await client.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_schema='public' and table_name='users' and column_name='phone'",
    );
    check(phoneNullable.rows[0]?.is_nullable === "NO", "بازگشت ۰۰۰۵ شماره موبایل را دوباره اجباری کرد", phoneNullable.rows[0]?.is_nullable);
    const otpType = await client.query<{ data_type: string }>(
      "select data_type from information_schema.columns where table_schema='public' and table_name='otp_codes' and column_name='attempts'",
    );
    check(otpType.rows[0]?.data_type === "text", "ستون attempts به text بازگشت", otpType.rows[0]?.data_type);
    const defaultFlag = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_schema='public' and table_name='projects' and column_name='is_public'",
    );
    check(defaultFlag.rows[0]?.column_default === "true", "پیش‌فرض is_public به true بازگشت (فقط ساختار)", defaultFlag.rows[0]?.column_default);
    const reapply = runMigrate();
    check(reapply.code === 0, "بازاعمال ۰۰۰۲–۰۰۰۴ موفق است", `exit=${reapply.code}`);
    const reappliedTables = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema='public' and table_name in ('project_versions','project_share_tokens','rate_limits')",
    );
    check(Number(reappliedTables.rows[0]?.count) === 3, "پس از بازاعمال، هر سه جدول برگشتند", `found ${reappliedTables.rows[0]?.count}`);
    const versionDefault = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_schema='public' and table_name='projects' and column_name='version'",
    );
    check(versionDefault.rows[0]?.column_default === "1", "ستون projects.version با پیش‌فرض ۱ بازگشت", versionDefault.rows[0]?.column_default);
    const reapplyFlag = await client.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_schema='public' and table_name='projects' and column_name='is_public'",
    );
    check(reapplyFlag.rows[0]?.column_default === "false", "پس از بازاعمال، پیش‌فرض خصوصی است", reapplyFlag.rows[0]?.column_default);
    const rebuiltAgain = await snapshot();
    check(rebuiltAgain === beforeRollback, "ساختار نهایی با ساختار اولیه یکسان است");
  }

  await client.end();

  console.log(
    failures.length === 0
      ? `\n✔ ${passed} بررسی ایمنی مهاجرت — همه موفق`
      : `\n✘ ${failures.length} خطا از ${passed + failures.length}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
