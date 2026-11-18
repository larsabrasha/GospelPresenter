import { MutationError } from '@gp/core';
import type { SyncClient } from './client.ts';

// Song search on a device (SONG-R30–R33), run where the database is, so a page never loads every lyric: the Rust
// core prepares each song's texts once and keeps them (song_views.rs, search.rs); a change to the songs or their parts
// drops them here, and the next search has the core prepare the library again. The library's order, by name in the
// page's language, is the core's too (songsView with `locale`), handed back to it in that order, which ties keep.
export class SongSearch {
  /** The library prepared in the core, in library order; null until the next search prepares it again. */
  private library: Promise<void> | null = null;

  constructor(
    private client: SyncClient,
    private locale = 'sv-SE',
  ) {
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
    await (this.library ??= this.load());
    try {
      return await this.client.view<string[]>('songSearchView', { query });
    } catch (e) {
      // A new instance of the core (after a trap) holds no library: prepared again, once.
      if (!(e instanceof MutationError) || e.code !== 'not-prepared') throw e;
      this.forget();
      await (this.library ??= this.load());
      return this.client.view<string[]>('songSearchView', { query });
    }
  }

  /** Drops what is held, for a change this client does not report: another window's write to the same file. */
  forget() {
    this.library = null;
  }

  /** The library's ids as `listSongs` orders them, by name in the page's language, handed to the core to prepare. */
  private async load(): Promise<void> {
    const songs = await this.client.view<{ id: string }[]>('songsView', { locale: this.locale });
    await this.client.view('songSearchPrepare', { order: songs.map((s) => s.id) });
  }
}
