import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { Song } from '@gp/core';
import { presentationMediaState } from '@gp/sync/client';
import type { Db } from './db.ts';
import type { DbStatus } from './protocol.ts';
import { blobUrl, listSongs, shownOverlay, type ShownOverlay } from './queries.ts';
import { needsReload, type ReadDb } from './share.ts';
import { isHostWindow } from '../hostWindow.ts';

const DbContext = createContext<Db | null>(null);
const ReadContext = createContext<ReadDb | null>(null);

/** A window that owns the database: it reads, writes and syncs. */
export function DbProvider({ db, children }: { db: Db; children: ReactNode }) {
  return (
    <DbContext value={db}>
      <ReadContext value={db}>{children}</ReadContext>
    </DbContext>
  );
}

/** A window that only reads, through another window's database (the output). */
export function ReaderProvider({ reader, children }: { reader: ReadDb; children: ReactNode }) {
  return <ReadContext value={reader}>{children}</ReadContext>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb outside DbProvider');
  return db;
}

function useReader(): ReadDb {
  const db = useContext(ReadContext);
  if (!db) throw new Error('useData outside DbProvider or ReaderProvider');
  return db;
}

/**
 * Loads data from the local database and loads it again whenever the database
 * changes: a local mutation, a pull, or another window's write. `undefined`
 * until the first load. `deps` are the inputs of `load`.
 */
export function useData<T>(load: (db: ReadDb) => Promise<T>, deps: readonly unknown[]): T | undefined {
  return useDataOf(load, deps);
}

/**
 * `useData` that loads again only when a change wrote one of `tables`, every
 * table `load` reads (or the change does not say what it wrote). Only for the
 * song library, which a reload on every change would draw again; a table
 * missing from `tables` is an update missed.
 */
function useDataOf<T>(load: (db: ReadDb) => Promise<T>, deps: readonly unknown[], tables?: readonly string[]): T | undefined {
  const db = useReader();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let current = true;
    let run = 0;
    const reload = () => {
      const mine = ++run;
      void load(db).then((v) => {
        if (current && mine === run) setValue(v);
      });
    };
    reload();
    const off = db.onChange((changed) => needsReload(tables, changed) && reload());
    return () => {
      current = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is a new closure every render; `deps` are its inputs; `tables` is fixed per call.
  }, [db, ...deps]);
  return value;
}

export function useDbStatus(): DbStatus | undefined {
  const db = useDb();
  const [status, setStatus] = useState<DbStatus>();
  useEffect(() => {
    void db.status().then(setStatus);
    return db.onStatus(setStatus);
  }, [db]);
  return status;
}

/** The object URL of a stored picture blob, or null while there is none (not synced to this device yet, or no hash). */
export function useBlobUrl(hash: string | null): string | null {
  return useData(async (db) => (hash ? blobUrl(db, hash) : null), [hash]) ?? null;
}

/** What the overlay `id` shows, or null for none (or one deleted meanwhile). */
export function useShownOverlay(id: string | null): ShownOverlay | null {
  return useData((db) => shownOverlay(db, id), [id]) ?? null;
}

/**
 * While the page is open, has the database fetch the presentation's pictures
 * (and its audio, unless `audio` is false: a remote control never plays), and
 * says how many of the files it needs this device has.
 */
export function usePresentationMedia(presentationId: string, audio: boolean): { needed: number; present: number } | undefined {
  const db = useContext(DbContext);
  const key = useId();
  useEffect(() => {
    if (!db) return;
    void db.openMedia(key, presentationId, audio);
    return () => void db.closeMedia(key);
  }, [db, key, presentationId, audio]);
  const state = useData((r) => presentationMediaState(r, presentationId, audio), [presentationId, audio]);
  return state && isHostWindow() ? { ...state, present: state.needed } : state;
}

/**
 * The song library and a search of it (SONG-R30–R33), run in the database's
 * worker, so the page never loads the lyrics. `songs` is every song by name
 * (not the trash). `shown` is the hits, best first, or every song for a blank
 * query; `shownQuery` is the query `shown` answers, which trails the one typed
 * until the worker has answered (highlight with it, and pick from `shown`
 * only once they agree).
 */
export function useSongSearch(query: string): { songs: Song[] | undefined; shown: Song[] | undefined; shownQuery: string } {
  const db = useDb();
  const songs = useDataOf(listSongs, [], ['songs']);
  // The worker prepares the library for search at the first search: started here, ahead of the first key.
  useEffect(() => void db.searchSongs('').catch(() => undefined), [db]);
  const blank = !query.trim();
  const hits = useDataOf(async () => (blank ? null : { query, ids: await db.searchSongs(query) }), [query], ['songs', 'song_parts']);
  // The same array until the songs or the hits change, so a list drawn from it is not drawn again on every key.
  const found = useMemo(() => {
    if (!songs || !hits) return undefined;
    const byId = new Map(songs.map((s) => [s.id, s]));
    // A song the list has not caught up with yet waits for the next load of both.
    return hits.ids.flatMap((id) => byId.get(id) ?? []);
  }, [songs, hits]);
  if (blank || !hits) return { songs, shown: songs, shownQuery: blank ? query : '' };
  return { songs, shown: found, shownQuery: hits.query };
}
