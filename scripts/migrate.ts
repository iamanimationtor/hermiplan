/**
 * HERMIPLAN — explicit, ordered SQL migrations.
 *
 *   npm run db:status            # show applied / pending migrations
 *   npm run db:migrate           # apply every pending migration
 *   npm run db:migrate -- --dry-run
 *
 * Why not `drizzle-kit push`? Push diffs the live schema and emits whatever DDL
 * it thinks is needed — including destructive statements — without a reviewable
 * artifact. This runner applies versioned files from `drizzle/`, records a
 * checksum for each one, and refuses to run when an already-applied file has
 * been edited (drift detection).
 *
 * Each migration file runs inside its own transaction. Files ending in
 * `.rollback.sql` are never applied automatically; they exist for manual,
 * reviewed rollbacks.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const DIR = join(process.cwd(), "drizzle");
const TABLE = "_hermiplan_migrations";

interface MigrationFile {
  version: string;
  path: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): MigrationFile[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))
    .sort()
    .map((file) => {
      const path = join(DIR, file);
      const sql = readFileSync(path, "utf8");
      return {
        version: file.replace(/\.sql$/, ""),
        path,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Export it explicitly before running migrations.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const statusOnly = process.argv.includes("--status");
  const migrations = loadMigrations();
  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "require" || /sslmode\s*=\s*require/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${TABLE}" (
        "version" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>();
    const rows = await client.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM "${TABLE}"`,
    );
    for (const row of rows.rows) applied.set(row.version, row.checksum);

    console.log(`Database: ${new URL(url).host}${new URL(url).pathname}`);
    let pending = 0;
    for (const migration of migrations) {
      const previous = applied.get(migration.version);
      if (previous && previous !== migration.checksum) {
        console.error(
          `\n✗ ${migration.version} was modified after being applied (checksum drift).\n` +
            "  Never edit an applied migration — add a new numbered file instead.",
        );
        process.exitCode = 1;
        return;
      }
      if (previous) {
        console.log(`  ✓ ${migration.version} (applied)`);
        continue;
      }
      pending += 1;
      console.log(`  → ${migration.version} (pending)`);
    }

    if (statusOnly) {
      console.log(pending === 0 ? "\nSchema is up to date." : `\n${pending} migration(s) pending.`);
      return;
    }
    if (pending === 0) {
      console.log("\nNothing to do — schema is up to date.");
      return;
    }
    if (dryRun) {
      console.log("\nDry run: no statement executed.");
      return;
    }

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      console.log(`\n▶ applying ${migration.version}`);
      // The migration files contain their own BEGIN/COMMIT. Running them through
      // `query` as a single batch keeps the file's semantics intact.
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO "${TABLE}" (version, checksum) VALUES ($1, $2)`,
        [migration.version, migration.checksum],
      );
      console.log(`  ✓ applied`);
    }
    console.log("\nAll migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
