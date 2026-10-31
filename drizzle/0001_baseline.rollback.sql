-- ---------------------------------------------------------------------------
-- HERMIPLAN — rollback for 0001_baseline
--
-- This is the **most destructive** file in the repository: it removes the four
-- tables that hold every project, every user, every session and every audit
-- entry. There is no "restore" inside it. Use it only when
--   • the database was created by a failed deployment and has no real data, or
--   • you have a verified backup taken *after* the last write, and
--   • 0003 and 0002 have already been rolled back (their objects reference
--     these tables).
--
-- Because a wrong keystroke here is unrecoverable, the file refuses to run
-- until you create the confirmation table below in the same database:
--
--     CREATE TABLE "_hermiplan_rollback_baseline_ok" ();
--
-- Dropping the confirmation table afterwards returns the database to a state
-- in which this file can never run by accident.
--
-- Rollback order: 0003 → 0002 → 0001.
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."_hermiplan_rollback_baseline_ok"') IS NULL THEN
    RAISE EXCEPTION
      'Refusing to drop the HERMIPLAN baseline: create table "_hermiplan_rollback_baseline_ok" () to confirm.';
  END IF;
END
$$;

-- Objects added by later migrations are dropped first so this file also works
-- on a database where only some rollbacks were executed.
DROP INDEX IF EXISTS "project_share_tokens_project_idx";
DROP INDEX IF EXISTS "project_share_tokens_hash_idx";
DROP TABLE IF EXISTS "project_share_tokens";

DROP INDEX IF EXISTS "project_events_project_kind_idx";
DROP INDEX IF EXISTS "otp_phone_created_idx";
DROP INDEX IF EXISTS "sessions_expires_idx";
DROP INDEX IF EXISTS "sessions_user_idx";
DROP INDEX IF EXISTS "projects_updated_idx";
DROP INDEX IF EXISTS "projects_owner_idx";
DROP INDEX IF EXISTS "rate_limits_window_idx";
DROP TABLE IF EXISTS "rate_limits";

-- Baseline tables, children before parents (the FKs cascade, the explicit
-- order keeps the intent readable in logs).
DROP INDEX IF EXISTS "project_events_project_idx";
DROP TABLE IF EXISTS "project_events";

DROP TABLE IF EXISTS "sessions";

DROP INDEX IF EXISTS "otp_phone_idx";
DROP TABLE IF EXISTS "otp_codes";

-- `projects.owner_user` references `users`, so projects goes first.
DROP INDEX IF EXISTS "projects_guest_token_idx";
DROP TABLE IF EXISTS "projects";

DROP TABLE IF EXISTS "users";

DROP TABLE IF EXISTS "_hermiplan_rollback_baseline_ok";

-- Keep the ledger honest: with the tables gone, the migrations are no longer
-- applied and `db:migrate` must rebuild everything from 0001.
DELETE FROM "_hermiplan_migrations";

COMMIT;
