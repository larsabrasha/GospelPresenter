import type { BibleBookText, MutatorArgs, MutatorName } from '@gp/core';
import type { StorageReport } from '@gp/sync/client';
import type { AudioImport, VideoImport, BibleImportResult, DbCall, DbMessage, DbStatus, ImageImport, Session, SlidesImport, SongFileImport } from './protocol.ts';
import type { MediaBytes, ReadDb } from './share.ts';
import { locale } from '../i18n.ts';
import { serverOrigin } from '../server.ts';

/** The page's handle on its database worker, which owns the database and syncs it. */
export class Db implements ReadDb {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private next = 1;
  private changeListeners = new Set<(tables?: ReadonlySet<string>) => void>();
  private statusListeners = new Set<(s: DbStatus) => void>();
  /** When this window last wrote, so a page can tell its own changes from another session's. */
  lastWriteAt = 0;

  constructor() {
    this.worker.addEventListener('message', (e: MessageEvent<DbMessage>) => {
      const m = e.data;
      if (m.type === 'changed') {
        const tables = m.tables && new Set(m.tables);
        for (const fn of this.changeListeners) fn(tables);
      } else if (m.type === 'status') for (const fn of this.statusListeners) fn(m.status);
      else {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.ok) w?.resolve(m.value);
        else w?.reject(new Error(m.error));
      }
    });
  }

  private call<T>(c: DbCall): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, call: c });
    });
  }

  /** Opens the session's database and starts syncing it. */
  open(session: Session): Promise<string> {
    // A page that leaves (a reload, as a change of language or organisation makes) lets go of its database file at
    // once: iOS's web view kept the old page's worker, and the file's lock with it, past a reload, and the new page waited
    // for it with a blank screen (the phone app, 2026-11-03). Only where there is a file: a host window's database is in
    // memory, and ending its worker there left a reload under load hanging in the e2e tests.
    if (!session.hostWindow && session.storage !== 'memory') addEventListener('pagehide', () => this.worker.terminate());
    return this.call({ op: 'open', session, locale: locale(), server: serverOrigin() });
  }

  mutate<N extends MutatorName>(name: N, args: MutatorArgs<N>): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'mutate', name, args });
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.call({ op: 'query', sql, params });
  }

  /** Song search in the database's worker: the ids of the hits, best first (SONG-R30–R33). */
  searchSongs(query: string): Promise<string[]> {
    return this.call({ op: 'searchSongs', query });
  }

  /** Imports a Bible zip; rejects with a `BibleImportReason` as the message if it cannot. */
  importBible(data: Uint8Array): Promise<BibleImportResult> {
    return this.call({ op: 'importBible', data });
  }

  /** Keeps a processed picture here and adds it to the library, online or not; it is uploaded when the server can be reached. */
  addImage(image: ImageImport): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'addImage', image });
  }

  /** Keeps an audio file here and adds it to the library, online or not. */
  addAudio(audio: AudioImport): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'addAudio', audio });
  }

  /** Keeps a song's file (a PDF or a recording) here and adds it to the song's material, online or not. */
  addSongFile(file: SongFileImport): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'addSongFile', file });
  }

  /** A song's file, opened: from this device, else fetched now and kept as cache; null when it cannot be had. */
  openMedia(hash: string): Promise<MediaBytes | null> {
    return this.call({ op: 'openMedia', hash });
  }

  /** Records an uploaded video in the library; its still is kept here and uploaded before the add is pushed. */
  addVideo(video: VideoImport): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'addVideo', video });
  }

  /** Keeps a rendered slide deck's pages here and adds it as an item, online or not. */
  addSlides(slides: SlidesImport): Promise<void> {
    this.lastWriteAt = Date.now();
    return this.call({ op: 'addSlides', slides });
  }

  /** Tells the database that a page has a presentation open, so its pictures and audio are fetched now. */
  present(presentationId: string | null): Promise<void> {
    return this.call({ op: 'present', presentationId });
  }

  setBudget(bytes: number): Promise<void> {
    return this.call({ op: 'setBudget', bytes });
  }

  storageReport(): Promise<StorageReport & { budget: number }> {
    return this.call({ op: 'storageReport' });
  }

  clearCache(): Promise<void> {
    return this.call({ op: 'clearCache' });
  }

  /** "Spara kommande presentationer offline" on this device, on or off. */
  keepComing(on: boolean): Promise<void> {
    return this.call({ op: 'keepComing', on });
  }

  setPinned(presentationId: string, on: boolean): Promise<void> {
    return this.call({ op: 'setPinned', presentationId, on });
  }

  /** Keeps a translation's text on this device, downloaded now (false if it could not be), or removes the copy. */
  keepBible(bibleId: string, on: boolean): Promise<boolean> {
    return this.call({ op: 'keepBible', bibleId, on });
  }

  /** A host's own window: a media blob from the server, not stored (`ReadDb.fetchMedia`). */
  fetchMedia(hash: string): Promise<MediaBytes | null> {
    return this.call({ op: 'fetchMedia', hash });
  }

  /** A translation's text this device does not keep, fetched from the server and not stored; null offline. */
  fetchBibleText(hash: string): Promise<BibleBookText[] | null> {
    return this.call({ op: 'fetchBibleText', hash });
  }

  /** Syncs with the server now (the sync icon's click); answers with the status after it. */
  syncNow(): Promise<DbStatus> {
    return this.call({ op: 'syncNow' });
  }

  status(): Promise<DbStatus> {
    return this.call({ op: 'status' });
  }

  onChange(fn: (tables?: ReadonlySet<string>) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onStatus(fn: (s: DbStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
}
