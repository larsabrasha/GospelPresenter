import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { and, count, eq, getTableName, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { can, type Permission } from '../permissions.ts';
import { audios, customSlides, images, mediaBlobs, overlays, presentationItems, songArrangements, themes, videos } from '../schema.ts';
import { FIELD_RULES, MutationError, type MutatorCtx } from '../mutation.ts';

/**
 * The transaction a mutator runs in. It is a plain Drizzle SQLite database:
 * better-sqlite3, node:sqlite and DO SQLite (sync drivers) on the server,
 * wa-sqlite through sqlite-proxy (async driver) on the client. Every Drizzle
 * query is awaitable on both, so one async mutator body serves all of them.
 * The caller makes the run atomic (see the adapters' `transaction`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = BaseSQLiteDatabase<'sync' | 'async', any, any>;

export { MutationError, LIMITS, type MutatorCtx } from '../mutation.ts';

export function requirePermission(ctx: MutatorCtx, permission: Permission) {
  if (!can(ctx.role, permission)) throw new MutationError('forbidden', `${ctx.role} may not ${permission}`);
}

// Mutators must be deterministic: ids and timestamps arrive as arguments, and
// they read only through `tx`. Each one sets only the fields it names, so two
// edits to different fields both land (ADR 0007, decision 2). Upserts
// (onConflictDoUpdate, onConflictDoNothing) are fine; replacing a row is not,
// as the client's undo triggers never see the row it deletes (sync-sql.ts).
// `pnpm lint` refuses one in any file of this folder (scripts/check-mutator-sql.mjs).

export function limit(reached: boolean, what: string) {
  if (reached) throw new MutationError('limit', `the maximum number of ${what} has been reached`);
}

/** Every blob of `hashes` known where this runs (a page's pictures, a theme's), else `media-missing`. */
export async function requireBlobs(tx: Tx, hashes: string[]) {
  for (const hash of new Set(hashes)) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a picture has not been uploaded');
  }
}

export const id = z.string().min(1).max(100);
/** Trimmed and non-blank, as the UI requires (spec 02, 03). */
export const name = z.string().trim().min(1).max(FIELD_RULES.name.max);
/** Optional text: blank is stored as null. */
export const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((s) => (s === '' ? null : s))
    .nullable();

// ------------------------------------------------------------------ rules of 2.0 beyond the first TS core

/** The rows written whole whose fields keep a time each (schema 27, `FIELD_TIMES`). */
type FieldTimed = typeof customSlides | typeof overlays | typeof themes;

/**
 * A change of a row whose every field keeps its own time (`{field}_at`, schema 27): the newest change of a field wins,
 * by the clocks of the devices that made them, not the last to reach the server (SYNC-R23, docs/assumptions.md).
 * Refused as `newer-change` when a field it changes was changed after `at`, so an edit made offline yesterday does not
 * undo one made online this morning; fields it does not change are another's to change. Else each field is written
 * with `at` as its time, and `updated_at` only moves forward. A row gone changes nothing. `fields` are the columns'
 * SQL names (`name`, `pages`, `title`, `content`, `definition`).
 */
export async function updateFields(tx: Tx, table: FieldTimed, rowId: string, fields: Record<string, string>, at: number) {
  const names = Object.keys(fields);
  // One table at a time: Drizzle types a call per table, not per union of them.
  const t = table as typeof customSlides;
  const tableName = getTableName(t);
  if (names.length) {
    const [row] = (await tx.all(sql`SELECT ${sql.raw(names.map((f) => `${f}_at`).join(', '))} FROM ${sql.identifier(tableName)} WHERE id = ${rowId}`)) as unknown[];
    const times = row === undefined ? [] : Array.isArray(row) ? row : Object.values(row as object);
    if (times.some((x) => x !== null && x !== undefined && Number(x) > at)) throw new MutationError('newer-change', 'a newer change of this was made');
  }
  const set = [sql`updated_at = CASE WHEN updated_at > ${at} THEN updated_at ELSE ${at} END`, ...names.map((f) => sql`${sql.raw(f)} = ${fields[f]}, ${sql.raw(`${f}_at`)} = ${at}`)];
  await tx.run(sql`UPDATE ${sql.identifier(tableName)} SET ${sql.join(set, sql`, `)} WHERE id = ${rowId}`);
}

/**
 * A renamed thing of the library (a slideshow, a picture, a sound, a video): the items of `kind` it is, in
 * presentations and templates, take its new name, as a renamed song's do (Lars, 2026-11-17). An item of several
 * pictures has a name of its own (its pictures in `content`) and keeps it; a thing gone renames nothing.
 */
export async function renameItems(tx: Tx, table: typeof customSlides | typeof images | typeof audios | typeof videos, kind: 'custom' | 'image' | 'audio' | 'video', sourceId: string, newName: string) {
  const t = table as typeof images;
  const [found] = await tx.select({ id: t.id }).from(t).where(eq(t.id, sourceId));
  if (!found) return;
  await tx
    .update(presentationItems)
    .set({ title: newName })
    .where(and(eq(presentationItems.type, kind), eq(presentationItems.sourceId, sourceId), isNull(presentationItems.content), ne(presentationItems.title, newName)));
}

/**
 * What an item names for Original, a song's parts in their own order (Lars, 2026-11-19): no arrangement of its own, so
 * it never falls out of date when a part is added, and an id no arrangement has, which every reader takes as all the
 * parts in order (SONG-R18).
 */
export const ORIGINAL_ARRANGEMENT = 'original';

/** Whether no arrangement has the id yet: an insert of it makes a new one. */
export async function isNewArrangement(tx: Tx, arrangementId: string): Promise<boolean> {
  const [found] = await tx.select({ id: songArrangements.id }).from(songArrangements).where(eq(songArrangements.id, arrangementId));
  return !found;
}

/**
 * A new arrangement written for `songId`: when it is the song's only one, the song's items that named none showed its
 * parts in their order until now, and go on showing them, as Original (Lars, 2026-11-19), instead of all taking the new
 * arrangement as the song's first (SONG-R19, SONG-R58).
 */
export async function keepOriginal(tx: Tx, songId: string) {
  const [n] = await tx.select({ n: count() }).from(songArrangements).where(eq(songArrangements.songId, songId));
  if ((n?.n ?? 0) !== 1) return;
  await tx
    .update(presentationItems)
    .set({ arrangementId: ORIGINAL_ARRANGEMENT })
    .where(and(eq(presentationItems.type, 'song'), eq(presentationItems.sourceId, songId), isNull(presentationItems.arrangementId)));
}
