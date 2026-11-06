/**
 * HERMIPLAN — share-link inventory and legacy-link audit (read-only).
 *
 * Why
 * ---
 * Before migration `0003`, "shared" meant `projects.is_public = true`: anyone who
 * knew the UUID could open `/report/<uuid>`. After the migration, sharing needs
 * a token and `/report/<uuid>` is owner-only, so those legacy links stop working.
 * That is the intended behaviour (a UUID is not a credential), but the owner must
 * be able to see *which* projects are in that state and re-issue links
 * deliberately instead of discovering it from a client complaint.
 *
 * This script never writes. It prints, per project:
 *   • whether `is_public` is still set without any live token (a "legacy link"),
 *   • how many links are active / revoked / expired,
 *   • when each link was last used.
 *
 * Usage:
 *   DATABASE_URL=… npx tsx scripts/share-audit.ts
 *   DATABASE_URL=… npx tsx scripts/share-audit.ts --json
 */
import { Client } from "pg";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL must be set (read-only audit).");
  process.exit(1);
}

const asJson = process.argv.includes("--json");

interface Row {
  id: string;
  name: string;
  is_public: boolean;
  share_expires_at: Date | null;
  updated_at: Date;
  active: number;
  revoked: number;
  expired: number;
  legacy: boolean;
  last_used: Date | null;
}

async function main() {
  const client = new Client({ connectionString: URL });
  await client.connect();
  try {
    const result = await client.query<Row>(`
      SELECT
        p.id,
        p.name,
        p.is_public,
        p.share_expires_at,
        p.updated_at,
        coalesce(t.active, 0)::int  AS active,
        coalesce(t.revoked, 0)::int AS revoked,
        coalesce(t.expired, 0)::int AS expired,
        -- legacy: the flag still says "shared" but no token can grant access
        (p.is_public AND coalesce(t.active, 0) = 0) AS legacy,
        t.last_used
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active,
          count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked,
          count(*) FILTER (WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()) AS expired,
          max(last_used_at) AS last_used
        FROM project_share_tokens
        WHERE project_id = p.id
      ) t ON true
      ORDER BY legacy DESC, p.updated_at DESC
    `);

    const rows = result.rows;
    const legacy = rows.filter((row) => row.legacy);
    const shared = rows.filter((row) => row.active > 0);

    if (asJson) {
      console.log(JSON.stringify({ total: rows.length, legacy: legacy.length, shared: shared.length, rows }, null, 2));
      return;
    }

    console.log(`▶ موجودی لینک‌های اشتراک (فقط خواندن)`);
    console.log(`  پروژه‌ها: ${rows.length} · دارای لینک فعال: ${shared.length} · لینک قدیمی غیرفعال: ${legacy.length}\n`);

    if (legacy.length) {
      console.log("▶ پروژه‌هایی که پرچم is_public دارند ولی لینک فعالی ندارند (لینک قدیمی‌شان کار نمی‌کند):");
      for (const row of legacy) {
        console.log(
          `  • ${row.name} (${row.id}) — بازدید ثبت‌شده قبلی: ${row.last_used ? row.last_used.toISOString() : "—"}`,
        );
        console.log(`      اقدام پیشنهادی: اگر اشتراک هنوز لازم است، از پنل گزارش «ساخت لینک جدید» بزنید.`);
      }
      console.log(
        "\n  توجه: این ابزار هیچ چیزی را تغییر نمی‌دهد؛ تصمیم با مالک پروژه است.",
      );
    } else {
      console.log("▶ هیچ پروژه‌ای در وضعیت لینک قدیمی نیست.");
    }

    const active = rows.filter((row) => row.active > 0).slice(0, 20);
    if (active.length) {
      console.log("\n▶ لینک‌های فعال:");
      for (const row of active) {
        console.log(
          `  • ${row.name}: ${row.active} فعال، ${row.revoked} باطل، ${row.expired} منقضی — آخرین بازدید ${row.last_used ? row.last_used.toISOString() : "—"}`,
        );
      }
    }
  } finally {
    await client.end();
  }
}

void main();
