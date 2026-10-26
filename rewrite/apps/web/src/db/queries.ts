import type { Label, Presentation, PresentationItem, SearchableSong, Song, SongArrangement, SongPart } from '@gp/core';
import type { ReadDb } from './share.ts';

// Reads from the local database, mapped to the core row types. The column
// names are SQLite's (snake_case); the core types are Drizzle's (camelCase).

type Row = Record<string, unknown>;

const song = (r: Row): Song => ({
  id: String(r.id),
  name: String(r.name),
  author: (r.author as string | null) ?? null,
  publisher: (r.publisher as string | null) ?? null,
  year: (r.year as number | null) ?? null,
  ccli: (r.ccli as string | null) ?? null,
  deletedAt: (r.deleted_at as number | null) ?? null,
});

const part = (r: Row): SongPart => ({
  id: String(r.id),
  songId: String(r.song_id),
  sort: Number(r.sort),
  labelId: (r.label_id as string | null) ?? null,
  content: String(r.content),
});

const presentation = (r: Row): Presentation => ({
  id: String(r.id),
  name: String(r.name),
  eventDate: (r.event_date as string | null) ?? null,
  deletedAt: (r.deleted_at as number | null) ?? null,
});

const item = (r: Row): PresentationItem => ({
  id: String(r.id),
  presentationId: String(r.presentation_id),
  type: 'song',
  title: String(r.title),
  sourceId: String(r.source_id),
  sort: Number(r.sort),
  arrangementId: (r.arrangement_id as string | null) ?? null,
});

const arrangement = (r: Row): SongArrangement => ({
  id: String(r.id),
  songId: String(r.song_id),
  name: (r.name as string | null) ?? null,
  partIds: String(r.part_ids),
  sort: Number(r.sort),
});

const label = (r: Row): Label => ({ id: String(r.id), text: String(r.text), color: String(r.color), sort: Number(r.sort) });

const byName = (a: Song, b: Song) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' });

/** The library, by name, without the trash (spec 02: culture-aware, case-insensitive). */
export async function listSongs(db: ReadDb): Promise<Song[]> {
  return (await db.query('SELECT * FROM songs WHERE deleted_at IS NULL')).map(song).toSorted(byName);
}

export type LibrarySong = Song & SearchableSong;

/** The library with each song's lyrics, for search (SONG-R31: name, author and lyrics). */
export async function searchableSongs(db: ReadDb): Promise<LibrarySong[]> {
  const parts = await db.query<{ song_id: string; content: string }>(
    'SELECT p.song_id, p.content FROM song_parts p JOIN songs s ON s.id = p.song_id WHERE s.deleted_at IS NULL ORDER BY p.song_id, p.sort, p.id',
  );
  const lyrics = new Map<string, string[]>();
  for (const p of parts) (lyrics.get(p.song_id) ?? lyrics.set(p.song_id, []).get(p.song_id)!).push(p.content);
  return (await listSongs(db)).map((s) => ({ ...s, firstPart: lyrics.get(s.id)?.[0] ?? '', lyrics: (lyrics.get(s.id) ?? []).join('\n') }));
}

/** A song's arrangements, in order: the first is the default (SONG-R19). */
export async function arrangementsOf(db: ReadDb, songIds: string[]): Promise<SongArrangement[]> {
  if (!songIds.length) return [];
  const rows = await db.query(`SELECT * FROM song_arrangements WHERE song_id IN (${songIds.map(() => '?').join(', ')}) ORDER BY sort, id`, songIds);
  return rows.map(arrangement);
}

/** The presentations (not in the trash) that have an item showing the song (D17). */
export async function presentationsUsing(db: ReadDb, songId: string): Promise<Presentation[]> {
  const rows = await db.query(
    `SELECT DISTINCT p.* FROM presentations p JOIN presentation_items i ON i.presentation_id = p.id
     WHERE i.source_id = ? AND p.deleted_at IS NULL ORDER BY p.name`,
    [songId],
  );
  return rows.map(presentation);
}

export async function getSong(db: ReadDb, id: string): Promise<Song | null> {
  const [r] = await db.query('SELECT * FROM songs WHERE id = ?', [id]);
  return r ? song(r) : null;
}

export async function songPartsOf(db: ReadDb, songIds: string[]): Promise<SongPart[]> {
  if (!songIds.length) return [];
  const rows = await db.query(`SELECT * FROM song_parts WHERE song_id IN (${songIds.map(() => '?').join(', ')}) ORDER BY sort, id`, songIds);
  return rows.map(part);
}

export async function songsById(db: ReadDb, ids: string[]): Promise<Map<string, Song>> {
  if (!ids.length) return new Map();
  const rows = await db.query(`SELECT * FROM songs WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  return new Map(rows.map(song).map((s) => [s.id, s]));
}

export async function listLabels(db: ReadDb): Promise<Map<string, Label>> {
  return new Map((await db.query('SELECT * FROM labels ORDER BY sort, text')).map(label).map((l) => [l.id, l]));
}

/** Presentations, newest event first; those without a date last (milestone 1 has no "last changed"). */
export async function listPresentations(db: ReadDb): Promise<Presentation[]> {
  const rows = await db.query(
    'SELECT * FROM presentations WHERE deleted_at IS NULL ORDER BY event_date IS NULL, event_date DESC, name',
  );
  return rows.map(presentation);
}

export async function getPresentation(db: ReadDb, id: string): Promise<Presentation | null> {
  const [r] = await db.query('SELECT * FROM presentations WHERE id = ?', [id]);
  return r ? presentation(r) : null;
}

export interface TrashEntry {
  kind: 'Presentation' | 'Song';
  id: string;
  name: string;
  /** The event date of a presentation, the author of a song. */
  detail: string | null;
  deletedAt: number;
}

/** What is in the trash, newest deletion first (spec 03 section 5). */
export async function listTrash(db: ReadDb): Promise<TrashEntry[]> {
  const songs = (await db.query('SELECT * FROM songs WHERE deleted_at IS NOT NULL')).map(song);
  const presentations = (await db.query('SELECT * FROM presentations WHERE deleted_at IS NOT NULL')).map(presentation);
  const entries: TrashEntry[] = [
    ...presentations.map((p) => ({ kind: 'Presentation' as const, id: p.id, name: p.name, detail: p.eventDate, deletedAt: p.deletedAt! })),
    ...songs.map((s) => ({ kind: 'Song' as const, id: s.id, name: s.name, detail: s.author, deletedAt: s.deletedAt! })),
  ];
  return entries.toSorted((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
}

export async function itemsOf(db: ReadDb, presentationId: string): Promise<PresentationItem[]> {
  return (await db.query('SELECT * FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', [presentationId])).map(item);
}
