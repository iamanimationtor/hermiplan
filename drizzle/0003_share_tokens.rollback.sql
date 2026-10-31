-- Rollback for 0003_share_tokens.
--
-- Dropping the table removes every share link; projects themselves, their data
-- and their `is_public` flag are untouched. After the rollback the report route
-- returns to owner-only access (documented in DEPLOYMENT.md → Rollback).

DROP INDEX IF EXISTS "project_share_tokens_project_idx";
DROP INDEX IF EXISTS "project_share_tokens_hash_idx";
DROP TABLE IF EXISTS "project_share_tokens";
