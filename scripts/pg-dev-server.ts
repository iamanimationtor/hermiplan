/**
 * Local **real** PostgreSQL server for integration tests (development only).
 *
 * Why this exists
 * ---------------
 * The project previously ran its integration tests against PGlite speaking the
 * PostgreSQL wire protocol. That is useful, but it is not a PostgreSQL server:
 * locking, concurrency, planner behaviour and `ALTER TABLE ... VALIDATE
 * CONSTRAINT` differ. This helper starts an actual PostgreSQL binary (shipped by
 * the `embedded-postgres` dev dependency) on a throwaway data directory so the
 * migration, integration and concurrency checks can be executed against a real
 * server on any machine or CI runner, without root and without Docker.
 *
 * It is a **development tool**: nothing in `src/` imports it, it is a
 * devDependency, and it never runs against a hosted database.
 *
 * Usage
 * -----
 *   npx tsx scripts/pg-dev-server.ts            # port 5544, data dir /tmp/…
 *   PGPORT=5600 PGDATA_DIR=/tmp/pgdata-real npx tsx scripts/pg-dev-server.ts
 *
 * The process stays in the foreground until SIGINT/SIGTERM so a test runner can
 * use it like `sleep infinity`.
 */
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.PGPORT ?? 5544);
const databaseDir = process.env.PGDATA_DIR ?? `/tmp/hermiplan-real-pg`;
const user = process.env.PGUSER ?? "postgres";
const password = process.env.PGPASSWORD ?? "postgres";

async function main() {
  const server = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent: true,
  });

  // `initialise` is idempotent in practice only for an empty directory; the
  // helper therefore tolerates "already initialised" and proceeds.
  try {
    await server.initialise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exists|not empty|directory/i.test(message)) throw error;
  }

  await server.start();

  const shutdown = async () => {
    try {
      await server.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // The URL is printed for humans; test runners read it from the environment.
  console.log(`postgresql://${user}:${password}@127.0.0.1:${port}/postgres`);
  console.log(`[pg-dev-server] real PostgreSQL listening on 127.0.0.1:${port} (data: ${databaseDir})`);
}

void main();
