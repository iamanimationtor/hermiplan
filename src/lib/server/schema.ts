/**
 * Recognising *deployment* failures, so they never surface as a bare 500.
 *
 * Two states are the operator's problem, not a bug in the request, and both
 * used to answer with an empty 500 body — which tells the person deploying
 * nothing at all:
 *
 *   1. **no database configured** — `DATABASE_URL` is missing (a Netlify
 *      environment variable that was never set),
 *   2. **database not migrated** — tables or columns the code needs are absent
 *      (`npm run db:migrate` was never run against that database).
 *
 * `/api/health` reports both up front, and this module lets every write route
 * answer identically when they are hit first (a stale page, a probe that skips
 * health, a runbook step out of order).
 *
 * The schema mapping is a narrow allow-list of the codes PostgreSQL emits for
 * *missing objects*. A unique violation, a timeout or a logic error must keep
 * its own handling, so this is deliberately not `catch (e) { 503 }`.
 */

/** `42P01` undefined_table · `42703` undefined_column · `42P02` undefined_parameter · `3F000` invalid_schema_name */
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "42P02", "3F000"]);

/** One wording per state, shared by `/api/health` and every route. */
export const MIGRATION_MESSAGE = "مهاجرت‌ها اعمال نشده‌اند؛ npm run db:migrate را اجرا کنید";
export const DATABASE_MISSING_MESSAGE =
  "پایگاه داده پیکربندی نشده است؛ متغیر DATABASE_URL را در محیط اجرا تنظیم کنید";

/** Reads `code` defensively: drizzle wraps driver errors, and the cause may be nested. */
export function isSchemaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && SCHEMA_ERROR_CODES.has(code)) return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      return false;
    }
  }
  return false;
}

/**
 * True when the failure is "there is no database to talk to".
 *
 * Matched by class name as well as by instance: the error crosses a module
 * boundary (thrown from `@/db`, caught in a route), and a duplicated copy of
 * the class after a hot reload must still be recognised.
 */
export function isDatabaseUnconfigured(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if ((current as { name?: unknown }).name === "DatabaseNotConfiguredError") return true;
      if ((current as { code?: unknown }).code === "database_unconfigured") return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      return false;
    }
  }
  return false;
}
