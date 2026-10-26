// The client in real browsers: wa-sqlite on OPFS (OPFSCoopSyncVFS) in a
// dedicated worker, served from the Node server's origin as the desktop serves
// tablets. Run with `pnpm test:browser`; needs `pnpm exec playwright install`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startNodeServer } from '@spike/server/node';
import type { Dump } from '@spike/core';
import { device, POKE_WINDOW_MS, pokeUrl, serverDump, setRole, waitFor, type Device, type Harness } from './harness.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const engines = { chromium, webkit, firefox };
const names = (process.env.SYNC_BROWSERS ?? 'chromium,webkit,firefox').split(',') as (keyof typeof engines)[];

let h: Harness;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'gp-sync-web-'));
  const s = await startNodeServer({
    dataDir,
    debug: true,
    pokeWindowMs: POKE_WINDOW_MS,
    webRoot: join(here, '..', 'apps', 'web', 'dist'),
  });
  h = { name: 'node', url: s.url, close: s.close };
});

afterAll(async () => {
  await h?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Calls the page's database worker. */
function gp<T = unknown>(page: Page, call: object): Promise<T> {
  return page.evaluate((c) => (window as unknown as { gp: { call(c: object): Promise<unknown> } }).gp.call(c), call) as Promise<T>;
}

async function openPage(context: BrowserContext, org: string, user: string, file: string) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  await page.goto(h.url + '/index.html');
  await page.waitForFunction(() => 'gp' in window);
  await gp(page, { op: 'open', org, user, role: 'editor', file });
  return page;
}

const songs = (d: Dump) => d.songs.map((s) => s.id).sort();

it.each(names)('%s: no OPFS in an ephemeral context (private browsing)', async (name) => {
  const browser = await engines[name].launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(h.url + '/index.html');
  const result = await page.evaluate(() => navigator.storage.getDirectory().then(() => 'ok', (e: Error) => `${e.name}: ${e.message}`));
  console.log(`[measure] ${name} OPFS in an ephemeral context: ${result}`);
  await browser.close();
});

describe.each(names)('%s', (name) => {
  let context: BrowserContext;
  let org: string;
  let node: Device;

  beforeEach(async () => {
    // A persistent profile, as a real browser has: WebKit has no OPFS in an
    // ephemeral context. Database files are named per account and organisation
    // (D3), because WebKit under Playwright shares OPFS between profiles.
    const profile = mkdtempSync(join(tmpdir(), `gp-sync-${name}-`));
    context = await engines[name].launchPersistentContext(profile);
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'editor');
    await setRole(h, 'bob', org, 'editor');
    node = await device(h, org, 'bob', 'editor');
    return async () => {
      await node.client.close();
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    };
  });

  it('an offline edit survives a reload on OPFS and syncs afterwards', async () => {
    const page = await openPage(context, org, 'alice', `alice-${org}.db`);
    const clientId = await gp<string>(page, { op: 'clientId' });
    await gp(page, { op: 'online', online: false });
    await gp(page, { op: 'mutate', name: 'createSong', args: { id: 'S1', title: 'Offline song' } });
    await expect(gp(page, { op: 'sync' })).rejects.toThrow(/offline/);

    await page.reload();
    await page.waitForFunction(() => 'gp' in window);
    await gp(page, { op: 'open', org, user: 'alice', role: 'editor', file: `alice-${org}.db` });
    expect(await gp(page, { op: 'clientId' })).toBe(clientId);
    expect(songs(await gp<Dump>(page, { op: 'dump' }))).toEqual(['S1']);
    expect(await gp<unknown[]>(page, { op: 'pending' })).toHaveLength(1);

    await gp(page, { op: 'sync' });
    expect(await gp<unknown[]>(page, { op: 'pending' })).toHaveLength(0);
    await node.client.sync();
    expect(songs(await node.client.dump())).toEqual(['S1']);
    expect(await gp(page, { op: 'integrity' })).toEqual(['ok']);
  });

  it('pokes reach the browser and the browser pokes a Node client', async () => {
    const page = await openPage(context, org, 'alice', `alice-${org}.db`);
    await gp(page, { op: 'listen' });
    await node.client.listen(pokeUrl(h, org, 'bob'));

    const toBrowser: number[] = [];
    const toNode: number[] = [];
    for (let i = 0; i < 3; i++) {
      await node.client.mutate('createSong', { id: `N${i}`, title: `From Node ${i}` });
      await node.client.push();
      toBrowser.push(await waitFor(async () => songs(await gp<Dump>(page, { op: 'dump' })).includes(`N${i}`), 5_000, 10));

      await gp(page, { op: 'mutate', name: 'createSong', args: { id: `B${i}`, title: `From ${name} ${i}` } });
      await gp(page, { op: 'sync' });
      toNode.push(await waitFor(async () => songs(await node.client.dump()).includes(`B${i}`), 5_000, 10));
    }
    console.log(`[measure] ${name} poke latency ms, Node → browser: ${toBrowser.map(Math.round).join(', ')}; browser → Node: ${toNode.map(Math.round).join(', ')}`);
    expect(songs(await gp<Dump>(page, { op: 'dump' }))).toEqual(songs(await node.client.dump()));
  });

  it('1,200 rows: first pull into OPFS', async () => {
    for (let i = 0; i < 1200; i++) await node.client.mutate('createSong', { id: `S${String(i).padStart(4, '0')}`, title: `Song ${i}` });
    await node.client.push();
    const page = await openPage(context, org, 'alice', `alice-${org}.db`);
    const t0 = performance.now();
    await gp(page, { op: 'sync' });
    const ms = performance.now() - t0;
    console.log(`[measure] ${name} first pull of 1200 rows into OPFS: ${Math.round(ms)} ms`);
    expect((await gp<Dump>(page, { op: 'dump' })).songs).toHaveLength(1200);
  });

  it('two tabs on the same OPFS database, writing at once', async () => {
    const a = await openPage(context, org, 'alice', `alice-${org}.db`);
    const b = await openPage(context, org, 'alice', `alice-${org}.db`);
    const n = 20;
    const results = await Promise.allSettled([
      ...Array.from({ length: n }, (_, i) => gp(a, { op: 'mutate', name: 'createSong', args: { id: `A${i}`, title: `Tab A ${i}` } })),
      ...Array.from({ length: n }, (_, i) => gp(b, { op: 'mutate', name: 'createSong', args: { id: `B${i}`, title: `Tab B ${i}` } })),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    console.log(`[measure] ${name} two tabs, ${2 * n} concurrent writes: ${failed.length} failed${failed.length ? `; first: ${failed[0]}` : ''}`);
    console.log(`[measure] ${name} two tabs: same client id ${(await gp(a, { op: 'clientId' })) === (await gp(b, { op: 'clientId' }))}`);

    expect(await gp(a, { op: 'integrity' })).toEqual(['ok']);
    const local = songs(await gp<Dump>(b, { op: 'dump' }));
    const pending = await gp<{ id: number }[]>(a, { op: 'pending' });
    console.log(`[measure] ${name} two tabs: ${local.length} rows locally, ${pending.length} queued, ${new Set(pending.map((p) => p.id)).size} distinct mutation ids`);

    // Both tabs push the same queue. The server must end up with each write once.
    await Promise.allSettled([gp(a, { op: 'sync' }), gp(b, { op: 'sync' })]);
    await gp(a, { op: 'sync' });
    await gp(b, { op: 'sync' });
    const server = (await serverDump(h, org, 'alice')).tables.songs.map((s) => s.id).sort();
    console.log(`[measure] ${name} two tabs: server has ${server.length} rows, ${(await gp<unknown[]>(a, { op: 'pending' })).length} still queued`);
    expect(server).toEqual(local);
    expect(local).toHaveLength(2 * n - failed.length);
  });
});
