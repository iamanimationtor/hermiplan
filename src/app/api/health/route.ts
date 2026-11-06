import { db } from "@/db";
import { sql } from "drizzle-orm";
import { SCHEMA_VERSION } from "@/db/schema";
import { describeAccessMode } from "@/lib/server/access-mode";
import {
  DATABASE_MISSING_MESSAGE,
  MIGRATION_MESSAGE,
  isDatabaseUnconfigured,
} from "@/lib/server/schema";
import { isDatabaseConfigured } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + **migration** probe, used by deployments, uptime checks and the
 * test suite.
 *
 * It answers one question honestly: "does the database this process talks to
 * have everything the current code needs?" A deploy that forgot
 * `npm run db:migrate` must fail *here* (503, with the missing objects named)
 * rather than failing later on a user's share link.
 */
const REQUIRED_TABLES = [
  "projects",
  "users",
  "sessions",
  "otp_codes",
  "project_events",
  "rate_limits",
  "project_share_tokens",
  // 0004 — revision history. A database migrated only through 0003 is a real
  // (recoverable) deployment mistake and must be reported here, not later.
  "project_versions",
];

/**
 * Columns a *fully* migrated database must have.
 *
 * Tables are not enough: `0004`/`0005` add columns to existing tables, so a
 * database migrated only through `0003` has every table and still breaks on
 * the first save (no `projects.version`) or the first sign-in (no
 * `users.password_hash`). Reporting that here turns a confusing 500 into a
 * deployment instruction.
 */
const REQUIRED_COLUMNS: { table: string; column: string }[] = [
  { table: "projects", column: "version" },
  { table: "users", column: "username" },
  { table: "users", column: "password_hash" },
];

export async function GET() {
  try {
    await db.execute(sql`select 1`);

    const present = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('projects', 'users', 'sessions', 'otp_codes',
                            'project_events', 'rate_limits', 'project_share_tokens',
                            'project_versions')
    `);
    const rows = (present as unknown as { rows?: { table_name: string }[] }).rows ?? [];
    const found = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));

    const presentColumns = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('projects', 'users')
    `);
    const columnRows = (presentColumns as unknown as { rows?: { table_name: string; column_name: string }[] }).rows ?? [];
    const foundColumns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = missing.length
      ? []
      : REQUIRED_COLUMNS.filter(({ table, column }) => !foundColumns.has(`${table}.${column}`)).map(
          ({ table, column }) => `${table}.${column}`,
        );

    if (missing.length > 0 || missingColumns.length > 0) {
      return Response.json(
        {
          ok: false,
          schemaVersion: SCHEMA_VERSION,
          database: "ok",
          missingTables: missing,
          missingColumns,
          message: MIGRATION_MESSAGE,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        database: "ok",
        // both stores exist ⇒ the security and share migrations have run
        rateLimitStore: "postgres",
        shareLinks: "postgres",
        revisionHistory: "postgres",
        smsConfigured: Boolean(process.env.SMS_PROVIDER_KEY),
        // "open" = pre-release: product quotas lifted by config/access.json.
        access: describeAccessMode(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // A probe is read by whoever deploys. "ok:false" with no word of
    // explanation is not an answer, so every failure names its state and the
    // fix: no DATABASE_URL at all, or a database that cannot be reached.
    if (isDatabaseUnconfigured(error) || !isDatabaseConfigured()) {
      return Response.json(
        {
          ok: false,
          schemaVersion: SCHEMA_VERSION,
          database: "unconfigured",
          code: "database_unconfigured",
          message: DATABASE_MISSING_MESSAGE,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[health] database probe failed:", error);
    return Response.json(
      {
        ok: false,
        schemaVersion: SCHEMA_VERSION,
        database: "unreachable",
        code: "database_unreachable",
        message: "اتصال به پایگاه داده برقرار نشد؛ DATABASE_URL و دسترس‌پذیری سرور را بررسی کنید",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
