// The local database: wa-sqlite on OPFS (OPFSCoopSyncVFS) in a dedicated
// worker, since OPFS sync access handles exist only in workers. One file per
// account and organisation (D3). The sync client runs here too.
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url';
import * as SQLite from '@journeyapps/wa-sqlite';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import { bibleId, importBibleZip, recordMediaBlobSql, verseCount, type MutatorName } from '@gp/core';
import {
  authHeaders,
  BibleTextUploads,
  chainBeforePush,
  httpTransport,
  MediaUploads,
  socketProtocols,
  storeBibleText,
  storeMediaBlob,
  DEFAULT_MEDIA_POLICY,
  dropBible,
  fetchBibleText,
  keepBible,
  setBibleKept,
  setPinned,
  syncBibleTexts,
  syncMedia,
  SongSearch,
  SyncClient,
  type ClientSqlite,
  type MediaPolicy,
  storageReport,
} from '@gp/sync/client';
import { keepVideos } from './videoFiles.ts';
import { waSqliteConnection } from '@gp/sync/wa-sqlite-api';
import type { AudioImport, BibleImportResult, DbCall, DbMessage, DbStatus, ImageImport, Session, SlidesImport, VideoImport } from './protocol.ts';
import { dbFileName, serveReads, shareChannelName, type MediaBytes } from './share.ts';

/** The backstop poll (SYNC-R43): pokes are never load-bearing. */
const POLL_MS = 5 * 60_000;
const RECONNECT_MS = 3_000;

let client: SyncClient | undefined;
let session: Session | undefined;
let storage = '';
let connected = false;
let songSearch: SongSearch | undefined;
/** Tells this window's page and the other windows that the database changed: `tables` are those written, or every one when not given. */
let notifyChanged: (tables?: Iterable<string>) => void = () => {};

/** The tables of the device's own a Bible download, keep or drop writes. */
const BIBLE_TABLES = ['bible_texts', 'bible_blobs', 'kept_bibles'];

const post = (m: DbMessage) => self.postMessage(m);

async function openDb(file: string, s: Session): Promise<ClientSqlite> {
  const module = await SQLiteESMFactory({ locateFile: () => wasmUrl });
  const sqlite3 = SQLite.Factory(module);
  if (s.hostWindow) {
    // The server beside it holds everything: a copy on disk would be the same data twice.
    storage = 'host';
    return waSqliteConnection(sqlite3, await sqlite3.open_v2(':memory:'));
  }
  try {
    if (s.storage === 'memory') throw new Error('?storage=memory');
    // OPFS needs a secure context (https or localhost) and is missing in Safari's private browsing.
    if (!self.isSecureContext) throw new Error('not a secure context');
    await navigator.storage.getDirectory();
    sqlite3.vfs_register(await OPFSCoopSyncVFS.create('opfs', module), true);
    storage = 'opfs';
    return waSqliteConnection(sqlite3, await sqlite3.open_v2(file));
  } catch (e) {
    storage = `memory (${e instanceof Error ? e.message : String(e)})`;
    return waSqliteConnection(sqlite3, await sqlite3.open_v2(':memory:'));
  }
}

async function status(): Promise<DbStatus> {
  return {
    storage,
    connected,
    syncing: client?.busy ?? false, // read before the await below, so the report is of this moment
    pending: client ? (await client.pending()).length : 0,
    updateRequired: client?.updateRequired ?? false,
    authError: client?.authError ?? null,
    rejected: client ? [...client.rejected] : [],
  };
}

async function reportStatus() {
  post({ type: 'status', status: await status() });
}

/**
 * Keeps the poke socket open and syncs on every poke, on reconnect and on the
 * backstop poll; stops for good once the server refuses the credentials.
 */
function startSync(c: SyncClient, s: Session) {
  const url = new URL('/api/sync/poke', location.origin.replace(/^http/, 'ws')).toString();
  const connect = async () => {
    if (c.authError) return void reportStatus();
    try {
      await c.listen(url, {
        protocols: socketProtocols({ token: s.token, device: s.device }),
        onClose: () => {
          connected = false;
          void reportStatus();
          setTimeout(() => void connect(), RECONNECT_MS);
        },
      });
      connected = true;
      await c.requestSync(); // catch up on what happened while disconnected
      syncBibles(); // and fetch any text a failed download left out
      syncMediaBlobs();
    } catch {
      // A refused socket says nothing of why: a sync attempt tells offline from refused credentials.
      connected = false;
      await c.requestSync();
      if (!c.authError) setTimeout(() => void connect(), RECONNECT_MS);
    }
    void reportStatus();
  };
  void connect();
  setInterval(() => {
    void c.requestSync().then(reportStatus);
    syncBibles();
    syncMediaBlobs();
  }, POLL_MS);
}

