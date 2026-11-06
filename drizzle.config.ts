import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle configuration — environment driven.
 *
 * The previous JSON config hard-coded a local connection string, which would
 * silently target the wrong database when running migrations elsewhere.
 * Migrations are always run explicitly and manually (never during the Netlify
 * site build), so the production connection string is supplied at the command
 * line or through the environment.
 *
 *   DATABASE_URL="postgres://…" npx drizzle-kit push
 */
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "[drizzle] DATABASE_URL is not set. Provide it explicitly (locally via .env, in production on the command line) — no default connection is embedded in source.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url,
    ssl: process.env.DATABASE_SSL === "require" || /sslmode\s*=\s*require/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
  },
  strict: true,
  verbose: true,
});
