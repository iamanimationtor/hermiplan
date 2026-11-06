-- ---------------------------------------------------------------------------
-- HERMIPLAN — 0002 security hardening, data integrity and distributed limits
--
-- Data-safety notes
--  • No table, column or row is dropped.
--  • `otp_codes.attempts` is converted from text to integer **in place**, so
--    brute-force counters survive the migration (values are parsed, non numeric
--    values fall back to 0).
--  • Projects are never deleted; only their sharing flag can change.
--
-- Rollback: drizzle/0002_security_hardening.rollback.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. Private by default -----------------------------------------------------
--    Before this migration a row was created public unless the owner changed
--    it. The only evidence of a *deliberate* publication is an audit event the
--    owner triggered from the report toolbar (`kind = 'visibility'`,
--    payload.isPublic = true). Everything else is treated as "public by
--    accident" and becomes private. This is the fail-safe choice required for
--    personal project data.
UPDATE "projects" p
SET "is_public" = false
WHERE p."is_public" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "project_events" e
    WHERE e."project_id" = p."id"
      AND e."kind" = 'visibility'
      AND (e."payload" ->> 'isPublic') = 'true'
  );

ALTER TABLE "projects" ALTER COLUMN "is_public" SET DEFAULT false;

-- 2. Time-bounded sharing ---------------------------------------------------
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "share_expires_at" timestamp with time zone;

-- 3. OTP attempt counter: text → integer (values preserved) -----------------
ALTER TABLE "otp_codes"
  ALTER COLUMN "attempts" DROP DEFAULT;
ALTER TABLE "otp_codes"
  ALTER COLUMN "attempts" TYPE integer
  USING (CASE WHEN btrim("attempts") ~ '^[0-9]+$' THEN btrim("attempts")::integer ELSE 0 END);
ALTER TABLE "otp_codes" ALTER COLUMN "attempts" SET NOT NULL;
ALTER TABLE "otp_codes" ALTER COLUMN "attempts" SET DEFAULT 0;

-- 4. Distributed rate limiting ---------------------------------------------
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" text PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone DEFAULT now() NOT NULL,
  "hits" integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_limits_window_idx" ON "rate_limits" ("window_start");

-- 5. Indexes for the queries this release performs --------------------------
CREATE INDEX IF NOT EXISTS "projects_owner_idx" ON "projects" ("owner_user");
CREATE INDEX IF NOT EXISTS "projects_updated_idx" ON "projects" ("updated_at");
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "otp_phone_created_idx" ON "otp_codes" ("phone", "created_at");
CREATE INDEX IF NOT EXISTS "project_events_project_kind_idx" ON "project_events" ("project_id", "kind");

-- 6. Referential integrity for project ownership ---------------------------
--    Added as NOT VALID so a legacy orphan row cannot abort the migration;
--    new writes are still enforced, and VALIDATE can be run once the data is
--    confirmed clean (see DEPLOYMENT.md).
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_user_users_id_fk";
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_owner_user_users_id_fk"
  FOREIGN KEY ("owner_user") REFERENCES "users"("id") ON DELETE SET NULL
  NOT VALID;

COMMIT;