// ------------------------------------------------------------ Bible texts (docs/bibles-and-themes.md, "Bibles") and media blobs ("Media")

/** Imports, downloads and clean-ups of stored texts and blobs run one at a time. */
let bibleWork: Promise<unknown> = Promise.resolve();
function serialStore<T>(fn: () => Promise<T>): Promise<T> {
  const run = bibleWork.then(fn, fn);
  bibleWork = run.catch(() => undefined);
  return run;
}

const credentials = () => authHeaders({ token: session!.token, device: session!.device });

/** Uploads the text of each queued import before the import is pushed, so imports work offline. */
const uploads = new BibleTextUploads(async (hash, json) => {
  const res = await fetch(`/api/bibles/${hash}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...credentials() }, body: json });
  return res.status;
});

/** Uploads the blobs of each queued `addImage` before it is pushed, so a picture can be added offline. */
const mediaUploads = new MediaUploads(async (hash, bytes) => {
  const res = await fetch(`/api/media/${hash}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...credentials() }, body: bytes as BodyInit });
  return res.status;
});

/** The presentation this window presents: its files are fetched at once. */
let presenting: string | null = null;
/** "Spara kommande presentationer offline" on this device. */
let keepComing = false;

/** The most bytes of files nothing wants now this device keeps (the cache; MEDIA-R14), as the page sets it. */
let budget: number = DEFAULT_MEDIA_POLICY.budget;

/** Which files this device fetches and keeps now (docs/media-and-files.md, "Which files a device keeps"). */
function mediaPolicy(): MediaPolicy {
  return {
    ...DEFAULT_MEDIA_POLICY,
    presenting,
    keepComing,
    budget,
    // Only a device that keeps its data keeps presentations offline: in memory they would be lost at the next reload.
    persistent: storage === 'opfs',
    today: new Date().toLocaleDateString('sv-SE'), // YYYY-MM-DD, this device's own calendar day
    // A host's own window fetches nothing and keeps only what waits to be uploaded: it shows the server's files (`fetchMedia`).
    ...(session!.hostWindow ? { fetch: false, budget: 0 } : {}),
  };
}

