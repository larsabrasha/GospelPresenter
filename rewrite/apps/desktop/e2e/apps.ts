import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, base, dataDir, port, events };
}
