import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import type { ReportOptions } from "@/lib/validation";

/**
 * Projects.
 *
 * `isPublic` defaults to **false**: a project is private until its owner
 * explicitly publishes it. The report route treats the project UUID as an
 * identifier only — it is never an authorisation token on its own.
 *
 * `shareExpiresAt` bounds a public share link in time; the owner can revoke the
 * link at any moment by flipping `isPublic` back to false.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user"),
    guestToken: text("guest_token"),
    name: text("name").notNull(),
    projectType: text("project_type").notNull().default("general"),
    isPublic: boolean("is_public").notNull().default(false),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
    input: jsonb("input").$type<ProjectInput>().notNull(),
    analysis: jsonb("analysis").$type<ProjectAnalysis>(),
    reportOptions: jsonb("report_options").$type<ReportOptions>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_guest_token_idx").on(table.guestToken),
    index("projects_owner_idx").on(table.ownerUserId),
    index("projects_updated_idx").on(table.updatedAt),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/**
 * `code_hash` stores a SHA-256 digest — the plain code never touches the
 * database. `attempts` is an integer so that brute-force counters can be
 * incremented atomically in SQL.
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("otp_phone_idx").on(table.phone),
    index("otp_phone_created_idx").on(table.phone, table.createdAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expires_idx").on(table.expiresAt)],
);

export const projectEvents = pgTable(
  "project_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("project_events_project_idx").on(table.projectId),
    index("project_events_project_kind_idx").on(table.projectId, table.kind),
  ],
);

/**
 * Report share tokens.
 *
 * A share link carries a 256-bit random token; only its SHA-256 digest lives
 * here, so the database alone cannot be turned into working links. Tokens are
 * revocable (`revoked_at`) and optionally expiring (`expires_at`), and every
 * lifecycle step is mirrored into `project_events` for audit.
 */
export const projectShareTokens = pgTable(
  "project_share_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** hex SHA-256 of the 256-bit token — the plaintext is shown once, never stored */
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("project_share_tokens_hash_idx").on(table.tokenHash),
    index("project_share_tokens_project_idx").on(table.projectId),
  ],
);

/**
 * Distributed rate-limit windows. One row per limiter key; the counter is
 * incremented by a single atomic upsert (see `lib/server/rate-limit.ts`).
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
    hits: integer("hits").notNull().default(0),
  },
  (table) => [index("rate_limits_window_idx").on(table.windowStart)],
);

/**
 * Schema revision understood by this code base. Bumped whenever a migration is
 * required; the health endpoint exposes it for deployment verification.
 */
export const SCHEMA_VERSION = 3;
export const schemaVersion = sql`3`;
