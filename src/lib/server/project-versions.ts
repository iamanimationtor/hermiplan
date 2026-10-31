/**
 * Project revision history.
 *
 * Every accepted content change to a project is stored as an immutable snapshot
 * so that a wrong edit, a deleted phase or an accidental overwrite is
 * recoverable — the mission's "protect the data" rule taken seriously.
 *
 * Design decisions (all deliberate):
 *
 *  • **The live row stays the source of truth.** `projects.input` is what the
 *    application reads; snapshots are copies taken *after* a successful write.
 *    A failure to snapshot therefore never leaves the project half-written, and
 *    a project without history still works.
 *  • **Revision numbers are the concurrency token.** `projects.version`
 *    increments on every content change. A client that sends the version it
 *    edited from (`expectedVersion`) is rejected with 409 instead of silently
 *    overwriting a newer save from another tab or device. Content-identical
 *    saves do **not** burn a revision number.
 *  • **Restoring is a change like any other.** It first snapshots the state you
 *    are leaving (`pre-restore`), then writes the restored state as a new
 *    revision (`restore`). Nothing is ever deleted by a restore, so "restore"
 *    can itself be undone.
 *  • **Bounded storage.** Only the newest `PROJECT_HISTORY_LIMIT` revisions are
 *    kept (default 20, always at least the 3 newest) and the whole history is
 *    capped by bytes, because a snapshot is a full copy of the input.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectVersions, projects } from "@/db/schema";
import type { ProjectAnalysis, ProjectInput } from "@/lib/engine/types";
import type { ReportOptions } from "@/lib/validation";
import {
  byteSizeOf,
  checksumOf,
  HISTORY_BYTES_LIMIT,
  HISTORY_LIMIT,
  KEEP_AT_LEAST,
  planPrune,
  versionReasonLabel,
  type VersionReason,
} from "./project-versions-core";

export {
  byteSizeOf,
  checksumOf,
  HISTORY_BYTES_LIMIT,
  HISTORY_LIMIT,
  KEEP_AT_LEAST,
  planPrune,
  versionReasonLabel,
};
export type { VersionReason };

export interface VersionActor {
  kind: "owner" | "guest";
  userId: string | null;
}

export interface VersionSummary {
  version: number;
  reason: string;
  reasonLabel: string;
  createdAt: string;
  sizeBytes: number;
  activities: number;
  actorKind: string;
  isCurrent: boolean;
}

export interface RestoreResult {
  ok: boolean;
  version?: number;
  restoredFrom?: number;
  reason?: "not-found" | "conflict";
  currentVersion?: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the project row and returns its current revision.
 * `FOR UPDATE` serialises concurrent writers, so two saves can never compute the
 * same next revision (the unique constraint would abort one of them otherwise).
 */
async function lockProject(
  tx: Tx,
  projectId: string,
): Promise<{ version: number; input: ProjectInput; reportOptions: ReportOptions | null } | null> {
  const result = await tx.execute(
    sql`select version, input, report_options from projects where id = ${projectId} for update`,
  );
  const rows =
    (result as unknown as { rows?: { version: number; input: ProjectInput; report_options: ReportOptions | null }[] })
      .rows ?? [];
  const row = rows[0];
  return row ? { version: Number(row.version), input: row.input, reportOptions: row.report_options } : null;
}

/** Removes revisions beyond the count and byte budget (newest are kept). */
async function pruneHistory(tx: Tx, projectId: string): Promise<number> {
  const revisions = await tx
    .select({ version: projectVersions.version, sizeBytes: projectVersions.sizeBytes })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(desc(projectVersions.version));

  // The decision is a pure function (`planPrune`), so the retention rules are
  // unit-tested without a database.
  const doomed = planPrune(revisions);
  if (doomed.length === 0) return 0;

  await tx
    .delete(projectVersions)
    .where(and(eq(projectVersions.projectId, projectId), inArray(projectVersions.version, doomed)));
  return doomed.length;
}

interface SnapshotInput {
  projectId: string;
  version: number;
  reason: VersionReason;
  input: ProjectInput;
  reportOptions: ReportOptions | null;
  actor: VersionActor;
}

