// The built web app beside the API, from the Node server and from the Worker's
// static assets alike: the CSP on every file, `no-cache` on index.html and
// /sw.js, an app page from index.html, and the API never answered by a file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdapter, type AdapterName, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];

const INDEX = '<!doctype html><div id="root"></div>';

describe.each(adapters)('%s adapter, the web app', (adapterName) => {
  let h: Harness;
  let web: string;

  beforeAll(async () => {
    web = mkdtempSync(join(tmpdir(), 'gp-web-'));
    mkdirSync(join(web, 'assets'));
    writeFileSync(join(web, 'index.html'), INDEX);
    writeFileSync(join(web, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(web, 'assets', 'index-abc123.js'), 'console.log(1);');
    h = await startAdapter(adapterName, { webRoot: web });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
    rmSync(web, { recursive: true, force: true });
  });

  it('index.html and /sw.js are asked again every time; hashed assets are not; all carry the CSP', async () => {
    for (const path of ['/', '/sw.js', '/assets/index-abc123.js']) {
      const res = await fetch(h.url + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'");
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      if (path.startsWith('/assets/')) expect(res.headers.get('cache-control') ?? '', path).not.toContain('no-cache');
      else expect(res.headers.get('cache-control'), path).toBe('no-cache');
    }
    expect(await (await fetch(h.url + '/')).text()).toBe(INDEX);
    // The service worker keeps /index.html by that name: it must be the page itself, not a redirect to `/`.
    const index = await fetch(h.url + '/index.html', { redirect: 'manual' });
    expect(index.status).toBe(200);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toBe(INDEX);
    expect(await (await fetch(h.url + '/sw.js')).text()).toContain('addEventListener');
  });

  it('an address with no file behind it is a page of the app; a missing file is not', async () => {
    const page = await fetch(h.url + '/presentations/p1');
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toBe(INDEX);
    expect((await fetch(h.url + '/assets/missing.js')).status).toBe(404);
  });

  it('the API is never answered by a file', async () => {
    const res = await fetch(h.url + '/api/no-such-route');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toBe(INDEX);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect((await fetch(h.url + '/api/auth/state')).headers.get('content-type')).toContain('application/json');
  });
});
