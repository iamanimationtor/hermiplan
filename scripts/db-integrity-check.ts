/**
 * HERMIPLAN — database integrity and concurrency checks against a **real**
 * PostgreSQL server (disposable database only).
 *
 * The PGlite-based integration suite cannot show the things that only a real
 * server exhibits: genuine row-level locking under parallel writers, `UNIQUE`
 * enforcement across connections, `ON DELETE CASCADE`, and whether a `NOT VALID`
 * foreign key can actually be validated (`ALTER TABLE … VALIDATE CONSTRAINT`).
 *
 * What it proves
 * --------------
 *  1. the distributed rate limiter is atomic: with N concurrent writers, exactly
 *     `limit` requests are allowed — no lost updates, no double-spend;
 *  2. `project_share_tokens.token_hash` is unique across connections;
 *  3. deleting a project cascades to its share tokens and its audit rows;
 *  4. the owner foreign key has no orphans, and `VALIDATE CONSTRAINT` succeeds
 *     on that data (the statement is rolled back, so nothing is left changed).
 *
 * Usage:
 *   DATABASE_URL=postgresql://…/hermiplan_conc npx tsx scripts/db-integrity-check.ts
 */
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL must be set (disposable database only).");
  process.exit(1);
}

let checks = 0;
let failures = 0;
function check(condition: boolean, message: string, detail?: string) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The exact statement used by `src/lib/server/rate-limit.ts`. */
const LIMIT_SQL = `
  INSERT INTO rate_limits (key, window_start, hits)
  VALUES ($1, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE
      WHEN rate_limits.window_start <= now() - ($2 * interval '1 millisecond') THEN 1
      ELSE rate_limits.hits + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start <= now() - ($2 * interval '1 millisecond') THEN now()
      ELSE rate_limits.window_start
    END
  RETURNING hits, window_start
`;