async function insertSnapshot(tx: Tx, snapshot: SnapshotInput): Promise<void> {
  await tx
    .insert(projectVersions)
    .values({
      projectId: snapshot.projectId,
      version: snapshot.version,
      reason: snapshot.reason,
      input: snapshot.input,
      reportOptions: snapshot.reportOptions,
      checksum: checksumOf(snapshot.input, snapshot.reportOptions),
      sizeBytes: byteSizeOf(snapshot.input, snapshot.reportOptions),
      activities: snapshot.input.activities?.length ?? 0,
      actorKind: snapshot.actor.kind,
      actorUser: snapshot.actor.userId,
    })
    // Idempotent under a retried request: the same revision is never duplicated.
    .onConflictDoNothing();
}

/** Records the initial snapshot of a freshly created project (revision 1). */
export async function recordProjectCreation(
  projectId: string,
  input: ProjectInput,
  reportOptions: ReportOptions | null,
  actor: VersionActor,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await insertSnapshot(tx, { projectId, version: 1, reason: "create", input, reportOptions, actor });
    });
  } catch (error) {
    // History must never break the primary operation.
    console.error("[versions] initial snapshot failed:", error);
  }
}

export type SaveOutcome =
  | { status: "saved"; version: number; unchanged: boolean }
  | { status: "conflict"; currentVersion: number }
  | { status: "missing" };

/**
 * Applies a content change atomically: bumps the revision, stores the snapshot
 * and prunes old history — all inside one transaction.
 *
 * `expectedVersion` implements optimistic concurrency: when it does not match
 * the stored revision the write is refused instead of overwriting newer work.
 */
export async function saveProjectRevision(options: {
  projectId: string;
  input: ProjectInput;
  reportOptions: ReportOptions | null;
  name: string;
  projectType: string;
  isPublic: boolean;
  shareExpiresAt: Date | null;
  /** Re-computed by the caller so the stored analysis is never stale. */
  analysis: ProjectAnalysis | null;
  expectedVersion?: number;
  actor: VersionActor;
}): Promise<SaveOutcome> {
  return db.transaction(async (tx) => {
    const locked = await lockProject(tx, options.projectId);
    if (!locked) return { status: "missing" } as SaveOutcome;

    if (options.expectedVersion !== undefined && options.expectedVersion !== locked.version) {
      return { status: "conflict", currentVersion: locked.version } as SaveOutcome;
    }

    const latest = await tx
      .select({ checksum: projectVersions.checksum, version: projectVersions.version })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, options.projectId))
      .orderBy(desc(projectVersions.version))
      .limit(1);

    // A project created before this feature shipped (or a creation whose snapshot
    // failed) has no history yet. Back-fill the *stored* state first, so the
    // edit about to happen stays undoable instead of silently becoming the
    // earliest revision.
    if (latest.length === 0) {
      await insertSnapshot(tx, {
        projectId: options.projectId,
        version: locked.version,
        reason: "create",
        input: locked.input,
        reportOptions: locked.reportOptions,
        actor: options.actor,
      });
      latest.push({ checksum: checksumOf(locked.input, locked.reportOptions), version: locked.version });
    }

    const checksum = checksumOf(options.input, options.reportOptions);
    const unchanged = latest[0]?.checksum === checksum && latest[0]?.version === locked.version;

    // Same content: persist nothing new, but still move `updatedAt` so the
    // listing order reflects the visit, and keep the revision number stable.
    if (unchanged) {
      await tx
        .update(projects)
        .set({
          updatedAt: new Date(),
          isPublic: options.isPublic,
          shareExpiresAt: options.shareExpiresAt,
          name: options.name,
          projectType: options.projectType,
          analysis: options.analysis,
        })
        .where(eq(projects.id, options.projectId));
      return { status: "saved", version: locked.version, unchanged: true } as SaveOutcome;
    }

    const nextVersion = locked.version + 1;
    const [updated] = await tx
      .update(projects)
      .set({
        input: options.input,
        analysis: options.analysis,
        reportOptions: options.reportOptions,
        name: options.name,
        projectType: options.projectType,
        isPublic: options.isPublic,
        shareExpiresAt: options.shareExpiresAt,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, options.projectId), eq(projects.version, locked.version)))
      .returning({ version: projects.version });

    if (!updated) return { status: "conflict", currentVersion: locked.version } as SaveOutcome;

    await insertSnapshot(tx, {
      projectId: options.projectId,
      version: nextVersion,
      reason: "autosave",
      input: options.input,
      reportOptions: options.reportOptions,
      actor: options.actor,
    });
    await pruneHistory(tx, options.projectId);

    return { status: "saved", version: nextVersion, unchanged: false } as SaveOutcome;
  });
}

