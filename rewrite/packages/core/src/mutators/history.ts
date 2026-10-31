import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { labels, songArrangements, songParts, songs, songVersions } from '../schema.ts';
import { parsePartIds } from '../slides.ts';
import { id, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { ensureLabel } from './labels.ts';

// Song history (spec 02 SONG-R20–R23 as decided in D9 and on 2026-10-31). Before the server runs a
// change to a song, it keeps the song as it was: the whole song, so a restore brings back its fields,
// its parts with their ids and its arrangements, which then still name those parts. Changes by one
// person within 30 minutes of the song's newest version make no new one; a change by someone else
// does, so an edit from a device that was offline never hides another's text (SONG-R24). Clients do
// not write versions: they come with the sync.

/** At most this many versions per song; the oldest go (SONG-R21). */
export const SONG_VERSION_LIMIT = 50;

/** A person's changes within this long of the newest version add none (SONG-R20). */
export const SONG_VERSION_WINDOW_MS = 30 * 60 * 1000;

const snapshotSchema = z.object({
  name: z.string(),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  year: z.number().nullable(),
  ccli: z.string().nullable(),
  parts: z.array(z.object({ id: z.string(), labelId: z.string().nullable(), labelText: z.string().nullable(), labelColor: z.string().nullable(), content: z.string() })),
  arrangements: z.array(z.object({ id: z.string(), name: z.string().nullable(), partIds: z.array(z.string()) })),
});

/** What a version keeps: the song's fields, its parts in order with their labels, and its arrangements in order. */
export type SongSnapshot = z.infer<typeof snapshotSchema>;

export function parseSongSnapshot(data: string): SongSnapshot {
  return snapshotSchema.parse(JSON.parse(data));
}

/** The song as it is where this runs, or null if it is gone. Keys in a fixed order, so equal songs give equal JSON. */
async function snapshotOf(tx: Tx, songId: string): Promise<SongSnapshot | null> {
  const [s] = await tx.select().from(songs).where(eq(songs.id, songId));
  if (!s) return null;
  const parts = await tx
    .select({ id: songParts.id, labelId: songParts.labelId, labelText: labels.text, labelColor: labels.color, content: songParts.content })
    .from(songParts)
    .leftJoin(labels, eq(labels.id, songParts.labelId))
    .where(eq(songParts.songId, songId))
    .orderBy(asc(songParts.sort), asc(songParts.id));
  const arrangements = await tx.select().from(songArrangements).where(eq(songArrangements.songId, songId)).orderBy(asc(songArrangements.sort), asc(songArrangements.id));
  return {
    name: s.name,
    author: s.author,
    publisher: s.publisher,
    year: s.year,
    ccli: s.ccli,
    parts: parts.map((p) => ({ id: p.id, labelId: p.labelId, labelText: p.labelText ?? null, labelColor: p.labelColor ?? null, content: p.content })),
    arrangements: arrangements.map((a) => ({ id: a.id, name: a.name, partIds: parsePartIds(a.partIds) })),
  };
}

/**
 * Keeps the song as it is now, before a change to it: on the server only (`ctx.now`). None is kept of a
 * song with no parts, nor when the newest version is the same song, or, unless `always`, when the same person made it under
 * SONG_VERSION_WINDOW_MS ago. A restore and an import's replacement always keep one.
 */
export async function keepSongVersion(tx: Tx, songId: string, ctx: MutatorCtx, always = false) {
  if (ctx.now === undefined) return;
  const now = ctx.now;
  const snapshot = await snapshotOf(tx, songId);
  // A song with no parts yet is a new one being written: nothing in it to go back to.
  if (!snapshot?.parts.length) return;
  const data = JSON.stringify(snapshot);
  const [newest] = await tx
    .select({ userId: songVersions.userId, createdAt: songVersions.createdAt, data: songVersions.data })
    .from(songVersions)
    .where(eq(songVersions.songId, songId))
    .orderBy(desc(songVersions.createdAt), desc(songVersions.id))
    .limit(1);
  if (newest?.data === data) return;
  if (newest && !always && newest.userId === ctx.userId && now - newest.createdAt < SONG_VERSION_WINDOW_MS) return;
  let versionId = `${songId}@${now}`;
  for (let n = 2; (await tx.select({ id: songVersions.id }).from(songVersions).where(eq(songVersions.id, versionId))).length; n++) versionId = `${songId}@${now}:${n}`;
  await tx.insert(songVersions).values({ id: versionId, songId, userId: ctx.userId, createdAt: now, name: snapshot.name, data });
  const kept = await tx
    .select({ id: songVersions.id })
    .from(songVersions)
    .where(eq(songVersions.songId, songId))
    .orderBy(desc(songVersions.createdAt), desc(songVersions.id));
  for (const v of kept.slice(SONG_VERSION_LIMIT)) await tx.delete(songVersions).where(eq(songVersions.id, v.id));
}

/** `keepSongVersion` for a change that names a part. */
export async function keepVersionOfPart(tx: Tx, partId: string, ctx: MutatorCtx) {
  if (ctx.now === undefined) return;
  const [p] = await tx.select({ songId: songParts.songId }).from(songParts).where(eq(songParts.id, partId));
  if (p) await keepSongVersion(tx, p.songId, ctx);
}

/** `keepSongVersion` for a change that names an arrangement. */
export async function keepVersionOfArrangement(tx: Tx, arrangementId: string, ctx: MutatorCtx) {
  if (ctx.now === undefined) return;
  const [a] = await tx.select({ songId: songArrangements.songId }).from(songArrangements).where(eq(songArrangements.id, arrangementId));
  if (a) await keepSongVersion(tx, a.songId, ctx);
}

/** A part's label on restore: the label it had if that is still there (renamed or not), else one with its text. */
async function labelFor(tx: Tx, part: SongSnapshot['parts'][number]): Promise<string | null> {
  if (part.labelId) {
    const [l] = await tx.select({ id: labels.id }).from(labels).where(eq(labels.id, part.labelId));
    if (l) return l.id;
  }
  return ensureLabel(tx, part.labelText);
}

export const restoreSongVersionArgs = z.object({ songId: id, versionId: z.string().min(1).max(200) });
/**
 * "Återställ version" (SONG-R22 as decided in D9): keeps the song as it is now, then gives it the version's
 * fields, parts (with their ids, so presentations and arrangements find them) and arrangements. Parts and
 * arrangements the version does not have are deleted; items that chose such an arrangement fall back to all
 * parts (SONG-R18).
 */
export async function restoreSongVersion(tx: Tx, a: z.output<typeof restoreSongVersionArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const [v] = await tx
    .select({ data: songVersions.data })
    .from(songVersions)
    .where(and(eq(songVersions.id, a.versionId), eq(songVersions.songId, a.songId)));
  if (!v) throw new MutationError('not-found', 'version not found');
  const [s] = await tx.select({ id: songs.id }).from(songs).where(eq(songs.id, a.songId));
  if (!s) throw new MutationError('not-found', 'song not found');
  await keepSongVersion(tx, a.songId, ctx, true);
  const snap = parseSongSnapshot(v.data);
  await tx.update(songs).set({ name: snap.name, author: snap.author, publisher: snap.publisher, year: snap.year, ccli: snap.ccli }).where(eq(songs.id, a.songId));

  const partIds = snap.parts.map((p) => p.id);
  const arrangementIds = snap.arrangements.map((x) => x.id);
  await tx.delete(songArrangements).where(and(eq(songArrangements.songId, a.songId), notInArray(songArrangements.id, arrangementIds)));
  await tx.delete(songParts).where(and(eq(songParts.songId, a.songId), notInArray(songParts.id, partIds)));
  for (const [sort, p] of snap.parts.entries()) {
    const labelId = await labelFor(tx, p);
    await tx
      .insert(songParts)
      .values({ id: p.id, songId: a.songId, sort, labelId, content: p.content })
      .onConflictDoUpdate({ target: songParts.id, set: { songId: a.songId, sort, labelId, content: p.content } });
  }
  const own = new Set(partIds);
  for (const [sort, x] of snap.arrangements.entries()) {
    const ids = JSON.stringify(x.partIds.filter((p) => own.has(p)));
    await tx
      .insert(songArrangements)
      .values({ id: x.id, songId: a.songId, name: x.name, partIds: ids, sort })
      .onConflictDoUpdate({ target: songArrangements.id, set: { songId: a.songId, name: x.name, partIds: ids, sort } });
  }
}
