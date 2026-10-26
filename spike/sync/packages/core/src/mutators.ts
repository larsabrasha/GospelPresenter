import { asc, eq, max } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { can, type Action, type Role } from './permissions.ts';
import { labels, presentationItems, presentations, songLabels, songs } from './schema.ts';

/**
 * The transaction a mutator runs in. It is a plain Drizzle SQLite database:
 * better-sqlite3 and DO SQLite (sync drivers) on the server, wa-sqlite through
 * sqlite-proxy (async driver) on the client. Every Drizzle query is awaitable on
 * both, so one async mutator body serves all of them. The caller makes the
 * run atomic (see the adapters' `transaction`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = BaseSQLiteDatabase<'sync' | 'async', any, any>;

export interface MutatorCtx {
  userId: string;
  role: Role;
}

/** Thrown for an expected refusal; the server records `code` and moves on. */
export class MutationError extends Error {
  constructor(public code: string, message = code) {
    super(message);
  }
}

function require_(ctx: MutatorCtx, action: Action) {
  if (!can(ctx.role, action)) throw new MutationError('forbidden', `${ctx.role} may not ${action}`);
}

// Mutators must be deterministic: ids and timestamps arrive as arguments, and
// they read only through `tx`.

async function createSong(tx: Tx, a: { id: string; title: string }, ctx: MutatorCtx) {
  require_(ctx, 'songs.edit');
  await tx.insert(songs).values(a).onConflictDoNothing();
}

async function createPresentation(tx: Tx, a: { id: string; name: string }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  await tx.insert(presentations).values({ id: a.id, name: a.name }).onConflictDoNothing();
}

async function renamePresentation(tx: Tx, a: { id: string; name: string }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  await tx.update(presentations).set({ name: a.name }).where(eq(presentations.id, a.id));
}

async function addSongToPresentation(
  tx: Tx,
  a: { itemId: string; presentationId: string; songId: string },
  ctx: MutatorCtx,
) {
  require_(ctx, 'presentations.edit');
  const [p] = await tx.select().from(presentations).where(eq(presentations.id, a.presentationId));
  if (!p) throw new MutationError('not-found', 'presentation not found');
  const [s] = await tx.select({ id: songs.id }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  const [top] = await tx
    .select({ last: max(presentationItems.sort) })
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, a.presentationId));
  const last = top?.last ?? null;
  await tx
    .insert(presentationItems)
    .values({ id: a.itemId, presentationId: a.presentationId, songId: a.songId, sort: (last ?? -1) + 1 })
    .onConflictDoNothing();
}

/** Puts the named items first, in the given order; other items keep their order after them. */
async function reorderItems(tx: Tx, a: { presentationId: string; itemIds: string[] }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  const current = await tx
    .select({ id: presentationItems.id })
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, a.presentationId))
    .orderBy(asc(presentationItems.sort), asc(presentationItems.id));
  const existing = new Set(current.map((r) => r.id));
  const named = a.itemIds.filter((id) => existing.has(id));
  const rest = current.map((r) => r.id).filter((id) => !named.includes(id));
  const order = [...named, ...rest];
  for (let i = 0; i < order.length; i++) {
    await tx.update(presentationItems).set({ sort: i }).where(eq(presentationItems.id, order[i]!));
  }
}

/** Deletes exactly the named item; a no-op if it is already gone. */
async function deleteItem(tx: Tx, a: { itemId: string }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  await tx.delete(presentationItems).where(eq(presentationItems.id, a.itemId));
}

async function trashPresentation(tx: Tx, a: { id: string; at: number }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  await tx.update(presentations).set({ deletedAt: a.at }).where(eq(presentations.id, a.id));
}

async function restorePresentation(tx: Tx, a: { id: string }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.edit');
  await tx.update(presentations).set({ deletedAt: null }).where(eq(presentations.id, a.id));
}

/** Permanent delete (D14): only of a presentation that is in the trash where this runs. */
async function purgePresentation(tx: Tx, a: { id: string }, ctx: MutatorCtx) {
  require_(ctx, 'presentations.purge');
  const [p] = await tx.select().from(presentations).where(eq(presentations.id, a.id));
  if (!p) return; // already gone: nothing to do
  if (p.deletedAt === null) throw new MutationError('not-in-trash', 'presentation is not in the trash');
  await tx.delete(presentationItems).where(eq(presentationItems.presentationId, a.id));
  await tx.delete(presentations).where(eq(presentations.id, a.id));
}

export function labelId(text: string): string {
  return 'label:' + text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Labels a song, creating the label if needed. The id comes from the text, so duplicates converge. */
async function labelSong(tx: Tx, a: { songId: string; text: string }, ctx: MutatorCtx) {
  require_(ctx, 'songs.edit');
  const id = labelId(a.text);
  await tx.insert(labels).values({ id, name: a.text.trim() }).onConflictDoNothing();
  await tx
    .insert(songLabels)
    .values({ id: `${a.songId}|${id}`, songId: a.songId, labelId: id })
    .onConflictDoNothing();
}

/**
 * Spike only: writes, awaits more reads, then throws. Proves that a mutator's
 * earlier writes are rolled back on every database.
 */
async function spikeWriteThenThrow(tx: Tx, a: { songId: string }, ctx: MutatorCtx) {
  require_(ctx, 'songs.edit');
  await tx.insert(songs).values({ id: a.songId, title: 'should never be seen' });
  await tx.select().from(songs).where(eq(songs.id, a.songId));
  await tx.update(songs).set({ title: 'still never seen' }).where(eq(songs.id, a.songId));
  throw new MutationError('spike-failure', 'thrown after writing');
}

/** Every mutator with its current version. `minV` is the oldest version the server still accepts. */
export const mutators = {
  createSong: { v: 1, minV: 1, run: createSong },
  createPresentation: { v: 1, minV: 1, run: createPresentation },
  renamePresentation: { v: 1, minV: 1, run: renamePresentation },
  addSongToPresentation: { v: 1, minV: 1, run: addSongToPresentation },
  reorderItems: { v: 1, minV: 1, run: reorderItems },
  deleteItem: { v: 1, minV: 1, run: deleteItem },
  trashPresentation: { v: 1, minV: 1, run: trashPresentation },
  restorePresentation: { v: 1, minV: 1, run: restorePresentation },
  purgePresentation: { v: 1, minV: 1, run: purgePresentation },
  labelSong: { v: 1, minV: 1, run: labelSong },
  spikeWriteThenThrow: { v: 1, minV: 1, run: spikeWriteThenThrow },
} as const;

export type Mutators = typeof mutators;
export type MutatorName = keyof Mutators;
export type MutatorArgs<N extends MutatorName> = Parameters<Mutators[N]['run']>[1];

export function getMutator(name: string) {
  return Object.hasOwn(mutators, name) ? mutators[name as MutatorName] : undefined;
}
