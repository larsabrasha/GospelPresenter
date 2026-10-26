import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { appCallbackLink, startFakeGoogle, TestBrowser, type FakeAccount, type FakeGoogle } from '../../server/test/fake-google.ts';

let google: FakeGoogle | undefined;
/** The fake Google every host in this worker signs in against (it never reaches the internet). */
export async function fakeGoogle(): Promise<FakeGoogle> {
  return (google ??= await startFakeGoogle());
}

export interface Desktop {
  app: ElectronApplication;
  page: Page;
  base: string;
  dataDir: string;
  /** The host's port (undefined for a client). */
  port: number | undefined;
  /** JSON events the main process printed, e.g. blocked requests. */
  events: Record<string, unknown>[];
}

/**
 * Starts the desktop app: as the host (embedded server) by default, or as a
 * client of `server`. A fresh data directory unless one is given. `memory`
 * keeps the pages' databases in memory, as where OPFS is missing. The page
 * starts wherever the app does: setup, sign-in, pairing or the app itself.
 */
export async function launch(opts: { server?: string; dataDir?: string; port?: number; memory?: boolean; lan?: boolean } = {}): Promise<Desktop> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'gp-desktop-'));
  const env: Record<string, string> = { ...(process.env as Record<string, string>), GP_DATA_DIR: dataDir };
  if (opts.server) env.GP_SERVER = opts.server;
  // A host gets a port of its own, so a host left running elsewhere does not collide; pass it again to restart on it.
  const port = opts.server ? undefined : (opts.port ?? 20_000 + Math.floor(Math.random() * 20_000));
  if (port) env.GP_PORT = String(port);
  if (opts.memory) env.GP_STORAGE = 'memory';
  if (opts.lan) env.GP_LAN = '1';
  else delete env.GP_LAN;
  const fake = await fakeGoogle();
  Object.assign(env, { GP_GOOGLE_CLIENT_ID: fake.clientId, GP_GOOGLE_CLIENT_SECRET: fake.clientSecret, GP_GOOGLE_TEST_ISSUER: fake.url });
  const app = await electron.launch({ args: ['dist/main.mjs'], env });
  const events: Record<string, unknown>[] = [];
  const ready = new Promise<string>((resolve) => {
    app.process().stdout!.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.startsWith('{')) continue;
        const e = JSON.parse(line) as Record<string, unknown>;
        events.push(e);
        if (e.event === 'ready') resolve(String(e.base));
      }
    });
  });
  const base = await ready;
  // The system browser is this test: the URL the app would open is kept for `browserSignIn` instead.
  await app.evaluate(({ shell }) => {
    const urls: string[] = [];
    (globalThis as { gpOpened?: string[] }).gpOpened = urls;
    shell.openExternal = async (url: string) => void urls.push(url);
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, base, dataDir, port, events };
}

/** The next URL the app opened in the "system browser". */
async function opened(d: Desktop): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const url = await d.app.evaluate(() => (globalThis as { gpOpened?: string[] }).gpOpened?.shift());
    if (url) return url;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the app opened no sign-in in the system browser');
}

/**
 * What the system browser and the operating system do in a sign-in (spec 01
 * device sign-in): open the URL the app asked for, sign in at Google as
 * `who`, and hand the `#app-callback` link of the server's page back to the
 * app as an open-url event. Returns that page, for a refusal.
 */
export async function browserSignIn(d: Desktop, who: FakeAccount): Promise<{ html: string; link: string | null }> {
  const url = await opened(d);
  (await fakeGoogle()).next(who);
  const page = await new TestBrowser().open(url);
  const link = appCallbackLink(page.html);
  if (link) await d.app.evaluate(({ app }, l) => app.emit('open-url', { preventDefault() {} }, l), link);
  return { html: page.html, link };
}
