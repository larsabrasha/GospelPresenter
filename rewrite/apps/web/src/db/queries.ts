import {
  DEFAULT_THEME_SETTING,
  LOAD_BIBLE_TEXT_SQL,
  REMOTE_CONTROL_SETTING,
  remoteControlPolicy,
  resolveTheme,
  type Bible,
  type BibleBookText,
  type Display,
  type LibraryAudio,
  type Label,
  type LibraryImage,
  type Overlay,
  type Presentation,
  type PresentationItem,
  type RemoteControlPolicy,
  type SearchableSong,
  type Song,
  type SongArrangement,
  type SongPart,
  type Theme,
} from '@gp/core';
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
  themeId: (r.theme_id as string | null) ?? null,
  isTemplate: Boolean(r.is_template),
  weekday: (r.weekday as number | null) ?? null,
  time: (r.time as string | null) ?? null,
  location: (r.location as string | null) ?? null,
  lastUsedAt: (r.last_used_at as number | null) ?? null,
});

const item = (r: Row): PresentationItem => ({
  id: String(r.id),
  presentationId: String(r.presentation_id),
  type: r.type === 'bible' || r.type === 'image' || r.type === 'audio' || r.type === 'slides' ? r.type : 'song',
  title: String(r.title),
  sourceId: String(r.source_id),
  sort: Number(r.sort),
  arrangementId: (r.arrangement_id as string | null) ?? null,
  content: (r.content as string | null) ?? null,
  overlayId: (r.overlay_id as string | null) ?? null,
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

/** The presentations and templates (not in the trash) that have an item showing the song (D17). */
export async function presentationsUsing(db: ReadDb, songId: string): Promise<Presentation[]> {
  const rows = await db.query(
    `SELECT DISTINCT p.* FROM presentations p JOIN presentation_items i ON i.presentation_id = p.id
     WHERE i.type = 'song' AND i.source_id = ? AND p.deleted_at IS NULL ORDER BY p.name`,
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
    'SELECT * FROM presentations WHERE deleted_at IS NULL AND is_template = 0 ORDER BY event_date IS NULL, event_date DESC, name',
  );
  return rows.map(presentation);
}

/** The templates page's list (spec 03 screen 3), by name: a template has no "last changed" here. */
export async function listTemplates(db: ReadDb): Promise<Presentation[]> {
  return (await db.query('SELECT * FROM presentations WHERE deleted_at IS NULL AND is_template = 1')).map(presentation).toSorted(byPresentationName);
}

/** The templates the "Skapa presentation" picker offers (PRES-R32): the 10 last used, never-used ones last (03 Q7), then by name. */
export async function recentTemplates(db: ReadDb): Promise<Presentation[]> {
  return (await listTemplates(db)).toSorted((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1)).slice(0, 10);
}

const byPresentationName = (a: Presentation, b: Presentation) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

export async function getPresentation(db: ReadDb, id: string): Promise<Presentation | null> {
  const [r] = await db.query('SELECT * FROM presentations WHERE id = ?', [id]);
  return r ? presentation(r) : null;
}

export interface TrashEntry {
  kind: 'Presentation' | 'Template' | 'Song' | 'Image' | 'Audio';
  id: string;
  name: string;
  /** The event date of a presentation, the author of a song. */
  detail: string | null;
  /** A template's, for its weekday, time and place. */
  template?: Presentation;
  deletedAt: number;
}

/** What is in the trash, newest deletion first (spec 03 section 5). */
export async function listTrash(db: ReadDb): Promise<TrashEntry[]> {
  const songs = (await db.query('SELECT * FROM songs WHERE deleted_at IS NOT NULL')).map(song);
  const presentations = (await db.query('SELECT * FROM presentations WHERE deleted_at IS NOT NULL')).map(presentation);
  const trashedImages = (await db.query('SELECT * FROM images WHERE deleted_at IS NOT NULL')).map(libraryImage);
  const trashedAudios = (await db.query('SELECT * FROM audios WHERE deleted_at IS NOT NULL')).map(libraryAudio);
  const entries: TrashEntry[] = [
    ...trashedImages.map((i) => ({ kind: 'Image' as const, id: i.id, name: i.fileName, detail: null, deletedAt: i.deletedAt! })),
    ...trashedAudios.map((a) => ({ kind: 'Audio' as const, id: a.id, name: a.fileName, detail: null, deletedAt: a.deletedAt! })),
    ...presentations.map((p) =>
      p.isTemplate
        ? { kind: 'Template' as const, id: p.id, name: p.name, detail: null, template: p, deletedAt: p.deletedAt! }
        : { kind: 'Presentation' as const, id: p.id, name: p.name, detail: p.eventDate, deletedAt: p.deletedAt! },
    ),
    ...songs.map((s) => ({ kind: 'Song' as const, id: s.id, name: s.name, detail: s.author, deletedAt: s.deletedAt! })),
  ];
  return entries.toSorted((a, b) => b.deletedAt - a.deletedAt || a.id.localeCompare(b.id));
}

export async function itemsOf(db: ReadDb, presentationId: string): Promise<PresentationItem[]> {
  return (await db.query('SELECT * FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', [presentationId])).map(item);
}

// ------------------------------------------------------------------ Bibles and themes

const bible = (r: Row): Bible => ({
  id: String(r.id),
  name: String(r.name),
  abbreviation: String(r.abbreviation),
  language: (r.language as string | null) ?? null,
  verseCount: Number(r.verse_count),
  contentHash: String(r.content_hash),
});

export interface InstalledBible extends Bible {
  /** Its text is on this device, so it can be searched offline. */
  stored: boolean;
  /** This device has chosen to keep its text ("Tillgänglig offline"). A desktop host keeps every text regardless. */
  kept: boolean;
}

/** The organisation's translations, by name (BIBLE-R8). */
export async function listBibles(db: ReadDb): Promise<InstalledBible[]> {
  const rows = await db.query(
    'SELECT b.*, EXISTS (SELECT 1 FROM bible_blobs t WHERE t.hash = b.content_hash) AS stored, EXISTS (SELECT 1 FROM kept_bibles k WHERE k.id = b.id) AS kept FROM bibles b',
  );
  return rows
    .map((r) => ({ ...bible(r), stored: Boolean(r.stored), kept: Boolean(r.kept) }))
    .toSorted((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** Parsed texts, by hash: a text never changes, so it is read and parsed once per window. */
const texts = new Map<string, Promise<BibleBookText[] | null>>();

/**
 * A translation's books, or null while this device does not have the text.
 * `fetch` gets a text the device does not keep from the server, unstored
 * (`Db.fetchBibleText`); it is then held in this window only.
 */
export function bibleBooks(db: ReadDb, hash: string, fetch?: (hash: string) => Promise<BibleBookText[] | null>): Promise<BibleBookText[] | null> {
  let p = texts.get(hash);
  if (!p) {
    p = (async () => {
      const rows = await db.query<{ code: string; chunk: string }>(LOAD_BIBLE_TEXT_SQL, [hash]);
      if (!rows.length) return fetch ? fetch(hash) : null;
      return rows.map((r) => ({ code: r.code, verses: JSON.parse(r.chunk) as BibleBookText['verses'] }));
    })();
    texts.set(hash, p);
    // Not there yet: ask again next time rather than remember the absence.
    void p.then((books) => books ?? texts.delete(hash), () => texts.delete(hash));
  }
  return p;
}

export async function orgDefaultThemeId(db: ReadDb): Promise<string | null> {
  const [r] = await db.query<{ value: string }>('SELECT value FROM org_settings WHERE id = ?', [DEFAULT_THEME_SETTING]);
  return r?.value ?? null;
}

/** The organisation's remote control policy; no row is the presenter's choice. */
export async function orgRemoteControl(db: ReadDb): Promise<RemoteControlPolicy> {
  const [r] = await db.query<{ value: string }>('SELECT value FROM org_settings WHERE id = ?', [REMOTE_CONTROL_SETTING]);
  return remoteControlPolicy(r?.value);
}

/** The theme a presentation shows: its own, else the organisation's default, else Classic (THEME-R1). */
export async function themeOf(db: ReadDb, p: Pick<Presentation, 'themeId'> | null): Promise<Theme> {
  return resolveTheme(p?.themeId, await orgDefaultThemeId(db));
}

// ------------------------------------------------------------------ images

const libraryImage = (r: Row): LibraryImage => ({
  id: String(r.id),
  fileName: String(r.file_name),
  contentType: r.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
  fullHash: String(r.full_hash),
  thumbHash: String(r.thumb_hash),
  width: Number(r.width),
  height: Number(r.height),
  createdAt: Number(r.created_at),
  deletedAt: (r.deleted_at as number | null) ?? null,
});

/** The library, newest first, without the trash (MEDIA-R7). */
export async function listImages(db: ReadDb): Promise<LibraryImage[]> {
  return (await db.query('SELECT * FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC, id')).map(libraryImage);
}

/** An image by id, trashed or not: a trashed picture still shows in the presentations that use it (MEDIA-R8). */
export async function getImage(db: ReadDb, id: string): Promise<LibraryImage | null> {
  const [r] = await db.query('SELECT * FROM images WHERE id = ?', [id]);
  return r ? libraryImage(r) : null;
}

/** Object URLs of blobs, by hash: a blob never changes, so one URL per window serves every use of it. */
const blobUrls = new Map<string, string>();

/**
 * A blob from this device's own copy as an object URL, or null while this
 * device does not have it yet (the next database change asks again). Works in
 * the output window too, which reads through the operator window.
 */
export async function blobUrl(db: ReadDb, hash: string): Promise<string | null> {
  const known = blobUrls.get(hash);
  if (known) return known;
  const [r] = await db.query<{ content_type: string; bytes: Uint8Array | null }>('SELECT content_type, bytes FROM media_blobs WHERE hash = ? AND bytes IS NOT NULL', [hash]);
  if (!r?.bytes) return null;
  const url = blobUrls.get(hash) ?? URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.content_type }));
  blobUrls.set(hash, url);
  return url;
}

// ------------------------------------------------------------------ outputs

/** The organisation's outputs, by name (spec 04 §7). */
export async function listDisplays(db: ReadDb): Promise<Display[]> {
  const rows = await db.query<{ id: string; name: string; code: string; kind: string }>('SELECT id, name, code, kind FROM displays');
  return rows
    .map((r) => ({ id: r.id, name: r.name, code: r.code, kind: r.kind === 'screen' ? ('screen' as const) : ('public' as const) }))
    .toSorted((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ audio

const libraryAudio = (r: Row): LibraryAudio => ({
  id: String(r.id),
  fileName: String(r.file_name),
  contentType: String(r.content_type),
  hash: String(r.hash),
  size: Number(r.size),
  createdAt: Number(r.created_at),
  deletedAt: (r.deleted_at as number | null) ?? null,
});

/** The audio files, newest first, without the trash (MEDIA-R7). */
export async function listAudios(db: ReadDb): Promise<LibraryAudio[]> {
  return (await db.query('SELECT * FROM audios WHERE deleted_at IS NULL ORDER BY created_at DESC, id')).map(libraryAudio);
}

/** An audio file by id, trashed or not: a trashed file still plays where it is used (MEDIA-R8). */
export async function getAudio(db: ReadDb, id: string): Promise<LibraryAudio | null> {
  const [r] = await db.query('SELECT * FROM audios WHERE id = ?', [id]);
  return r ? libraryAudio(r) : null;
}

/** Whether this device keeps the presentation's files whatever its date ("Tillgänglig offline"). */
export async function isPinned(db: ReadDb, presentationId: string): Promise<boolean> {
  return (await db.query('SELECT 1 FROM pinned_presentations WHERE id = ?', [presentationId])).length > 0;
}

/** The presentations kept offline on this device. */
export async function pinnedIds(db: ReadDb): Promise<Set<string>> {
  return new Set((await db.query<{ id: string }>('SELECT id FROM pinned_presentations')).map((r) => r.id));
}

// ------------------------------------------------------------------ overlays

const overlay = (r: Row): Overlay => ({
  id: String(r.id),
  title: String(r.title),
  content: (r.content as string | null) ?? null,
  imageId: (r.image_id as string | null) ?? null,
  sort: Number(r.sort),
});

/** The organisation's overlays, in the order they were made (PRES-R18). */
export async function listOverlays(db: ReadDb): Promise<Overlay[]> {
  return (await db.query('SELECT * FROM overlays ORDER BY sort, id')).map(overlay);
}

export async function getOverlay(db: ReadDb, id: string): Promise<Overlay | null> {
  const [r] = await db.query('SELECT * FROM overlays WHERE id = ?', [id]);
  return r ? overlay(r) : null;
}

/** What an overlay shows: its text, and its picture's `full` blob. A purged picture is left out. */
export interface ShownOverlay {
  content: string | null;
  imageHash: string | null;
}

export async function shownOverlay(db: ReadDb, id: string | null): Promise<ShownOverlay | null> {
  if (!id) return null;
  const [r] = await db.query<{ content: string | null; full_hash: string | null }>(
    'SELECT o.content, i.full_hash FROM overlays o LEFT JOIN images i ON i.id = o.image_id WHERE o.id = ?',
    [id],
  );
  return r ? { content: r.content, imageHash: r.full_hash } : null;
}
