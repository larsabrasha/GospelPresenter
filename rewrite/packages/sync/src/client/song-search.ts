// Song search on a device (SONG-R30–R33), run where the database is, so a
// page never loads every lyric. Each song's texts as search reads them are
// prepared once and kept in memory; a change to the songs or their parts drops
// them, and the next search prepares the library again (about 0.1 s for 3 000
// songs).
import { prepareSong, rankSongs, type PreparedSong } from '@gp/core';
import type { SyncClient } from './client.ts';

/** `localeCompare(…, 'sv', { sensitivity: 'base' })`, as the song lists sort, made once. */
const collator = new Intl.Collator('sv', { sensitivity: 'base' });

interface Library {
  /** The ids in library order (by name, as the song lists show them), for the ties. */
  order: string[];
  texts: Map<string, PreparedSong>;
}

export class SongSearch {
  private library: Promise<Library> | null = null;

  constructor(private client: SyncClient) {
    client.onChange((tables) => {
      if (tables.has('songs') || tables.has('song_parts')) this.forget();
    });
  }

  /**
   * The ids of the songs that match `query`, best first, ties in library
   * order; a blank query gives every song in library order (SONG-R30). Not
   * the trash.
   */
  async search(query: string): Promise<string[]> {
    const { order, texts } = await (this.library ??= this.load());
    return rankSongs(order, (id) => texts.get(id)!, query);
  }

  /** Drops what is held, for a change this client does not report: another window's write to the same file. */
  forget() {
    this.library = null;
  }

  private async load(): Promise<Library> {
    const songs = (await this.client.query('SELECT id, name, author FROM songs WHERE deleted_at IS NULL')) as { id: string; name: string; author: string | null }[];
    const parts = (await this.client.query(
      'SELECT p.song_id, p.content FROM song_parts p JOIN songs s ON s.id = p.song_id WHERE s.deleted_at IS NULL ORDER BY p.song_id, p.sort, p.id',
    )) as { song_id: string; content: string }[];
    const lyrics = new Map<string, string[]>();
    for (const p of parts) (lyrics.get(p.song_id) ?? lyrics.set(p.song_id, []).get(p.song_id)!).push(p.content);
    const texts = new Map(
      songs.map((s) => {
        const own = lyrics.get(s.id) ?? [];
        return [s.id, prepareSong({ name: s.name, author: s.author, firstPart: own[0] ?? '', lyrics: own.join('\n') })];
      }),
    );
    // As `listSongs` orders the library: the table's order, then a stable sort by name.
    return { order: songs.toSorted((a, b) => collator.compare(a.name, b.name)).map((s) => s.id), texts };
  }
}
