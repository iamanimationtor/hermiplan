-- ---------------------------------------------------------------------------
-- HERMIPLAN — 0004 project history (revisions) and optimistic concurrency
--
-- Why
--   Until now every accepted save overwrote the previous state in place: a
--   mistaken edit, an accidental delete of a phase, or two open tabs silently
--   overwriting each other were unrecoverable. This migration adds
--
--     • `projects.version`      — a monotonically increasing revision number,
--                                 used as the optimistic-concurrency token;
--     • `project_versions`      — an immutable snapshot of (input, report
--                                 options) for each accepted revision.
--
-- Data safety
--   • Purely additive: no table, column or row is dropped or rewritten.
--   • Existing projects start at version 1 with **no** back-filled snapshot.
--     Their history begins with the first save after this release; storing a
--     copy of every existing project would multiply the data volume without
--     anyone asking for it.
--   • Snapshots are children of the project (ON DELETE CASCADE): deleting a
--     project still deletes everything it owns.
--
-- Rollback: drizzle/0004_project_versions.rollback.sql (drops the history and
-- the version column; project data itself is untouched).
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "project_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "reason" text NOT NULL,
  "input" jsonb NOT NULL,
  "report_options" jsonb,
  "checksum" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "activities" integer NOT NULL DEFAULT 0,
  "actor_kind" text NOT NULL DEFAULT 'owner',
  "actor_user" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_versions_project_version_unique" UNIQUE ("project_id", "version")
);

CREATE INDEX IF NOT EXISTS "project_versions_project_created_idx"
  ON "project_versions" ("project_id", "created_at" DESC);

COMMIT;
