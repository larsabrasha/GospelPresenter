import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { SyncClient, httpTransport, type Transport } from '@spike/client';
import { openWaSqlite } from '@spike/client/wa-sqlite';
import type { Dump, MutatorCtx, Role } from '@spike/core';
import { startNodeServer } from '@spike/server/node';

export type AdapterName = 'node' | 'workers';

/** A running server, whichever runtime is behind it. */
export interface Harness {
  name: AdapterName;
  url: string;
  close(): Promise<void>;
}

const here = fileURLToPath(new URL('.', import.meta.url));
export const POKE_WINDOW_MS = 500;

export async function startAdapter(name: AdapterName): Promise<Harness> {
  if (name === 'node') {
    const dataDir = mkdtempSync(join(tmpdir(), 'gp-sync-'));
    const s = await startNodeServer({ dataDir, debug: true, pokeWindowMs: POKE_WINDOW_MS });
    return {
      name,
      url: s.url,
      async close() {
        await s.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  }
  // Workers: bundle the Worker and run it in workerd through Miniflare, with a
  // SQLite-backed Durable Object per organisation and a local D1. Nothing is deployed.
  const outfile = join(here, '..', 'apps', 'server', 'dist', 'worker.js');
  await build({
    entryPoints: [join(here, '..', 'apps', 'server', 'src', 'worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    external: ['cloudflare:workers'],
    outfile,
    logLevel: 'silent',
  });
  const mf = new Miniflare({
    modules: true,
    scriptPath: outfile,
    compatibilityDate: '2026-08-01',
    d1Databases: { DB: 'gp-sync-spike-global' },
    durableObjects: { ORG: { className: 'OrgDurableObject', useSQLite: true } },
    bindings: { SPIKE_DEBUG: '1', POKE_WINDOW_MS: String(POKE_WINDOW_MS) },
    host: '127.0.0.1',
    port: 0,
  });
  const url = (await mf.ready).toString().replace(/\/$/, '');
  return { name, url, close: () => mf.dispose() };
}

export async function api<T = unknown>(h: Harness, method: string, path: string, opts: { user?: string; org?: string; body?: unknown } = {}) {
  const res = await fetch(h.url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.user ? { authorization: `Bearer ${opts.user}` } : {}),
      ...(opts.org ? { 'x-org': opts.org } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

export function setRole(h: Harness, userId: string, orgId: string, role: Role) {
  return api(h, 'POST', '/debug/membership', { body: { userId, orgId, role } });
}

export interface ServerDump {
  tables: Dump;
  changes: { seq: number; tbl: string; pk: string; op: string }[];
}

export async function serverDump(h: Harness, org: string, user: string): Promise<ServerDump> {
  const r = await api<ServerDump>(h, 'GET', '/debug/dump', { user, org });
  if (r.status !== 200) throw new Error(`dump: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** A simulated network between a device and the server. */
export class Net {
  online = true;
  /** The next push reaches the server, but its response is lost. */
  loseNextPushResponse = false;
  /** Paths of every request sent. */
  requests: string[] = [];
}

export interface Device {
  client: SyncClient;
  net: Net;
  user: string;
}

export async function device(
  h: Harness,
  org: string,
  user: string,
  role: Role,
  extra: { protocol?: number } = {},
): Promise<Device> {
  const net = new Net();
  const http = httpTransport({ baseUrl: h.url, token: user, org });
  const transport: Transport = {
    async post(path, body) {
      if (!net.online) throw new Error('offline');
      net.requests.push(path);
      const r = await http.post(path, body);
      if (path === '/sync/push' && net.loseNextPushResponse) {
        net.loseNextPushResponse = false;
        throw new Error('connection reset (response lost)');
      }
      return r as never;
    },
  };
  const ctx: MutatorCtx = { userId: user, role };
  const client = await SyncClient.open(await openWaSqlite(), { transport, ctx, protocol: extra.protocol });
  return { client, net, user };
}

export function pokeUrl(h: Harness, org: string, user: string) {
  const u = new URL(h.url.replace(/^http/, 'ws') + '/sync/poke');
  u.searchParams.set('token', user);
  u.searchParams.set('org', org);
  return u.toString();
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, everyMs = 5): Promise<number> {
  const start = performance.now();
  for (;;) {
    if (await check()) return performance.now() - start;
    if (performance.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