export async function listProjectVersions(projectId: string, limit = HISTORY_LIMIT): Promise<VersionSummary[]> {
  // A caller cannot ask for more history than the retention policy keeps, and
  // an out-of-range value must never reach the database as-is.
  const take = Math.min(Math.max(Math.trunc(limit) || HISTORY_LIMIT, 1), HISTORY_LIMIT);
  const current = await db
    .select({ version: projects.version })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const currentVersion = current[0]?.version ?? 1;

  const rows = await db
    .select({
      version: projectVersions.version,
      reason: projectVersions.reason,
      createdAt: projectVersions.createdAt,
      sizeBytes: projectVersions.sizeBytes,
      activities: projectVersions.activities,
      actorKind: projectVersions.actorKind,
    })
    .from(projectVersions)
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(desc(projectVersions.version))
    .limit(take);

  return rows.map((row) => ({
    version: row.version,
    reason: row.reason,
    reasonLabel: versionReasonLabel(row.reason),
    createdAt: new Date(row.createdAt).toISOString(),
    sizeBytes: row.sizeBytes,
    activities: row.activities,
    actorKind: row.actorKind,
    isCurrent: row.version === currentVersion,
  }));
}

export interface VersionDetail {
  version: number;
  reason: string;
  input: ProjectInput;
  reportOptions: ReportOptions | null;
  createdAt: string;
}

export async function getProjectVersion(projectId: string, version: number): Promise<VersionDetail | null> {
  const rows = await db
    .select({
      version: projectVersions.version,
      reason: projectVersions.reason,
      input: projectVersions.input,
      reportOptions: projectVersions.reportOptions,
      createdAt: projectVersions.createdAt,
    })
    .from(projectVersions)
    .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.version, version)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    version: row.version,
    reason: row.reason,
    input: row.input,
    reportOptions: row.reportOptions ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Restores a past revision as the newest one.
 *
 * Both steps are in one transaction: snapshot what is being replaced
 * (`pre-restore`) and store the restored content as a new revision (`restore`).
 */
export async function restoreProjectVersion(options: {
  projectId: string;
  targetVersion: number;
  actor: VersionActor;
  expectedVersion?: number;
}): Promise<RestoreResult> {
  const target = await getProjectVersion(options.projectId, options.targetVersion);
  if (!target) return { ok: false, reason: "not-found" };

  return db.transaction(async (tx) => {
    const locked = await lockProject(tx, options.projectId);
    if (!locked) return { ok: false, reason: "not-found" } as RestoreResult;
    if (options.expectedVersion !== undefined && options.expectedVersion !== locked.version) {
      return { ok: false, reason: "conflict", currentVersion: locked.version } as RestoreResult;
    }

    const currentRows = await tx
      .select({
        input: projects.input,
        reportOptions: projects.reportOptions,
        name: projects.name,
        projectType: projects.projectType,
      })
      .from(projects)
      .where(eq(projects.id, options.projectId))
      .limit(1);
    const current = currentRows[0];
    if (!current) return { ok: false, reason: "not-found" } as RestoreResult;

    const preRestoreVersion = locked.version + 1;
    await insertSnapshot(tx, {
      projectId: options.projectId,
      version: preRestoreVersion,
      reason: "pre-restore",
      input: current.input,
      reportOptions: current.reportOptions ?? null,
      actor: options.actor,
    });

    const restoredVersion = preRestoreVersion + 1;
    await insertSnapshot(tx, {
      projectId: options.projectId,
      version: restoredVersion,
      reason: "restore",
      input: target.input,
      reportOptions: target.reportOptions,
      actor: options.actor,
    });

    await tx
      .update(projects)
      .set({
        input: target.input,
        reportOptions: target.reportOptions,
        name: target.input.meta.name,
        projectType: target.input.meta.type,
        version: restoredVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, options.projectId), eq(projects.version, locked.version)));

    await pruneHistory(tx, options.projectId);

    return { ok: true, version: restoredVersion, restoredFrom: target.version } as RestoreResult;
  });
}
