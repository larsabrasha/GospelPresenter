// The browser check (browser/worker.js): the Rust core and the TS core in a Web Worker over wa-sqlite, in memory and
// on OPFS. In Chromium (a hidden Electron, its background throttling off) or WebKit (Safari's engine, Playwright's);
// `runs` (JSON) may name other runs. Prints what each says.
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const [root, engine = 'chromium', runs] = process.argv.slice(2);
const desktop = createRequire(join(root, 'apps/desktop/package.json'));
const { _electron, webkit } = desktop('@playwright/test');
const dir = join(here, '.out/browser');
const query = runs ? `?runs=${encodeURIComponent(runs)}` : '';

async function page() {
  if (engine === 'chromium') {
    const app = await _electron.launch({ executablePath: desktop('electron'), args: [join(here, 'browser/electron-main.cjs')], env: { ...process.env, GP_CHECK_DIR: dir, GP_CHECK_QUERY: query } });
    return { page: await app.firstWindow(), close: () => app.close() };
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = join(dir, path === '/' ? 'index.html' : decodeURIComponent(path));
    try {
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // A profile of its own on disk: a passing one (Playwright's default, as a private window) has no OPFS.
  const profile = await mkdtemp(join(tmpdir(), 'gp-webkit-'));
  const context = await webkit.launchPersistentContext(profile);
  const p = context.pages()[0] ?? (await context.newPage());
  await p.goto(`http://localhost:${server.address().port}/${query}`);
  return { page: p, close: async () => (await context.close(), server.close(), await rm(profile, { recursive: true, force: true })) };
}

const { page: p, close } = await page();
await p.waitForFunction(() => document.title === 'done', null, { timeout: 30 * 60_000, polling: 1000 });
console.log((await p.locator('pre').allTextContents()).map((t) => t.trim()).join('\n\n'));
console.log(`engine: ${await p.evaluate(() => navigator.userAgent)}`);
await close();
