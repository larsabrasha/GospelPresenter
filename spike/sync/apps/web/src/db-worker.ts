// The page's database: wa-sqlite on OPFS through OPFSCoopSyncVFS, in a
// dedicated worker (OPFS sync access handles exist only in workers). The sync
// client runs here too, so the page only sends commands.
import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from '@journeyapps/wa-sqlite';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import { SyncClient, httpTransport, type Transport } from '@spike/client';
import { waSqliteConnection } from '@spike/client/wa-sqlite-api';
import type { ClientSqlite } from '@spike/client';
import type { MutatorName } from '@spike/core';
import type { WorkerCall, WorkerReply } from './protocol.ts';

// crypto.randomUUID exists only in secure contexts (https or localhost). A
// tablet that loads the desktop's page over plain http on the LAN has none.
if (typeof crypto.randomUUID !== 'function') {
  (crypto as { randomUUID: () => string }).randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

let client: SyncClient | undefined;
let sqlite: ClientSqlite | undefined;
let online = true;
let pokeUrl = '';

/** Where the database lives: OPFS, or memory when the browser gives no OPFS (with the reason). */
let storage = '';

async function openDb(file: string): Promise<ClientSqlite> {
  const wasmBinary = await (await fetch('/wa-sqlite.wasm')).arrayBuffer();
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);
  try {
    if (!self.isSecureContext) throw new Error('not a secure context');
    await navigator.storage.getDirectory();
    const vfs = await OPFSCoopSyncVFS.create('opfs', module);
    sqlite3.vfs_register(vfs, true);
    storage = 'opfs';
    return waSqliteConnection(sqlite3, await sqlite3.open_v2(file));
  } catch (e) {
    storage = `memory (${e instanceof Error ? e.message : String(e)})`;
    return waSqliteConnection(sqlite3, await sqlite3.open_v2(':memory:'));
  }
}

async function handle(call: WorkerCall): Promise<unknown> {
  switch (call.op) {
    case 'open': {
      sqlite = await openDb(call.file);
      const http = httpTransport({ baseUrl: location.origin, token: call.user, org: call.org });
      const transport: Transport = {
        post(path, body) {
          if (!online) return Promise.reject(new Error('offline'));
          return http.post(path, body);
        },
      };
      client = await SyncClient.open(sqlite, { transport, ctx: { userId: call.user, role: call.role } });
      const u = new URL('/sync/poke', location.origin.replace(/^http/, 'ws'));
      u.searchParams.set('token', call.user);
      u.searchParams.set('org', call.org);
      pokeUrl = u.toString();
      return client.id;
    }
    case 'mutate':
      return client!.mutate(call.name as MutatorName, call.args as never);
    case 'dump':
      return client!.dump();
    case 'pending':
      return client!.pending();
    case 'sync':
      return client!.sync();
    case 'listen':
      return client!.listen(pokeUrl);
    case 'online':
      online = call.online;
      return;
    case 'integrity':
      return (await sqlite!.query('PRAGMA integrity_check')).rows.map((r) => r[0]);
    case 'clientId':
      return client!.id;
    case 'status':
      return { storage, secure: self.isSecureContext, pending: (await client!.pending()).length, socket: socketOpen };
    case 'keepAlive':
      keepAlive();
      return;
    case 'close':
      await client?.close();
      client = undefined;
      return;
  }
}

// The spike client has no reconnect and no poll (SYNC-R43). For the tablet
// test: reopen the poke socket and sync every few seconds.
let socketOpen = false;
let alive: ReturnType<typeof setInterval> | undefined;
function keepAlive() {
  if (alive) return;
  const tick = async () => {
    if (!client) return;
    if (!socketOpen) {
      try {
        await client.listen(pokeUrl);
        socketOpen = true;
        (client as unknown as { socket: WebSocket }).socket.addEventListener('close', () => (socketOpen = false));
      } catch {
        socketOpen = false;
      }
    }
    await client.requestSync();
  };
  alive = setInterval(() => void tick(), 3000);
  void tick();
}

self.onmessage = async (e: MessageEvent<{ id: number; call: WorkerCall }>) => {
  const { id, call } = e.data;
  let reply: WorkerReply;
  try {
    reply = { id, ok: true, value: await handle(call) };
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
  self.postMessage(reply);
};
