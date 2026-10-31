import { db } from "@/db";
import { sql } from "drizzle-orm";
import { SCHEMA_VERSION } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Liveness + configuration probe used by deployments and by the test suite.
 * It reports the schema revision the application expects, so a deploy that
 * forgot to run `npm run db:migrate` is immediately visible.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const tables = await db.execute<{ present: boolean }>(sql`
      SELECT to_regclass('public.rate_limits') IS NOT NULL AS present
    `);
    const rateLimitsReady = (tables as unknown as { rows?: { present: boolean }[] }).rows?.[0]?.present ?? false;
    return Response.json(
      {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        database: "ok",
        // false means the security migration has not been applied yet
        rateLimitStore: rateLimitsReady ? "postgres" : "memory-fallback",
        smsConfigured: Boolean(process.env.SMS_PROVIDER_KEY),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, schemaVersion: SCHEMA_VERSION }, { status: 500 });
  }
}
