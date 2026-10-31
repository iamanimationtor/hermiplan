-- ---------------------------------------------------------------------------
-- HERMIPLAN — rollback for 0004_project_versions
--
-- Removes the revision history (snapshots are copies, the live project row keeps
-- its current data) and the optimistic-concurrency column.
--
-- Deploy the previous application version first: the current one reads
-- `projects.version` on every write and would fail without it.
-- ---------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS "project_versions_project_created_idx";
DROP TABLE IF EXISTS "project_versions";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "version";

-- Keep the ledger honest: `db:migrate` must re-apply 0004 after this rollback.
DELETE FROM "_hermiplan_migrations" WHERE "version" = '0004_project_versions';

COMMIT;
