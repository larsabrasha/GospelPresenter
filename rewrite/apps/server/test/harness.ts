import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { SyncClient, httpTransport, socketProtocols, type Transport } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import type { Dump, MutatorCtx, Role } from '@gp/core';
import { startNodeServer } from '@gp/server/node';

export type AdapterName = 'node' | 'node-sqlite' | 'workers' | 'remote';

/** A running server, whichever runtime is behind it. */
export interface Harness {
  name: AdapterName;
  url: string;
  close(): Promise<void>;
}

const here = fileURLToPath(new URL('.', import.meta.url));
export const POKE_WINDOW_MS = 500;

export interface AdapterOptions {
  /** Sessions unused for this long are refused (the expiry tests shorten it). */
  sessionIdleMs?: number;
  setupToken?: string;
  /** Sign-in through this fake Google (test/fake-google.ts). Without it, Google is not configured. */
  google?: { url: string; clientId: string; clientSecret: string };
  /** Workers only: bundle as `pnpm build:worker` does for a deploy, where a test issuer is not allowed. */
  deployBuild?: boolean;
}

export async function startAdapter(name: AdapterName, opts: AdapterOptions = {}): Promise<Harness> {
  if (name === 'remote') {
    // A deployed Worker on a real Cloudflare account, e.g. https://gp-sync-spike-xxxx.workers.dev.
    const url = process.env.SYNC_REMOTE_URL;
    if (!url) throw new Error('SYNC_REMOTE_URL is not set');
    return { name, url: url.replace(/\/$/, ''), close: async () => {} };
  }
  if (name === 'node' || name === 'node-sqlite') {
    // 'node-sqlite' is the driver the Electron build uses (see apps/desktop).
    const dataDir = mkdtempSync(join(tmpdir(), 'gp-sync-'));
    const driver = name === 'node' ? 'better-sqlite3' : 'node:sqlite';
    const { google, deployBuild: _, ...rest } = opts;
    const s = await startNodeServer({
      dataDir,
      driver,
      debug: true,
      pokeWindowMs: POKE_WINDOW_MS,
      ...rest,
      google: google && { clientId: google.clientId, clientSecret: google.clientSecret, testIssuer: google.url },
      log: () => undefined,
    });
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
  const outfile = join(here, '..', 'dist', opts.deployBuild ? 'worker-deploy.js' : 'worker.js');
  await build({
    // As in package.json's build:worker for a deploy; test builds may use a fake Google.
    define: { GP_TEST_ISSUER: opts.deployBuild ? 'false' : 'true' },
    minifySyntax: !!opts.deployBuild,
    entryPoints: [join(here, '..', 'src', 'worker.ts')],
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
    bindings: {
      SPIKE_DEBUG: '1',
      POKE_WINDOW_MS: String(POKE_WINDOW_MS),
      ...(opts.setupToken ? { SETUP_TOKEN: opts.setupToken } : {}),
      ...(opts.sessionIdleMs ? { SESSION_IDLE_MS: String(opts.sessionIdleMs) } : {}),
      ...(opts.google
        ? { GOOGLE_CLIENT_ID: opts.google.clientId, GOOGLE_CLIENT_SECRET: opts.google.clientSecret, GOOGLE_TEST_ISSUER: opts.google.url }
        : {}),
    },
    host: '127.0.0.1',
    port: 0,
  });
  const url = (await mf.ready).toString().replace(/\/$/, '');
  return { name, url, close: () => mf.dispose() };
}

/** Session tokens the debug route handed out, by server, organisation and user. */
const tokens = new Map<string, string>();
const tokenKey = (h: Harness, org: string, user: string) => `${h.url} ${org} ${user}`;

export function tokenOf(h: Harness, org: string, user: string): string {
  const t = tokens.get(tokenKey(h, org, user));
  if (!t) throw new Error(`no session for ${user} in ${org}; call setRole first`);
  return t;
}

/**
 * A request. `user` and `org` send that user's session token (from
 * `setRole`); `token` sends any bearer token; `headers` adds more.
 */
export async function api<T = unknown>(
  h: Harness,
  method: string,
  path: string,
  opts: { user?: string; org?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const token = opts.token ?? (opts.user && opts.org ? tokenOf(h, opts.org, opts.user) : undefined);
  const res = await fetch(h.url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/**
 * Makes `userId` a member of `orgId` with `role` (creating both if needed)
 * through the debug route, and keeps a session token for them. Debug servers only.
 */
export async function setRole(h: Harness, userId: string, orgId: string, role: Role): Promise<string> {
  const r = await api<{ token: string }>(h, 'POST', '/debug/session', { body: { userId, orgId, role } });
  if (r.status !== 200) throw new Error(`debug session: ${r.status} ${JSON.stringify(r.body)}`);
  tokens.set(tokenKey(h, orgId, userId), r.body.token);
  return r.body.token;
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
  const http = httpTransport({ baseUrl: h.url, token: tokenOf(h, org, user) });
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

export function pokeUrl(h: Harness) {
  return h.url.replace(/^http/, 'ws') + '/sync/poke';
}

/** The subprotocols that carry a user's credentials on the poke socket. */
export function pokeProtocols(h: Harness, org: string, user: string) {
  return socketProtocols({ token: tokenOf(h, org, user) });
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, everyMs = 5): Promise<number> {
  const start = performance.now();
  for (;;) {
    if (await check()) return performance.now() - start;
    if (performance.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
