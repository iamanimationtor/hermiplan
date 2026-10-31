import { db } from "@/db";
import { sql } from "drizzle-orm";
import { SCHEMA_VERSION } from "@/db/schema";
import { describeAccessMode } from "@/lib/server/access-mode";

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

    if (missing.length > 0) {
      return Response.json(
        {
          ok: false,
          schemaVersion: SCHEMA_VERSION,
          database: "ok",
          missingTables: missing,
          message: "مهاجرت‌ها اعمال نشده‌اند؛ npm run db:migrate را اجرا کنید",
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
  } catch {
    return Response.json({ ok: false, schemaVersion: SCHEMA_VERSION }, { status: 500 });
  }
}