async function downloadBlob(hash: string): Promise<Uint8Array | null> {
  const res = await fetch(`/api/media/${hash}`, { headers: credentials() });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

/** A video from `offset` on (HTTP Range), to keep it whole here. */
const getVideo = (hash: string, offset: number) => fetch(`/api/media/${hash}`, { headers: { ...credentials(), ...(offset ? { range: `bytes=${offset}-` } : {}) } });

/**
 * "Rensa cache": drops every file nothing wants now, blobs and videos, at once. Never a thumbnail, a file
 * waiting to be uploaded, or one the presentation shown now or one kept offline needs.
 */
async function clearCache(): Promise<void> {
  await serialStore(async () => {
    const r = await syncMedia(client!, async () => null, Date.now(), { ...mediaPolicy(), budget: 0 });
    blobCache = r.cache;
    notifyChanged(['media_blobs']);
  });
  // After the run under way, and any it asked for.
  for (let run: Promise<void> | null = videoRun; run; run = videoRun) await run;
  if (storage === 'opfs' && !session?.hostWindow) await keepVideos(client!, mediaPolicy(), 0, getVideo, () => notifyChanged(['video_files']), Date.now, false).catch(() => undefined);
  notifyChanged(['video_files']);
}

/** The bytes of the blobs' cache after the last clean-up: the videos' cache gets what is left of the budget. */
let blobCache = 0;

let mediaSyncQueued = false;
/** Fetches the blobs of pictures this device lacks (thumbnails first) and drops unused ones; coalesced. Then the videos kept offline. */
function syncMediaBlobs() {
  if (mediaSyncQueued) return;
  mediaSyncQueued = true;
  void serialStore(async () => {
    mediaSyncQueued = false;
    const r = await syncMedia(client!, downloadBlob, Date.now(), mediaPolicy());
    blobCache = r.cache;
    if (r.downloaded.length || r.removed) notifyChanged(['media_blobs']);
  })
    .catch(() => undefined) // offline: the next change or poll tries again
    .finally(syncVideoFiles);
}

let videoRun: Promise<void> | null = null;
let videoAgain = false;
/**
 * Fetches the whole videos of the presentations kept offline here and drops the ones nothing keeps; one run
 * at a time, outside the imports' queue, as a video takes long. A run asked for meanwhile follows it.
 */
function syncVideoFiles() {
  if (storage !== 'opfs' || session?.hostWindow) return;
  if (videoRun) {
    videoAgain = true;
    return;
  }
  videoRun = keepVideos(
    client!,
    mediaPolicy(),
    Math.max(0, budget - blobCache),
    getVideo,
    () => notifyChanged(['video_files']),
  )
    .then(() => undefined)
    .catch(() => undefined) // offline: the next change or poll goes on from where this stopped
    .finally(() => {
      videoRun = null;
      if (videoAgain) {
        videoAgain = false;
        syncVideoFiles();
      }
    });
}

/** Keeps the picture's blobs here and records it in the library, online or not. */
function addImage(img: ImageImport): Promise<void> {
  return serialStore(async () => {
    const fullHash = await storeMediaBlob(client!, img.full, img.contentType);
    const thumbHash = await storeMediaBlob(client!, img.thumb, img.contentType);
    await client!.mutate('addImage', {
      id: img.id,
      fileName: img.fileName,
      contentType: img.contentType,
      fullHash,
      thumbHash,
      width: img.width,
      height: img.height,
      createdAt: Date.now(),
    });
    void client!.requestSync().then(reportStatus);
  });
}

/** Keeps the audio file here and records it in the library, online or not. */
function addAudio(a: AudioImport): Promise<void> {
  return serialStore(async () => {
    const hash = await storeMediaBlob(client!, a.bytes, a.contentType);
    await client!.mutate('addAudio', { id: a.id, fileName: a.fileName, contentType: a.contentType, hash, size: a.bytes.length, createdAt: Date.now() });
    void client!.requestSync().then(reportStatus);
  });
}

/**
 * Records a video the page has uploaded: its still is kept here (uploaded before the add is pushed), the
 * video only named, without its bytes, so `addVideo` finds it here as it does on the server. No device
 * keeps a video: it streams from the server.
 */
function addVideo(v: VideoImport): Promise<void> {
  return serialStore(async () => {
    const stillHash = await storeMediaBlob(client!, v.still, v.stillType);
    const thumbHash = await storeMediaBlob(client!, v.thumb, v.stillType);
    await client!.localWrite([recordMediaBlobSql(v.hash, v.contentType, v.size, null, Date.now())]);
    await client!.mutate('addVideo', {
      id: v.id,
      fileName: v.fileName,
      contentType: v.contentType,
      codec: v.codec,
      hash: v.hash,
      size: v.size,
      duration: v.duration,
      width: v.width,
      height: v.height,
      stillHash,
      thumbHash,
      createdAt: Date.now(),
    });
    void client!.requestSync().then(reportStatus);
  });
}

/** Keeps every page's blobs here and adds the deck as an item, online or not. */
function addSlides(s: SlidesImport): Promise<void> {
  return serialStore(async () => {
    const pages: { full: string; thumb: string }[] = [];
    for (const page of s.pages) {
      pages.push({ full: await storeMediaBlob(client!, page.full, s.contentType), thumb: await storeMediaBlob(client!, page.thumb, s.contentType) });
    }
    await client!.mutate('addSlides', { itemId: s.itemId, presentationId: s.presentationId, fileName: s.fileName, pages, afterItemId: s.afterItemId });
    void client!.requestSync().then(reportStatus);
  });
}

let bibleSyncQueued = false;
/**
 * Queues again an import the server refused for lack of its text, fetches
 * the texts of translations this device lacks and drops unused ones; coalesced.
 */
function syncBibles() {
  if (bibleSyncQueued) return;
  bibleSyncQueued = true;
  void serialStore(async () => {
    bibleSyncQueued = false;
    if (await uploads.retryRefused(client!)) void client!.requestSync().then(reportStatus);
    const r = await syncBibleTexts(client!, downloadBibleText, 'chosen');
    if (r.downloaded.length || r.removed) notifyChanged(BIBLE_TABLES);
  }).catch(() => undefined); // offline: the next change or poll tries again
}

/** A host's own window: a media blob from the server beside it, not stored; null elsewhere, or if the server has none. */
async function fetchMediaHere(hash: string): Promise<MediaBytes | null> {
  if (!session?.hostWindow) return null;
  try {
    const res = await fetch(`/api/media/${hash}`, { headers: credentials() });
    return res.ok ? { contentType: res.headers.get('content-type') ?? 'application/octet-stream', bytes: new Uint8Array(await res.arrayBuffer()) } : null;
  } catch {
    return null;
  }
}

async function downloadBibleText(hash: string): Promise<string | null> {
  const res = await fetch(`/api/bibles/${hash}`, { headers: credentials() });
  return res.ok ? res.text() : null;
}

/** "Gör tillgänglig offline" or "Ta bort den nedladdade kopian", in turn with imports and the other downloads. */
function keepBibleHere(id: string, on: boolean): Promise<boolean> {
  return serialStore(async () => {
    if (session!.hostWindow) return true; // the host's server keeps every text
    const ok = on ? await keepBible(client!, id, downloadBibleText) : (await dropBible(client!, id, downloadBibleText), true);
    notifyChanged(BIBLE_TABLES);
    return ok;
  });
}

/**
 * Reads the zip, keeps its text here and records the translation, online or
 * not. The text is uploaded before the import is pushed (`uploads`).
 */
function importBible(data: Uint8Array): Promise<BibleImportResult> {
  return serialStore(async () => {
    const bible = await importBibleZip(data, () => new Promise((r) => setTimeout(r, 0)));
    const { hash } = await storeBibleText(client!, bible.books);
    const id = bibleId(bible.abbreviation);
    const replaced = (await client!.query('SELECT 1 FROM bibles WHERE id = ?', [id])).length > 0;
    // Imported here, so kept here: its text stays once the import has been uploaded.
    await setBibleKept(client!, id, true);
    await client!.mutate('importBible', { name: bible.name, abbreviation: bible.abbreviation, language: bible.language, contentHash: hash });
    await client!.requestSync();
    void reportStatus();
    const queued = (await client!.pending()).some((m) => m.name === 'importBible' && JSON.parse(m.args).contentHash === hash);
    return { name: bible.name, abbreviation: bible.abbreviation, verses: verseCount(bible.books), replaced, queued };
  });
}

async function handle(call: DbCall): Promise<unknown> {
  switch (call.op) {
    case 'open': {
      if (client) return client.id;
      const s = call.session;
      const sqlite = await openDb(dbFileName(s), s);
      const c = await SyncClient.open(sqlite, {
        transport: httpTransport({ baseUrl: location.origin, token: s.token, device: s.device }),
        ctx: { userId: s.userId, role: s.role },
        beforePush: chainBeforePush(uploads.beforePush, mediaUploads.beforePush),
      });
      client = c;
      session = s;
      const search = (songSearch = new SongSearch(c));
      // Other windows of this machine read through this worker (the output), or
      // share the OPFS file (a second operator window): tell them about changes.
      const share = serveReads(
        new BroadcastChannel(shareChannelName(s)),
        (sql, params) => c.query(sql, params),
        (tables) => {
          search.forget(); // that window wrote the same file, which this client does not hear of
          post({ type: 'changed', ...(tables ? { tables } : {}) });
        },
        fetchMediaHere,
      );
      notifyChanged = (tables) => {
        const list = tables && [...tables];
        post({ type: 'changed', ...(list ? { tables: list } : {}) });
        share.changed(list);
      };
      c.onBusy(() => void reportStatus());
      c.onChange((tables) => {
        notifyChanged(tables);
        syncBibles();
        syncMediaBlobs();
        void reportStatus();
      });
      // In memory, the database is empty until it is pulled: the window opens on the data, not on empty pages
      // (a song's page that finds no song goes back to the list). The server is on this machine.
      if (s.hostWindow) await c.requestSync();
      startSync(c, s);
      syncBibles();
      syncMediaBlobs();
      return c.id;
    }
    case 'mutate':
      await client!.mutate(call.name as MutatorName, call.args as never);
      void client!.requestSync().then(reportStatus);
      return;
    case 'query':
      return client!.query(call.sql, call.params);
    case 'searchSongs':
      return songSearch!.search(call.query);
    case 'status':
      return status();
    case 'syncNow':
      await client!.requestSync();
      syncBibles();
      syncMediaBlobs();
      return status();
    case 'importBible':
      return importBible(call.data);
    case 'addImage':
      return addImage(call.image);
    case 'addAudio':
      return addAudio(call.audio);
    case 'addSlides':
      return addSlides(call.slides);
    case 'addVideo':
      return addVideo(call.video);
    case 'present':
      presenting = call.presentationId;
      syncMediaBlobs();
      return;
    case 'keepComing':
      keepComing = call.on;
      syncMediaBlobs();
      return;
    case 'setBudget':
      budget = call.bytes;
      syncMediaBlobs();
      return;
    case 'storageReport':
      return { ...(await storageReport(client!, mediaPolicy())), budget };
    case 'clearCache':
      return clearCache();
    case 'keepBible':
      return keepBibleHere(call.bibleId, call.on);
    case 'fetchBibleText':
      return fetchBibleText(downloadBibleText, call.hash);
    case 'fetchMedia':
      return fetchMediaHere(call.hash);
    case 'setPinned':
      await setPinned(client!, call.presentationId, call.on);
      notifyChanged(['pinned_presentations']);
      syncMediaBlobs();
      return;
  }
}

self.addEventListener('message', async (e: MessageEvent<{ id: number; call: DbCall }>) => {
  const { id, call } = e.data;
  try {
    post({ type: 'reply', id, ok: true, value: await handle(call) });
  } catch (err) {
    post({ type: 'reply', id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
