import { MutationError } from '@gp/core';
import type { SyncClient } from './client.ts';

// Song search on a device (SONG-R30–R33), run where the database is, so a page never loads every lyric: the Rust
// core prepares each song's texts once and keeps them (song_views.rs, search.rs); a change to the songs or their parts
// drops them here, and the next search has the core prepare the library again. The library's order, by name in the
// page's language, is the shell's: it hands the core the ids in that order, which ties keep.
export class SongSearch {
  /** The library prepared in the core, in library order; null until the next search prepares it again. */
  private library: Promise<void> | null = null;
  /** `localeCompare(…, locale, { sensitivity: 'base' })`, as the song lists sort in the page's language, made once. */
  private collator: Intl.Collator;

  constructor(
    private client: SyncClient,
    locale = 'sv-SE',
  ) {
    this.collator = new Intl.Collator(locale, { sensitivity: 'base' });
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

  /** The library's ids as `listSongs` orders them, the table's order sorted by name, handed to the core to prepare. */
  private async load(): Promise<void> {
    const songs = await this.client.view<{ id: string; name: string }[]>('songsView', {});
    const order = songs.toSorted((a, b) => this.collator.compare(a.name, b.name)).map((s) => s.id);
    await this.client.view('songSearchPrepare', { order });
  }
}
