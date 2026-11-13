// Starts the desktop app (Electron under xvfb-run, or plain Node), then plays a
// tablet on the LAN: a wa-sqlite client that syncs with the desktop's embedded
// server over its LAN address, never localhost.
//   node dist/lan-check.mjs electron | node
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { SyncClient, httpTransport } from '@spike/client';
import { openWaSqlite } from '@spike/client/wa-sqlite';

const mode = process.argv[2] === 'node' ? 'node' : 'electron';
const dist = fileURLToPath(new URL('.', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'gp-lan-'));
const [cmd, args] =
  mode === 'electron'
    ? ['xvfb-run', ['-a', electronPath as unknown as string, '--no-sandbox', join(dist, 'main.mjs')]]
    : [process.execPath, [join(dist, 'node-main.mjs')]];

// Its own process group, so xvfb-run, Xvfb and every Electron process stop together.
const child = spawn(cmd, args, { env: { ...process.env, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const events: Record<string, Record<string, unknown>> = {};
const waiters: Record<string, (e: Record<string, unknown>) => void> = {};
createInterface({ input: child.stdout }).on('line', (line) => {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return; // Electron and Chromium chatter
  }
  const name = String(e.event);
  events[name] = e;
  waiters[name]?.(e);
});
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));

function next(name: string, timeoutMs: number): Promise<Record<string, unknown>> {
  if (events[name]) return Promise.resolve(events[name]!);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no "${name}" within ${timeoutMs} ms\n${stderr.slice(-2000)}`)), timeoutMs);
    waiters[name] = (e) => {
      clearTimeout(t);
      resolve(e);
    };
  });
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number) {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
  return performance.now() - start;
}

let ok = false;
try {
  const ready = await next('ready', 90_000);
  const lanUrl = String(ready.lanUrl);
  const org = String(ready.org);
  if (/127\.0\.0\.1|localhost/.test(lanUrl)) throw new Error(`not a LAN address: ${lanUrl}`);

  const tablet = await SyncClient.open(await openWaSqlite(), {
    transport: httpTransport({ baseUrl: lanUrl, token: 'tablet', org }),
    ctx: { userId: 'tablet', role: 'editor' },
  });
  await tablet.listen(`${lanUrl.replace('http', 'ws')}/sync/poke?token=tablet&org=${org}`);

  let start = performance.now();
  await tablet.mutate('createSong', { id: 'S1', title: 'Amazing Grace' });
  await tablet.mutate('createPresentation', { id: 'LAN-P', name: 'Made on the tablet' });
  await tablet.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'LAN-P', songId: 'S1' });
  await tablet.push();
  await next('desktop-saw', 10_000);
  const tabletToDesktop = performance.now() - start;

  start = performance.now();
  await waitFor(async () => (await tablet.dump()).presentations[0]?.name === 'Renamed on the desktop', 10_000);
  const desktopToTablet = performance.now() - start;

  const desktopDump = (await next('desktop-dump', 10_000)).dump;
  const server = await (
    await fetch(`${lanUrl}/debug/dump`, { headers: { authorization: 'Bearer tablet', 'x-org': org } })
  ).json() as { tables: unknown };
  const same =
    JSON.stringify(await tablet.dump()) === JSON.stringify(server.tables) &&
    JSON.stringify(desktopDump) === JSON.stringify(server.tables);
  if (mode === 'electron') await next('window', 10_000);
  console.log(
    JSON.stringify(
      {
        mode,
        runtime: ready.runtime,
        driver: ready.driver,
        desktopNode: ready.node,
        lanUrl,
        tabletToDesktopMs: Math.round(tabletToDesktop),
        desktopToTabletMs: Math.round(desktopToTablet),
        convergedByteForByte: same,
        window: events.window ?? null,
      },
      null,
      2,
    ),
  );
  await tablet.close();
  ok = same;
} catch (e) {
  console.error('LAN check failed:', (e as Error).message);
} finally {
  try {
    process.kill(-child.pid!, 'SIGTERM');
  } catch {
    // already gone
  }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
