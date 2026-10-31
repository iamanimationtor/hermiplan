/**
 * Recognising "the database has not been migrated".
 *
 * A deployment that forgets `npm run db:migrate` used to fail as an unhandled
 * 500 with an empty body — the person deploying had no way to tell a migration
 * problem from a bug. `/api/health` answers that question up front, and this
 * module lets the write routes answer it identically when they are hit first
 * (a stale page, a probe that skips health, a runbook step in the wrong order).
 *
 * Only the codes that PostgreSQL emits for *missing objects* are mapped. A
 * unique violation, a timeout or a logic error must keep its own handling, so
 * this is deliberately a narrow allow-list rather than `catch (e) { 503 }`.
 */

/** `42P01` undefined_table · `42703` undefined_column · `42P02` undefined_parameter · `3F000` invalid_schema_name */
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "42P02", "3F000"]);

/** One wording, shared by `/api/health` and every route, so the fix is obvious. */
export const MIGRATION_MESSAGE = "مهاجرت‌ها اعمال نشده‌اند؛ npm run db:migrate را اجرا کنید";

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