async function concurrency(): Promise<void> {
  console.log("▶ ۱. هم‌زمانی محدودیت نرخ روی PostgreSQL واقعی");
  const CONCURRENCY = 40;
  const LIMIT = 10;
  const WINDOW_MS = 60_000;
  const key = `concurrency:test:${randomUUID()}`;

  // One connection per simulated instance: this is what a serverless deployment
  // looks like, and it is exactly where an in-memory limiter would fail.
  const clients = await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      const client = new Client({ connectionString: URL });
      await client.connect();
      return client;
    }),
  );

  try {
    const results = await Promise.all(
      clients.map(async (client) => {
        const result = await client.query<{ hits: number }>(LIMIT_SQL, [key, WINDOW_MS]);
        return Number(result.rows[0]?.hits ?? 0);
      }),
    );

    const allowed = results.filter((hits) => hits <= LIMIT).length;
    const maxHits = Math.max(...results);
    check(
      allowed === LIMIT,
      `از ${CONCURRENCY} درخواست هم‌زمان دقیقاً ${LIMIT} درخواست مجاز شد (بدون گم‌شدن شمارش)`,
      `allowed=${allowed}, maxHits=${maxHits}`,
    );
    check(maxHits === CONCURRENCY, "شمارنده نهایی برابر تعداد واقعی درخواست‌هاست", `maxHits=${maxHits}`);

    const distinct = new Set(results).size;
    check(distinct === CONCURRENCY, "هیچ دو درخواستی مقدار شمارنده یکسان نگرفتند (هر ردیف قفل درست)", `distinct=${distinct}`);

    const stored = await clients[0].query<{ hits: number }>("SELECT hits FROM rate_limits WHERE key = $1", [key]);
    check(Number(stored.rows[0]?.hits) === CONCURRENCY, "مقدار ذخیره‌شده با تعداد واقعی مطابق است");
  } finally {
    await clients[0]?.query("DELETE FROM rate_limits WHERE key = $1", [key]).catch(() => undefined);
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

async function constraints(): Promise<void> {
  console.log("\n▶ ۲. قیدها، آبشاری‌شدن حذف و یکتایی هش توکن");
  const a = new Client({ connectionString: URL });
  const b = new Client({ connectionString: URL });
  await Promise.all([a.connect(), b.connect()]);

  const projectId = randomUUID();
  const hash = `test-hash-${randomUUID()}`;

  try {
    await a.query(
      `INSERT INTO projects (id, guest_token, name, input)
       VALUES ($1, $2, $3, '{"meta":{"name":"t","type":"general","currency":"IRR","startDate":"2026-01-03","statusDate":"2026-01-03"},"activities":[]}'::jsonb)`,
      [projectId, `guest-${projectId}`, "پروژه آزمون قیدها"],
    );
    await a.query("INSERT INTO project_share_tokens (project_id, token_hash) VALUES ($1, $2)", [projectId, hash]);
    await a.query("INSERT INTO project_events (project_id, kind) VALUES ($1, 'test')", [projectId]);

    // uniqueness must be enforced across connections, not just within one
    let duplicateRejected = false;
    try {
      await b.query("INSERT INTO project_share_tokens (project_id, token_hash) VALUES ($1, $2)", [projectId, hash]);
    } catch {
      duplicateRejected = true;
    }
    check(duplicateRejected, "هش تکراری توکن از اتصال دیگر رد می‌شود (UNIQUE واقعی)");

    // a token row must not exist without its project
    let fkRejected = false;
    try {
      await b.query("INSERT INTO project_share_tokens (project_id, token_hash) VALUES ($1, $2)", [
        randomUUID(),
        `orphan-${randomUUID()}`,
      ]);
    } catch {
      fkRejected = true;
    }
    check(fkRejected, "توکن با شناسه پروژه ناموجود رد می‌شود (FK واقعی)");

    // concurrency: two connections revoking the same token — exactly one wins
    const tokenId = (
      await a.query<{ id: string }>("SELECT id FROM project_share_tokens WHERE token_hash = $1", [hash])
    ).rows[0].id;
    const revoke = (client: Client) =>
      client.query(
        "UPDATE project_share_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id",
        [tokenId],
      );
    const [r1, r2] = await Promise.all([revoke(a), revoke(b)]);
    check(
      (r1.rowCount ?? 0) + (r2.rowCount ?? 0) === 1,
      "ابطال هم‌زمان یک لینک فقط یک‌بار اثر می‌گذارد (شرط revoked_at IS NULL اتمیک است)",
    );

    await a.query("DELETE FROM projects WHERE id = $1", [projectId]);
    const tokens = await a.query("SELECT count(*)::int AS c FROM project_share_tokens WHERE project_id = $1", [projectId]);
    const events = await a.query("SELECT count(*)::int AS c FROM project_events WHERE project_id = $1", [projectId]);
    check(tokens.rows[0].c === 0, "حذف پروژه، لینک‌های اشتراک آن را آبشاری پاک کرد");
    check(events.rows[0].c === 0, "حذف پروژه، رخدادهای حسابرسی آن را آبشاری پاک کرد");
  } finally {
    await a.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
    await Promise.all([a.end().catch(() => undefined), b.end().catch(() => undefined)]);
  }
}

async function validateConstraint(): Promise<void> {
  console.log("\n▶ ۳. یتیم‌های کلید خارجی مالکیت و VALIDATE CONSTRAINT");
  const client = new Client({ connectionString: URL });
  await client.connect();
  try {
    const orphans = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c
         FROM projects p
        WHERE p.owner_user IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.owner_user)`,
    );
    check(orphans.rows[0].c === 0, `هیچ پروژه‌ای کلید خارجی یتیم ندارد (${orphans.rows[0].c} ردیف)`, `count=${orphans.rows[0].c}`);

    await client.query("BEGIN");
    let validated = true;
    let detail = "";
    try {
      // Validating takes a SHARE UPDATE EXCLUSIVE lock only; running it inside a
      // transaction that we roll back proves the statement is safe on this data
      // without leaving any change behind on a shared database.
      await client.query("ALTER TABLE projects VALIDATE CONSTRAINT projects_owner_user_users_id_fk");
    } catch (error) {
      validated = false;
      detail = error instanceof Error ? error.message : String(error);
    } finally {
      await client.query("ROLLBACK");
    }
    check(validated, "VALIDATE CONSTRAINT روی داده فعلی موفق است (هیچ یتیمی وجود ندارد)", detail);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  console.log("▶ بررسی یکپارچگی پایگاه داده روی PostgreSQL واقعی");
  const version = new Client({ connectionString: URL });
  await version.connect();
  const row = await version.query<{ version: string }>("SELECT version()");
  console.log(`  سرور: ${row.rows[0].version.split(" on ")[0]}`);
  await version.end();

  await concurrency();
  await constraints();
  await validateConstraint();

  console.log(
    failures === 0
      ? `\n✔ ${checks} بررسی یکپارچگی/هم‌زمانی — همه موفق`
      : `\n✘ ${failures} خطا از ${checks} بررسی یکپارچگی`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
