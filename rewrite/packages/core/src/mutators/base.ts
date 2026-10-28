import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { can, type Permission, type Role } from '../permissions.ts';

/**
 * The transaction a mutator runs in. It is a plain Drizzle SQLite database:
 * better-sqlite3, node:sqlite and DO SQLite (sync drivers) on the server,
 * wa-sqlite through sqlite-proxy (async driver) on the client. Every Drizzle
 * query is awaitable on both, so one async mutator body serves all of them.
 * The caller makes the run atomic (see the adapters' `transaction`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = BaseSQLiteDatabase<'sync' | 'async', any, any>;

export interface MutatorCtx {
  userId: string;
  role: Role;
  /**
   * The server's clock when it runs a push; absent on clients. Only used to
   * keep a client's clock from purging the trash early (`purgeExpiredTrash`).
   */
  now?: number;
}

/** Thrown for an expected refusal; the server records `code` and moves on. */
export class MutationError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

export function requirePermission(ctx: MutatorCtx, permission: Permission) {
  if (!can(ctx.role, permission)) throw new MutationError('forbidden', `${ctx.role} may not ${permission}`);
}

// Mutators must be deterministic: ids and timestamps arrive as arguments, and
// they read only through `tx`. Each one sets only the fields it names, so two
// edits to different fields both land (ADR 0007, decision 2). Upserts
// (onConflictDoUpdate, onConflictDoNothing) are fine; replacing a row is not,
// as the client's undo triggers never see the row it deletes (sync-sql.ts).
// `pnpm lint` refuses one in any file of this folder (scripts/check-mutator-sql.mjs).

/** Limits of spec 02 and 03 (SONG-R7–R9, PRES-R10). Trashed rows do not count. */
export const LIMITS = { songs: 5000, partsPerSong: 50, arrangementsPerSong: 10, itemsPerPresentation: 100 } as const;

export function limit(reached: boolean, what: string) {
  if (reached) throw new MutationError('limit', `the maximum number of ${what} has been reached`);
}

export const id = z.string().min(1).max(100);
/** Trimmed and non-blank, as the UI requires (spec 02, 03). */
export const name = z.string().trim().min(1).max(200);
/** Optional text: blank is stored as null. */
export const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((s) => (s === '' ? null : s))
    .nullable();
