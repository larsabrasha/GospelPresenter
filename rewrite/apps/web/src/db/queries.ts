import type { Label, Presentation, PresentationItem, Song, SongPart } from '@gp/core';
import type { Db } from './db.ts';

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
});

const label = (r: Row): Label => ({ id: String(r.id), text: String(r.text), color: String(r.color), sort: Number(r.sort) });

/** The library, by name, without the trash (spec 02: culture-aware, case-insensitive). */
export async function listSongs(db: Db): Promise<Song[]> {
  const rows = (await db.query('SELECT * FROM songs WHERE deleted_at IS NULL')).map(song);
  return rows.toSorted((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }));
}

export async function getSong(db: Db, id: string): Promise<Song | null> {
  const [r] = await db.query('SELECT * FROM songs WHERE id = ?', [id]);
  return r ? song(r) : null;
}

export async function songPartsOf(db: Db, songIds: string[]): Promise<SongPart[]> {
  if (!songIds.length) return [];
  const rows = await db.query(`SELECT * FROM song_parts WHERE song_id IN (${songIds.map(() => '?').join(', ')}) ORDER BY sort, id`, songIds);
  return rows.map(part);
}

export async function songsById(db: Db, ids: string[]): Promise<Map<string, Song>> {
  if (!ids.length) return new Map();
  const rows = await db.query(`SELECT * FROM songs WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  return new Map(rows.map(song).map((s) => [s.id, s]));
}

export async function listLabels(db: Db): Promise<Map<string, Label>> {
  return new Map((await db.query('SELECT * FROM labels ORDER BY sort, text')).map(label).map((l) => [l.id, l]));
}

/** Presentations, newest event first; those without a date last (milestone 1 has no "last changed"). */
export async function listPresentations(db: Db): Promise<Presentation[]> {
  const rows = await db.query(
    'SELECT * FROM presentations WHERE deleted_at IS NULL ORDER BY event_date IS NULL, event_date DESC, name',
  );
  return rows.map(presentation);
}

export async function getPresentation(db: Db, id: string): Promise<Presentation | null> {
  const [r] = await db.query('SELECT * FROM presentations WHERE id = ?', [id]);
  return r ? presentation(r) : null;
}

export async function itemsOf(db: Db, presentationId: string): Promise<PresentationItem[]> {
  return (await db.query('SELECT * FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', [presentationId])).map(item);
}
