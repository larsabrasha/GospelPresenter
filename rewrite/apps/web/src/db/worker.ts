// The local database: wa-sqlite on OPFS (OPFSCoopSyncVFS) in a dedicated
// worker, since OPFS sync access handles exist only in workers. One file per
// account and organisation (D3). The sync client runs here too.
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url';
import * as SQLite from '@journeyapps/wa-sqlite';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import { bibleId, importBibleZip, verseCount, type MutatorName } from '@gp/core';
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
  SyncClient,
  type ClientSqlite,
} from '@gp/sync/client';
import { waSqliteConnection } from '@gp/sync/wa-sqlite-api';
import type { AudioImport, BibleImportResult, DbCall, DbMessage, DbStatus, ImageImport, Session, SlidesImport } from './protocol.ts';
import { dbFileName, serveReads, shareChannelName } from './share.ts';

/** The backstop poll (SYNC-R43): pokes are never load-bearing. */
const POLL_MS = 5 * 60_000;
const RECONNECT_MS = 3_000;

let client: SyncClient | undefined;
let session: Session | undefined;
let storage = '';
let connected = false;
let notifyChanged = () => {};

const post = (m: DbMessage) => self.postMessage(m);

async function openDb(file: string, forceMemory: boolean): Promise<ClientSqlite> {
  const module = await SQLiteESMFactory({ locateFile: () => wasmUrl });
  const sqlite3 = SQLite.Factory(module);
  try {
    if (forceMemory) throw new Error('?storage=memory');
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

/** Presentations open on this device's pages, by page: their files are fetched now. */
const openMedia = new Map<string, { presentationId: string; audio: boolean }>();

let mediaSyncQueued = false;
/** Fetches the blobs of pictures this device lacks (thumbnails first) and drops unused ones; coalesced. */
function syncMediaBlobs() {
  if (mediaSyncQueued) return;
  mediaSyncQueued = true;
  void serialStore(async () => {
    mediaSyncQueued = false;
    const r = await syncMedia(
      client!,
      async (hash) => {
        const res = await fetch(`/api/media/${hash}`, { headers: credentials() });
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      },
      Date.now(),
      {
        ...DEFAULT_MEDIA_POLICY,
        open: [...openMedia.values()],
        // Only a device that keeps its data fetches coming presentations ahead: in memory it would be lost at the next reload.
        prefetch: storage === 'opfs',
        today: new Date().toLocaleDateString('sv-SE'), // YYYY-MM-DD, this device's own calendar day
      },
    );
    if (r.downloaded.length || r.removed) notifyChanged();
  }).catch(() => undefined); // offline: the next change or poll tries again
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
    const r = await syncBibleTexts(client!, downloadBibleText, session!.keepsEveryBible ? 'all' : 'chosen');
    if (r.downloaded.length || r.removed) notifyChanged();
  }).catch(() => undefined); // offline: the next change or poll tries again
}

async function downloadBibleText(hash: string): Promise<string | null> {
  const res = await fetch(`/api/bibles/${hash}`, { headers: credentials() });
  return res.ok ? res.text() : null;
}

/** "Gör tillgänglig offline" or "Ta bort den nedladdade kopian", in turn with imports and the other downloads. */
function keepBibleHere(id: string, on: boolean): Promise<boolean> {
  return serialStore(async () => {
    if (session!.keepsEveryBible) return true; // a host keeps every text
    const ok = on ? await keepBible(client!, id, downloadBibleText) : (await dropBible(client!, id, downloadBibleText), true);
    notifyChanged();
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
      const sqlite = await openDb(dbFileName(s), s.storage === 'memory');
      const c = await SyncClient.open(sqlite, {
        transport: httpTransport({ baseUrl: location.origin, token: s.token, device: s.device }),
        ctx: { userId: s.userId, role: s.role },
        beforePush: chainBeforePush(uploads.beforePush, mediaUploads.beforePush),
      });
      client = c;
      session = s;
      // Other windows of this machine read through this worker (the output), or
      // share the OPFS file (a second operator window): tell them about changes.
      const share = serveReads(
        new BroadcastChannel(shareChannelName(s)),
        (sql, params) => c.query(sql, params),
        () => post({ type: 'changed' }),
      );
      notifyChanged = () => {
        post({ type: 'changed' });
        share.changed();
      };
      c.onBusy(() => void reportStatus());
      c.onChange(() => {
        notifyChanged();
        syncBibles();
        syncMediaBlobs();
        void reportStatus();
      });
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
    case 'openMedia':
      openMedia.set(call.key, { presentationId: call.presentationId, audio: call.audio });
      syncMediaBlobs();
      return;
    case 'closeMedia':
      openMedia.delete(call.key);
      return;
    case 'keepBible':
      return keepBibleHere(call.bibleId, call.on);
    case 'fetchBibleText':
      return fetchBibleText(downloadBibleText, call.hash);
    case 'setPinned':
      await setPinned(client!, call.presentationId, call.on);
      notifyChanged();
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
