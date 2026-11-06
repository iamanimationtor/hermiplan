-- 0003_share_tokens — unguessable, revocable, expiring report share links.
--
-- Why: the report route must never treat "you know the project UUID" as
-- authorisation. A share link now carries a 256-bit random token; only its
-- SHA-256 digest is stored, so a database dump cannot be replayed as links.
--
-- Safe by construction: additive only. No existing row is modified, no column is
-- dropped, and dropping the table (see the rollback file) restores exactly the
-- previous behaviour.

CREATE TABLE IF NOT EXISTS "project_share_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- hex SHA-256 of the token; the plaintext token is shown once, at creation
  "token_hash" text NOT NULL,
  "label" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "use_count" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_share_tokens_hash_idx"
  ON "project_share_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "project_share_tokens_project_idx"
  ON "project_share_tokens" ("project_id");

-- Audit trail for link lifecycle. `project_events` already cascades on delete.
COMMENT ON TABLE "project_share_tokens" IS
  'Hashed share tokens for printable report links (256-bit CSPRNG, revocable).';
