/**
 * Pure share-token primitives (no database, no framework).
 *
 * Kept separate from `share-token.ts` so the security test suite can exercise
 * the token format, entropy and hashing without a database connection.
 */
import { createHash, randomBytes } from "node:crypto";

/** 256 bits of entropy — guessing one is not a practical attack. */
export const SHARE_TOKEN_BYTES = 32;

/** A base64url encoding of 32 bytes is exactly 43 characters. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
