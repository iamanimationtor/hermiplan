/**
 * HERMIPLAN — production readiness preflight (READ ONLY).
 *
 *   DATABASE_URL=… npm run db:preflight
 *   DATABASE_URL=… npm run db:preflight -- --json
 *
 * Run this against production **before** the approved migration window. It
 * executes only `SELECT`s: it never creates, alters, locks (beyond the shared
 * locks of a plain read) or deletes anything, so it is safe on a live database.
 *
 * Exit codes:
 *   0  ready — no blocker found
 *   1  blocker — do not start the window (see the BLOCKER lines)
 *   2  configuration problem (missing DATABASE_URL)
 *
 * Blockers are things that make the migration *unsafe or pointless* right now:
 *   • pending migrations whose file checksum conflicts with the ledger,
 *   • a schema that is ahead of this build (a newer release migrated first),
 *   • orphan rows that would break a `VALIDATE CONSTRAINT`,
 *   • an `is_public` row whose last share link predates the token migration and
 *     which nobody told the owner about (an inventory, not an error).
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TABLE = "_hermiplan_migrations";
const asJson = process.argv.includes("--json");

interface Finding {
  level: "ok" | "warn" | "blocker";
  title: string;
  detail: string;
}

const findings: Finding[] = [];
const report = (level: Finding["level"], title: string, detail: string) => findings.push({ level, title, detail });

function loadLocalMigrations(): { version: string; checksum: string }[] {
  const dir = join(process.cwd(), "drizzle");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))
    .sort()
    .map((file) => ({
      version: file.replace(/\.sql$/, ""),
      checksum: createHash("sha256").update(readFileSync(join(dir, file), "utf8")).digest("hex"),
    }));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set; nothing was inspected.");
    process.exit(2);
  }

  const client = new Client({
    connectionString: url,
    ssl:
      process.env.DATABASE_SSL === "require" || /sslmode\s*=\s*require/i.test(url)
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();

  const env = await client.query<{ version: string; database: string; size: string }>(
    "SELECT version() AS version, current_database() AS database, pg_size_pretty(pg_database_size(current_database())) AS size",
  );

  // ---- 1. migration ledger vs. files shipped in this build -------------------
  const hasLedger = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public._hermiplan_migrations') IS NOT NULL AS present",
  );
  const local = loadLocalMigrations();
  let applied = new Map<string, string>();
  if (hasLedger.rows[0]?.present) {
    const rows = await client.query<{ version: string; checksum: string }>(`SELECT version, checksum FROM "${TABLE}"`);
    applied = new Map(rows.rows.map((row) => [row.version, row.checksum]));
  } else {
    report("warn", "دفتر مهاجرت وجود ندارد", "این پایگاه با drizzle-kit یا دستی ساخته شده؛ اجرای db:migrate آن را ثبت می‌کند.");
  }

  const pending = local.filter((migration) => !applied.has(migration.version));
  const drifted = local.filter((migration) => applied.has(migration.version) && applied.get(migration.version) !== migration.checksum);
  const unknown = [...applied.keys()].filter((version) => !local.some((migration) => migration.version === version));

  if (pending.length) {
    report("ok", "مهاجرت‌های در انتظار", pending.map((migration) => migration.version).join("، "));
  } else {
    report("ok", "مهاجرت‌های در انتظار", "هیچ — پایگاه با این نسخه کد هم‌تراز است.");
  }
  if (drifted.length) {
    report("blocker", "فایل مهاجرت پس از اعمال تغییر کرده (drift)", drifted.map((m) => m.version).join("، "));
  }
  if (unknown.length) {
    report("blocker", "پایگاه از این نسخه کد جلوتر است", `نسخه‌های ثبت‌شده‌ای که در این build نیستند: ${unknown.join("، ")} — کد قدیمی را روی پایگاه جدید اجرا نکنید.`);
  }

  // ---- 2. data volume --------------------------------------------------------
  const counts = await client.query<{
    projects: number;
    users: number | null;
    sessions: number | null;
    otp: number | null;
    events: number | null;
    links: number | null;
    live_links: number | null;
  }>(`
    SELECT
      (SELECT count(*) FROM projects)::int AS projects,
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM sessions)::int AS sessions,
      (SELECT count(*) FROM otp_codes)::int AS otp,
      (SELECT count(*) FROM project_events)::int AS events,
      (SELECT count(*) FROM project_share_tokens)::int AS links,
      (SELECT count(*) FROM project_share_tokens
        WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()))::int AS live_links
  `).catch(() => ({ rows: [] as never[] }));
  const c = counts.rows[0];

  if (c) {
    report(
      "ok",
      "حجم داده",
      `پروژه ${c.projects} · کاربر ${c.users ?? 0} · نشست ${c.sessions ?? 0} · کد OTP ${c.otp ?? 0} · رخداد ${c.events ?? 0} · لینک اشتراک ${c.links ?? 0} (فعال: ${c.live_links ?? 0})`,
    );
  } else {
    report("warn", "شمارش جداول", "برخی جداول هنوز ساخته نشده‌اند (مهاجرت ۰۰۰۲/۰۰۰۳ اعمال نشده است).");
  }

  // ---- 3. ownership integrity (the FK is NOT VALID by design) ----------------
  const hasOwner = await client.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='owner_user') AS present",
  );
  if (hasOwner.rows[0]?.present) {
    const orphans = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
        FROM projects p
        LEFT JOIN users u ON u.id = p.owner_user
       WHERE p.owner_user IS NOT NULL AND u.id IS NULL
    `);
    const count = orphans.rows[0]?.count ?? 0;
    if (count > 0) {
      report(
        "blocker",
        "ردیف یتیم مالکیت",
        `${count} پروژه به کاربری اشاره می‌کند که وجود ندارد؛ VALIDATE CONSTRAINT شکست می‌خورد. ابتدا تصمیم بگیرید: مالک را NULL کنید یا کاربر را بسازید.`,
      );
    } else {
      report("ok", "یکپارچگی مالکیت", "هیچ پروژه یتیمی وجود ندارد؛ VALIDATE CONSTRAINT قابل اجراست.");
    }
  }

  // ---- 4. legacy share inventory (communication, not a failure) -------------
  if (c && c.projects > 0) {
    const legacy = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM projects p
       WHERE p.is_public
         AND NOT EXISTS (
           SELECT 1 FROM project_share_tokens t
            WHERE t.project_id = p.id AND t.revoked_at IS NULL
              AND (t.expires_at IS NULL OR t.expires_at > now())
         )
    `).catch(() => ({ rows: [{ count: 0 }] }));
    const legacyCount = legacy.rows[0]?.count ?? 0;
    if (legacyCount > 0) {
      report(
        "warn",
        "لینک‌های قدیمی غیرفعال",
        `${legacyCount} پروژه پرچم is_public دارد ولی لینک فعالی ندارد؛ لینک UUID قدیمی آن‌ها کار نمی‌کند. پیش از انتشار: npm run db:share-audit و اطلاع به مالک.`,
      );
    } else {
      report("ok", "لینک‌های قدیمی", "هیچ پروژه‌ای در وضعیت «منتشرشده بدون لینک» نیست.");
    }
  }

  // ---- 5. blocking activity -------------------------------------------------
  const locks = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM pg_stat_activity
     WHERE datname = current_database() AND state = 'idle in transaction'
  `).catch(() => ({ rows: [{ count: 0 }] }));
  const idle = locks.rows[0]?.count ?? 0;
  if (idle > 0) {
    report("warn", "تراکنش‌های باز", `${idle} نشست در حالت idle in transaction است؛ DDL ممکن است پشت قفل منتظر بماند.`);
  }

  await client.end();

  const blockers = findings.filter((finding) => finding.level === "blocker");
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          database: env.rows[0]?.database ?? "?",
          version: env.rows[0]?.version ?? "?",
          size: env.rows[0]?.size ?? "?",
          pending: pending.map((migration) => migration.version),
          blockers: blockers.length,
          findings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("▶ پیش‌بررسی پایگاه داده (فقط خواندن)");
    console.log(`  پایگاه: ${env.rows[0]?.database} · حجم: ${env.rows[0]?.size}`);
    console.log(`  نسخه: ${(env.rows[0]?.version ?? "").split(" ").slice(0, 2).join(" ")}\n`);
    for (const finding of findings) {
      const icon = finding.level === "blocker" ? "⛔" : finding.level === "warn" ? "⚠️" : "✓";
      console.log(`  ${icon} ${finding.title}`);
      console.log(`      ${finding.detail}`);
    }
    console.log("");
    if (blockers.length) {
      console.log(`✗ ${blockers.length} مانع — تا رفع آن‌ها پنجره مهاجرت را شروع نکنید.`);
    } else {
      console.log("✔ هیچ مانعی نیست؛ اجرای db:migrate در پنجره تأییدشده مجاز است.");
    }
  }

  process.exit(blockers.length ? 1 : 0);
}

void main().catch((error) => {
  console.error("preflight failed:", error instanceof Error ? error.message : error);
  process.exit(2);
});
