// The songs list and its search, and the song's pages (apps/web's Songs, SongEditor, SongArrangements, SongHistory,
// the song materials), as the web's reads gave them (ported back from crates/gp-core/src/song_views.rs and
// song_page.rs). The search (search.ts, SONG-R30–R33) runs over a library prepared once and kept until the shell
// prepares it again, as the web's worker kept it.
import { MutationError } from '../mutation.ts';
import { type PreparedSong, prepareSong, rankSongs } from '../search.ts';
import { marks, type RunSql } from './sql.ts';
import { ARRANGEMENT, columns, type Fields, LABEL, langOf, mapRow, PART, PRESENTATION, select, SONG, sortRows } from './lists-rows.ts';
import { argsOf, idOf, strOrEmpty } from './serde.ts';
import { themeOf } from './lists-settings.ts';

const VERSION: Fields = [['id', 'str'], ['songId', 'str'], ['userId', 'str'], ['createdAt', 'num'], ['name', 'str'], ['data', 'str']];
const MATERIAL: Fields = [['id', 'str'], ['songId', 'str'], ['kind', 'str'], ['title', 'str'], ['url', 'opt'], ['hash', 'opt'], ['contentType', 'opt'],
  ['size', 'optNum'], ['sort', 'num'], ['createdAt', 'num']];

/** `songsView` {locale}: the library without the trash, by name in the page's language; songs of one name in the table's order (`listSongs`). */
export async function songsView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  return sortRows(langOf(a), await select(sql, SONG, 'songs WHERE deleted_at IS NULL AND draft IS NULL'), [['name', 'name']]);
}

/** The library's lyrics (no trashed song, no draft): each song's parts' texts in order, by the song's id. */
export async function libraryLyrics(sql: RunSql): Promise<Map<string, string[]>> {
  const lyrics = new Map<string, string[]>();
  for (const [songId, content] of await sql('SELECT p.song_id, p.content FROM song_parts p JOIN songs s ON s.id = p.song_id WHERE s.deleted_at IS NULL AND s.draft IS NULL ORDER BY p.song_id, p.sort, p.id', [])) {
    const own = lyrics.get(strOrEmpty(songId)) ?? lyrics.set(strOrEmpty(songId), []).get(strOrEmpty(songId))!;
    own.push(strOrEmpty(content));
  }
  return lyrics;
}

/** The library as search reads it, in the shell's order: each song's id and prepared texts; null until prepared. */
let library: { ids: string[]; prepared: PreparedSong[] } | null = null;

/**
 * `songSearchPrepare` {order}: reads the library and prepares it for search, in `order` (the songs' ids as the shell
 * orders them; ties in a search keep it); how many songs it holds. A song not in `order` is not searched.
 */
export async function songSearchPrepare(args: unknown, sql: RunSql) {
  const order = argsOf(args).order;
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) throw new MutationError('invalid-args', 'order');
  const songs = new Map((await sql('SELECT id, name, author FROM songs WHERE deleted_at IS NULL AND draft IS NULL', [])).map((r) => [strOrEmpty(r[0]), [strOrEmpty(r[1]), strOrEmpty(r[2])]]));
  const lyrics = await libraryLyrics(sql);
  const next: NonNullable<typeof library> = { ids: [], prepared: [] };
  for (const id of order as string[]) {
    const song = songs.get(id);
    if (!song) continue;
    const own = lyrics.get(id) ?? [];
    next.prepared.push(prepareSong({ name: song[0]!, author: song[1]!, firstPart: own[0] ?? '', lyrics: own.join('\n') }));
    next.ids.push(id);
  }
  library = next;
  return next.ids.length;
}

/**
 * `songSearchView` {query}: the ids of the songs that match, best first, ties in the library's order; every song for a
 * blank query. Refused as `not-prepared` until the library is (a new instance of the core holds none).
 */
export async function songSearchView(args: unknown) {
  const query = argsOf(args).query;
  if (!library) throw new MutationError('not-prepared');
  const { ids, prepared } = library;
  return rankSongs(
    ids.map((_, i) => i),
    (i) => prepared[i]!,
    typeof query === 'string' ? query : '',
  ).map((i) => ids[i]);
}

// ------------------------------------------------------------------ the song's pages (song_page.rs)

/** `getSong`: a song by id, trashed or not; null when there is none. */
const song = async (sql: RunSql, id: string) => (await select(sql, SONG, 'songs WHERE id = ?', [id]))[0] ?? null;

/** `songView` {id}: the song (`getSong`), null when there is none. */
export const songView = async (args: unknown, sql: RunSql) => song(sql, idOf(argsOf(args), 'id'));

/** `songPageView` {id}: {song, parts, arrangements, labels}: the song's page and the pages pushed in from it. */
export async function songPageView(args: unknown, sql: RunSql) {
  const id = idOf(argsOf(args), 'id');
  return {
    song: await song(sql, id),
    parts: await select(sql, PART, 'song_parts WHERE song_id IN (?) ORDER BY sort, id', [id]),
    arrangements: await select(sql, ARRANGEMENT, 'song_arrangements WHERE song_id IN (?) ORDER BY sort, id', [id]),
    labels: await select(sql, LABEL, 'labels ORDER BY sort, text'),
  };
}

/** `songPresentationsView` {songId}: the presentations and templates, not in the trash, that show the song (D17). */
export async function songPresentationsView(args: unknown, sql: RunSql) {
  const id = idOf(argsOf(args), 'songId');
  const cols = columns(PRESENTATION).split(', ').map((c) => `p.${c}`).join(', ');
  const rows = await sql(`SELECT DISTINCT ${cols} FROM presentations p JOIN presentation_items i ON i.presentation_id = p.id
         WHERE i.type = 'song' AND i.source_id = ? AND p.deleted_at IS NULL ORDER BY p.name`, [id]);
  return rows.map((r) => mapRow(r, PRESENTATION));
}

/** `songHistoryView` {id}: {song, versions newest first (SONG-R23), the organisation's default theme}. */
export async function songHistoryView(args: unknown, sql: RunSql) {
  const id = idOf(argsOf(args), 'id');
  return {
    song: await song(sql, id),
    versions: await select(sql, VERSION, 'song_versions WHERE song_id = ? ORDER BY created_at DESC, id DESC', [id]),
    theme: await themeOf(sql, null),
  };
}

/** `songMaterialsView` {songIds}: the sheet music, recordings and links of the songs, each song's in its order. */
export async function songMaterialsView(args: unknown, sql: RunSql) {
  const ids = argsOf(args).songIds;
  if (!Array.isArray(ids)) throw new MutationError('invalid-args', 'songIds');
  return ids.length ? select(sql, MATERIAL, `song_materials WHERE song_id IN (${marks(ids.length)}) ORDER BY sort, id`, ids) : [];
}
