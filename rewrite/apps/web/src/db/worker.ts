// The local database: wa-sqlite on OPFS (OPFSCoopSyncVFS) in a dedicated
// worker, since OPFS sync access handles exist only in workers. One file per
// account and organisation (D3). The sync client runs here too.
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import wasmUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite.wasm?url';
import * as SQLite from '@journeyapps/wa-sqlite';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import type { MutatorName } from '@gp/core';
import { httpTransport, SyncClient, type ClientSqlite } from '@gp/sync/client';
import { waSqliteConnection } from '@gp/sync/wa-sqlite-api';
import type { DbCall, DbMessage, DbStatus, Session } from './protocol.ts';
import { dbFileName, serveReads, shareChannelName } from './share.ts';

/** The backstop poll (SYNC-R43): pokes are never load-bearing. */
const POLL_MS = 5 * 60_000;
const RECONNECT_MS = 3_000;

let client: SyncClient | undefined;
let storage = '';
let connected = false;

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
    rejected: client ? [...client.rejected] : [],
  };
}

async function reportStatus() {
  post({ type: 'status', status: await status() });
}

function pokeUrl(s: Session) {
  const u = new URL('/sync/poke', location.origin.replace(/^http/, 'ws'));
  u.searchParams.set('token', s.userId);
  u.searchParams.set('org', s.orgId);
  return u.toString();
}

/** Keeps the poke socket open and syncs on every poke, on reconnect and on the backstop poll. */
function startSync(c: SyncClient, s: Session) {
  const connect = async () => {
    try {
      await c.listen(pokeUrl(s), {
        onClose: () => {
          connected = false;
          void reportStatus();
          setTimeout(() => void connect(), RECONNECT_MS);
        },
      });
      connected = true;
      await c.requestSync(); // catch up on what happened while disconnected
    } catch {
      connected = false;
      setTimeout(() => void connect(), RECONNECT_MS);
    }
    void reportStatus();
  };
  void connect();
  setInterval(() => void c.requestSync().then(reportStatus), POLL_MS);
}

async function handle(call: DbCall): Promise<unknown> {
  switch (call.op) {
    case 'open': {
      if (client) return client.id;
      const s = call.session;
      const sqlite = await openDb(dbFileName(s), s.storage === 'memory');
      const c = await SyncClient.open(sqlite, {
        transport: httpTransport({ baseUrl: location.origin, token: s.userId, org: s.orgId }),
        ctx: { userId: s.userId, role: s.role },
      });
      client = c;
      // Other windows of this machine read through this worker (the output), or
      // share the OPFS file (a second operator window): tell them about changes.
      const share = serveReads(
        new BroadcastChannel(shareChannelName(s)),
        (sql, params) => c.query(sql, params),
        () => post({ type: 'changed' }),
      );
      c.onChange(() => {
        post({ type: 'changed' });
        share.changed();
        void reportStatus();
      });
      startSync(c, s);
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
      return status();
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
