-- ---------------------------------------------------------------------------
-- HERMIPLAN — 0001 baseline schema
--
-- Reproduces the schema that earlier releases created with `drizzle-kit push`.
-- Every statement is idempotent, so applying this file to an existing database
-- is a no-op and applying it to an empty database produces the same structure.
--
-- Do not edit an applied migration: add a new numbered file instead.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user" uuid,
  "guest_token" text,
  "name" text NOT NULL,
  "project_type" text DEFAULT 'general' NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "input" jsonb NOT NULL,
  "analysis" jsonb,
  "report_options" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" text NOT NULL,
  "display_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_login_at" timestamp with time zone,
  CONSTRAINT "users_phone_unique" UNIQUE ("phone")
);

CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempts" text DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "project_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "projects_guest_token_idx" ON "projects" ("guest_token");
CREATE INDEX IF NOT EXISTS "otp_phone_idx" ON "otp_codes" ("phone");
CREATE INDEX IF NOT EXISTS "project_events_project_idx" ON "project_events" ("project_id");
