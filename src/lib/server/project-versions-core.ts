/**
 * Pure part of the project revision history.
 *
 * Kept free of database imports so the rules that decide *when* a snapshot is
 * created, *which* revisions survive pruning and *why* labels read the way they
 * do can be unit-tested without PostgreSQL.
 */
import { createHash } from "node:crypto";
import { ACCESS } from "@/lib/server/access-mode";
import type { ProjectInput } from "@/lib/engine/types";
import type { ReportOptions } from "@/lib/validation";

export type VersionReason = "create" | "autosave" | "restore" | "pre-restore";

const RAW_LIMIT = Number.parseInt(process.env.PROJECT_HISTORY_LIMIT ?? "", 10);
/** Newest revisions kept per project (3–100). */
export const HISTORY_LIMIT = Number.isFinite(RAW_LIMIT)
  ? Math.min(Math.max(RAW_LIMIT, 3), 100)
  : ACCESS.history.count;

const RAW_BYTES = Number.parseInt(process.env.PROJECT_HISTORY_BYTES ?? "", 10);
/** Upper bound for one project's history; the newest three are always kept. */
export const HISTORY_BYTES_LIMIT = Number.isFinite(RAW_BYTES)
  ? Math.max(RAW_BYTES, 512 * 1024)
  : ACCESS.history.bytes;

/** Never prune below this many revisions, whatever the byte budget says. */
export const KEEP_AT_LEAST = 3;

export function versionReasonLabel(reason: string): string {
  switch (reason) {
    case "create":
      return "ایجاد پروژه";
    case "autosave":
      return "ذخیره ویرایش";
    case "pre-restore":
      return "وضعیت پیش از بازگردانی";
    case "restore":
      return "بازگردانی‌شده";
    default:
      return "تغییر";
  }
}

/**
 * Deterministic JSON: object keys are sorted at every level, so two payloads
 * that differ only in key order produce the same checksum (and therefore no
 * spurious revision). Arrays keep their order — order is meaningful there.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 over the canonical form of the payload (input + report options). */
export function checksumOf(input: ProjectInput, reportOptions: ReportOptions | null | undefined): string {
  return createHash("sha256")
    .update(canonicalJson({ input, reportOptions: reportOptions ?? null }))
    .digest("hex");
}

export function byteSizeOf(input: ProjectInput, reportOptions: ReportOptions | null | undefined): number {
  return Buffer.byteLength(canonicalJson({ input, reportOptions: reportOptions ?? null }), "utf8");
}

/**
 * Decides which revisions to delete, given the stored revisions (newest first).
 *
 * Two budgets apply — a count and a byte size — but the newest
 * `KEEP_AT_LEAST` revisions always survive, so a project whose single snapshot
 * exceeds the byte budget still has something to restore.
 */
export function planPrune(
  revisions: readonly { version: number; sizeBytes: number }[],
  limit = HISTORY_LIMIT,
  byteLimit = HISTORY_BYTES_LIMIT,
): number[] {
  const doomed: number[] = [];
  const survivors: { version: number; sizeBytes: number }[] = [];
  revisions.forEach((revision, index) => {
    if (index < limit) survivors.push(revision);
    else doomed.push(revision.version);
  });

  let total = survivors.reduce((sum, revision) => sum + revision.sizeBytes, 0);
  for (let index = survivors.length - 1; index >= KEEP_AT_LEAST; index -= 1) {
    if (total <= byteLimit) break;
    total -= survivors[index].sizeBytes;
    doomed.push(survivors[index].version);
  }
  return doomed;
}
