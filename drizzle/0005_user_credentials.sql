-- ---------------------------------------------------------------------------
-- HERMIPLAN — 0005 username + password credentials
--
-- Why
--   Signing in required an SMS one-time code, which needs a paid provider and a
--   working mobile line for every user. Accounts now authenticate with a
--   username and a password; the phone number becomes optional.
--
-- What changes
--   • `users.username`      — chosen by the person, unique **case-insensitively**
--                             (the index is on `lower(username)`), 3–32 chars.
--   • `users.password_hash` — scrypt digest with its parameters and per-user
--                             salt. The plaintext password is never stored,
--                             logged or returned.
--   • `users.phone`         — becomes nullable: an account may exist without a
--                             phone number (password-only sign-up).
--
-- Data safety
--   • Additive: no table, column or row is dropped, and every existing phone
--     account keeps working (its rows have `username = null`).
--   • `users_phone_key` (the old UNIQUE constraint) stays; PostgreSQL allows
--     many NULLs in a unique column, so password-only rows do not collide.
--   • The partial unique index keeps usernames unique among real usernames only.
--
-- Rollback: drizzle/0005_user_credentials.rollback.sql — restores NOT NULL on
-- `phone`, therefore it refuses to run while password-only accounts exist.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;

-- Case-insensitive uniqueness without the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique"
  ON "users" (lower("username")) WHERE "username" IS NOT NULL;

-- An account must have at least one way to sign in.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_identity_present";
ALTER TABLE "users" ADD CONSTRAINT "users_identity_present"
  CHECK ("phone" IS NOT NULL OR "username" IS NOT NULL);

COMMENT ON COLUMN "users"."password_hash" IS
  'scrypt$N$r$p$salt$hash — parameters and salt travel with the digest.';

COMMIT;
