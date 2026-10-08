import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Database access for HERMIPLAN.
 *
 * Deployment notes (Netlify / serverless):
 *  • The pool is created lazily on first use, never at import time. During
 *    `next build` Netlify imports route modules to collect page data; throwing
 *    or connecting there breaks the build when DATABASE_URL is not present.
 *  • Pool size is deliberately small: every serverless instance is its own
 *    process with its own pool, so `max` multiplies across concurrent
 *    invocations. Use a pooled connection string (Supabase pooler, Neon
 *    pooled endpoint) or lower DATABASE_POOL_MAX if you hit provider limits.
 *  • TLS is enabled for hosted providers that require it.
 */

const globalForDb = globalThis as typeof globalThis & {
  __hermiplanDb?: NodePgDatabase;
  __hermiplanPool?: Pool;
};

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in the Netlify UI (Site configuration → Environment variables) and redeploy.",
    );
  }
  return url;
}

function createPool(): Pool {
  const connectionString = requireDatabaseUrl();

  const isProduction = process.env.NODE_ENV === "production";
  const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  const maxConnections = Number.isFinite(poolMax)
    ? poolMax
    : isProduction
      ? 3
      : 10;

  // Hosted providers (Neon, Supabase, RDS, …) reject plaintext connections.
  const requiresSsl =
    process.env.DATABASE_SSL === "require" || /sslmode\s*=\s*require|ssl\s*=\s*true/i.test(connectionString);

  const pool = new Pool({
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
  });

  // A serverless container can be frozen between requests; never let a broken
  // idle connection surface as an application error.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  return pool;
}

/** Explicit accessor for code that prefers it over the `db` proxy. */
export function getDb(): NodePgDatabase {
  if (!globalForDb.__hermiplanDb) {
    globalForDb.__hermiplanPool = createPool();
    globalForDb.__hermiplanDb = drizzle(globalForDb.__hermiplanPool);
  }
  return globalForDb.__hermiplanDb;
}

/**
 * Lazy proxy: keeps the ergonomic `db.select()…` call sites while deferring
 * connection setup (and any missing-configuration error) to request time.
 */
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, property) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

export function getPool(): Pool {
  getDb();
  return globalForDb.__hermiplanPool as Pool;
}

/** true when a database is configured; used to degrade gracefully at build time */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
