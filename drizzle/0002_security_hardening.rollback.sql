-- ---------------------------------------------------------------------------
-- HERMIPLAN — rollback for 0002_security_hardening
--
-- This restores the *schema* of the previous release. It deliberately does NOT
-- re-publish projects that were made private: silently restoring a
-- `is_public = true` default would expose personal project data, which is the
-- exact defect this migration removes. If you really need the legacy behaviour,
-- run the commented statement manually and accept the risk.
--
-- Rollback is only safe while no code depends on `rate_limits` or
-- `share_expires_at`; deploy the previous application version first.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_user_users_id_fk";

DROP INDEX IF EXISTS "project_events_project_kind_idx";
DROP INDEX IF EXISTS "otp_phone_created_idx";
DROP INDEX IF EXISTS "sessions_expires_idx";
DROP INDEX IF EXISTS "sessions_user_idx";
DROP INDEX IF EXISTS "projects_updated_idx";
DROP INDEX IF EXISTS "projects_owner_idx";

DROP TABLE IF EXISTS "rate_limits";

ALTER TABLE "otp_codes" ALTER COLUMN "attempts" DROP DEFAULT;
ALTER TABLE "otp_codes"
  ALTER COLUMN "attempts" TYPE text
  USING ("attempts"::text);
ALTER TABLE "otp_codes" ALTER COLUMN "attempts" SET DEFAULT '0';

ALTER TABLE "projects" DROP COLUMN IF EXISTS "share_expires_at";

ALTER TABLE "projects" ALTER COLUMN "is_public" SET DEFAULT true;

-- Optional and NOT executed automatically (re-exposes data):
-- UPDATE "projects" SET "is_public" = true;

COMMIT;
