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
  httpTransport,
  socketProtocols,
  storeBibleText,
  syncBibleTexts,
  SyncClient,
  type ClientSqlite,
} from '@gp/sync/client';
import { waSqliteConnection } from '@gp/sync/wa-sqlite-api';
import type { BibleImportResult, DbCall, DbMessage, DbStatus, Session } from './protocol.ts';
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
  const url = new URL('/sync/poke', location.origin.replace(/^http/, 'ws')).toString();
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
  }, POLL_MS);
}

// ------------------------------------------------------------ Bible texts (README, "Bibles")

/** Imports, downloads and clean-ups of stored texts run one at a time. */
let bibleWork: Promise<unknown> = Promise.resolve();
function serialBible<T>(fn: () => Promise<T>): Promise<T> {
  const run = bibleWork.then(fn, fn);
  bibleWork = run.catch(() => undefined);
  return run;
}

const credentials = () => authHeaders({ token: session!.token, device: session!.device });

/** Uploads the text of each queued import before the import is pushed, so imports work offline. */
const uploads = new BibleTextUploads(async (hash, json) => {
  const res = await fetch(`/bibles/${hash}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...credentials() }, body: json });
  return res.status;
});

let bibleSyncQueued = false;
/**
 * Queues again an import the server refused for lack of its text, fetches
 * the texts of translations this device lacks and drops unused ones; coalesced.
 */
function syncBibles() {
  if (bibleSyncQueued) return;
  bibleSyncQueued = true;
  void serialBible(async () => {
    bibleSyncQueued = false;
    if (await uploads.retryRefused(client!)) void client!.requestSync().then(reportStatus);
    const r = await syncBibleTexts(client!, async (hash) => {
      const res = await fetch(`/bibles/${hash}`, { headers: credentials() });
      return res.ok ? res.text() : null;
    });
    if (r.downloaded.length || r.removed) notifyChanged();
  }).catch(() => undefined); // offline: the next change or poll tries again
}

/**
 * Reads the zip, keeps its text here and records the translation, online or
 * not. The text is uploaded before the import is pushed (`uploads`).
 */
function importBible(data: Uint8Array): Promise<BibleImportResult> {
  return serialBible(async () => {
    const bible = await importBibleZip(data, () => new Promise((r) => setTimeout(r, 0)));
    const { hash } = await storeBibleText(client!, bible.books);
    const id = bibleId(bible.abbreviation);
    const replaced = (await client!.query('SELECT 1 FROM bibles WHERE id = ?', [id])).length > 0;
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
        beforePush: uploads.beforePush,
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
      c.onChange(() => {
        notifyChanged();
        syncBibles();
        void reportStatus();
      });
      startSync(c, s);
      syncBibles();
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
      return status();
    case 'importBible':
      return importBible(call.data);
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
