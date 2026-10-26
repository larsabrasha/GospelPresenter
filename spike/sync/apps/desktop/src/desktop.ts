import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { SyncClient, httpTransport } from '@spike/client';
import { openBetterSqlite } from '@spike/client/better-sqlite3';
import { openNodeSqliteClient } from '@spike/client/node-sqlite';
import { startNodeServer } from '@spike/server/node';

export const ORG = 'church';

/** The first non-loopback IPv4 address: what a tablet on the church LAN would use. */
export function lanAddress(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('no LAN address');
}

/**
 * What the desktop app does at start, the same in Electron and in plain Node:
 * start the embedded server on all interfaces, and run the operator's own
 * sync client against it on localhost. For the LAN check, the "operator"
 * renames the tablet's presentation as soon as it arrives.
 */
export async function runDesktop(opts: { dataDir: string; runtime: string; emit: (e: object) => void }) {
  // better-sqlite3 by default (ADR 0007); DESKTOP_DRIVER=node:sqlite for Node's built-in SQLite.
  const driver = process.env.DESKTOP_DRIVER === 'node:sqlite' ? 'node:sqlite' : 'better-sqlite3';
  const server = await startNodeServer({
    dataDir: opts.dataDir,
    driver,
    hostname: '0.0.0.0',
    port: Number(process.env.PORT ?? 0),
    debug: true,
  });
  const local = `http://127.0.0.1:${server.port}`;
  for (const [userId, role] of [
    ['operator', 'admin'],
    ['tablet', 'editor'],
  ]) {
    await fetch(`${local}/debug/membership`, { method: 'POST', body: JSON.stringify({ userId, orgId: ORG, role }) });
  }

  const clientFile = join(opts.dataDir, 'desktop-client.sqlite');
  const sqlite = driver === 'node:sqlite' ? openNodeSqliteClient(clientFile) : openBetterSqlite(clientFile);
  const client = await SyncClient.open(sqlite, {
    transport: httpTransport({ baseUrl: local, token: 'operator', org: ORG }),
    ctx: { userId: 'operator', role: 'admin' },
  });
  await client.sync();
  await client.listen(`ws://127.0.0.1:${server.port}/sync/poke?token=operator&org=${ORG}`);

  let renamed = false;
  const timer = setInterval(async () => {
    if (renamed) return;
    const p = (await client.dump()).presentations.find((r) => r.id === 'LAN-P');
    if (!p) return;
    renamed = true;
    opts.emit({ event: 'desktop-saw', name: p.name });
    await client.mutate('renamePresentation', { id: 'LAN-P', name: 'Renamed on the desktop' });
    await client.push();
    setTimeout(async () => {
      await client.pull();
      opts.emit({ event: 'desktop-dump', dump: await client.dump() });
    }, 1500);
  }, 20);

  opts.emit({
    event: 'ready',
    runtime: opts.runtime,
    driver,
    node: process.versions.node,
    lanUrl: `http://${lanAddress()}:${server.port}`,
    org: ORG,
  });
  return {
    async close() {
      clearInterval(timer);
      await client.close();
      await server.close();
    },
  };
}
