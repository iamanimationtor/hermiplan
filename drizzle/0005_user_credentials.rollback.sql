-- ---------------------------------------------------------------------------
-- HERMIPLAN — rollback for 0005_user_credentials
--
-- Removes password credentials and makes the phone number mandatory again —
-- exactly the state 0004 left behind.
--
-- Deploy the previous application version first: it signs in with the OTP flow
-- and does not read these columns.
--
-- Guard: restoring NOT NULL fails while password-only accounts exist. That is
-- intentional — deleting accounts is a data-loss decision, so it must be taken
-- explicitly (delete or assign a phone number first), not silently by a script.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_identity_present";
DROP INDEX IF EXISTS "users_username_unique";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" WHERE "phone" IS NULL
  ) THEN
    RAISE EXCEPTION
      'rollback 0005 aborted: % account(s) have no phone number — delete them or set a phone before rolling back',
      (SELECT count(*) FROM "users" WHERE "phone" IS NULL);
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;

ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "username";

-- Keep the ledger honest: `db:migrate` must re-apply 0005 after this rollback.
DELETE FROM "_hermiplan_migrations" WHERE "version" = '0005_user_credentials';

COMMIT;
