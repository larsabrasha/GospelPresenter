// https on the LAN (README): the host serves the LAN over https with a
// certificate the operator provides. A device that trusts it is a secure
// context, so it keeps its database in OPFS through a reload, as a tablet's
// Safari should with the certificate installed, and a service worker keeps
// the page itself, so it starts again with the host gone.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { launch, testPort, type Desktop } from './apps.ts';
import { createSong, openAdmin, pair, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

const lan = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

/** A self-signed certificate for this machine's LAN address, and its key's SHA-256 (base64), which Chromium can be told to trust. */
function certificate(ip: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-cert-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=gospel-presenter-e2e', '-addext', `subjectAltName=IP:${ip}`,
  ], { stdio: 'ignore' });
  const spki = execFileSync('sh', ['-c', `openssl x509 -in '${cert}' -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`])
    .toString()
    .trim();
  return { key, cert, spki };
}

test('a device that trusts the host\'s certificate keeps its data through a reload, over https on the LAN', async () => {
  test.skip(!lan, 'this machine has no LAN address');
  const tls = certificate(lan!);
  const tlsPort = testPort();
  host = await launch({ lan: true, env: { GP_TLS_CERT: tls.cert, GP_TLS_KEY: tls.key, GP_TLS_PORT: String(tlsPort) } });
  await setUpHost(host);
  // Plain http is on this machine only now: the LAN gets https.
  expect(host.events.find((e) => e.event === 'ready')?.lan).toEqual(expect.arrayContaining([`https://${lan}:${tlsPort}`]));
  await expect(fetch(`http://${lan}:${host.port}/`)).rejects.toThrow();

  browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.spki}`] });
  const tablet = await browser.newPage();
  await tablet.goto(`https://${lan}:${tlsPort}/`);
  expect(await tablet.evaluate(() => isSecureContext)).toBe(true);
  await pair(host.page, tablet, 'Surfplattan');
  await expect(tablet.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 }); // no "only in memory"

  await createSong(host.page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);
  await openAdmin(tablet, 'Sånger');
  await expect(tablet.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible({ timeout: 5_000 });

  // Its database is a file in OPFS, not in memory, and it is still there after a reload.
  const opfs = () =>
    tablet.evaluate(async () => {
      const names: string[] = [];
      for await (const name of (await navigator.storage.getDirectory() as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
      return names;
    });
  expect(await opfs()).toEqual(expect.arrayContaining([expect.stringMatching(/^gp-.*\.db$/)]));
  await tablet.reload();
  await expect(tablet.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  expect(await opfs()).toEqual(expect.arrayContaining([expect.stringMatching(/^gp-.*\.db$/)]));
  await openAdmin(tablet, 'Sånger');
  await expect(tablet.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible();

  // The host goes away: the open page keeps working from its own copy.
  await host.app.close();
  host = undefined;
  await expect(tablet.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await expect(tablet.getByTestId('status')).not.toContainText('minnet');
  await tablet.getByRole('link', { name: 'Härlig är jorden' }).click();
  await expect(tablet.getByRole('heading', { name: 'Härlig är jorden' })).toBeVisible();
});

/** The app's caches on a page: one per build the service worker keeps. */
const appCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('gp-app-')));

/** Waits until a service worker controls the page, which it does once its cache is full. */
async function keptByWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
  return appCaches(page);
}

/** A copy of the built web app that looks like the next build: another index.html and another version in sw.js. */
function nextBuild() {
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  const dir = mkdtempSync(join(tmpdir(), 'gp-web-'));
  cpSync(web, dir, { recursive: true });
  const index = join(dir, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', '<head><meta name="gp-build" content="next" />'));
  const sw = join(dir, 'sw.js');
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(/"version":"[0-9a-f]+"/, '"version":"e2e0next0build00"'));
  return dir;
}

test('a device over https on the LAN starts the app with the host gone, and takes the host\'s next build', async () => {
  test.skip(!lan, 'this machine has no LAN address');
  const tls = certificate(lan!);
  const tlsPort = testPort();
  const port = testPort();
  const env = { GP_TLS_CERT: tls.cert, GP_TLS_KEY: tls.key, GP_TLS_PORT: String(tlsPort) };
  host = await launch({ lan: true, port, env });
  await setUpHost(host);
  const dataDir = host.dataDir;
  // The host's own window loads its page from its own server: no worker there.
  expect(await host.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

  browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${tls.spki}`] });
  const tablet = await browser.newPage();
  const app = `https://${lan}:${tlsPort}`;
  await tablet.goto(`${app}/`);
  await pair(host.page, tablet, 'Surfplattan');
  await expect(tablet.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  await createSong(host.page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);
  await openAdmin(tablet, 'Sånger');
  await expect(tablet.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible({ timeout: 5_000 });
  const first = await keptByWorker(tablet);
  expect(first).toHaveLength(1);

  // The host goes away; the tablet reloads, and opens another page of the app by its address.
  await host.app.close();
  host = undefined;
  await tablet.reload();
  await expect(tablet.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await expect(tablet.getByTestId('status')).not.toContainText('minnet');
  await tablet.getByRole('link', { name: 'Härlig är jorden' }).click();
  await expect(tablet.getByRole('heading', { name: 'Härlig är jorden' })).toBeVisible();
  await tablet.goto(`${app}/presentations`);
  await expect(tablet.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
  // The API is never answered from the kept copy.
  expect(await tablet.evaluate(() => fetch('/api/auth/state').then((r) => r.status, () => 'failed'))).toBe('failed');

  // The host comes back with its next build: a reload gets it at once, and the worker keeps it instead of the old one.
  host = await launch({ lan: true, port, dataDir, env: { ...env, GP_WEB_ROOT: nextBuild() } });
  await tablet.goto(`${app}/songs`);
  await expect(tablet.locator('meta[name="gp-build"]')).toHaveCount(1);
  await expect(tablet.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  await expect.poll(() => appCaches(tablet), { timeout: 15_000 }).toEqual(['gp-app-e2e0next0build00']);

  await host.app.close();
  host = undefined;
  await tablet.reload();
  await expect(tablet.locator('meta[name="gp-build"]')).toHaveCount(1);
  await expect(tablet.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await expect(tablet.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible();
});

test('GP_TLS=self-signed: the host makes its own certificate once and keeps it; a browser that accepts the warning gets in', async () => {
  test.skip(!lan, 'this machine has no LAN address');
  const tlsPort = testPort();
  const port = testPort();
  host = await launch({ lan: true, port, env: { GP_TLS: 'self-signed', GP_TLS_PORT: String(tlsPort) } });
  await setUpHost(host);
  const certFile = join(host.dataDir, 'tls', 'cert.pem');
  const first = readFileSync(certFile, 'utf8');
  expect(execFileSync('openssl', ['x509', '-in', certFile, '-noout', '-ext', 'subjectAltName']).toString()).toContain(`IP Address:${lan}`);

  // As a person who taps "visit the website anyway" in the warning.
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const tablet = await context.newPage();
  await tablet.goto(`https://${lan}:${tlsPort}/`);
  await pair(host.page, tablet, 'Surfplattan');
  await expect(tablet.getByTestId('status')).toContainText('Ansluten', { timeout: 10_000 });

  // A restart keeps the same certificate, so the device need not accept it again.
  const dataDir = host.dataDir;
  await host.app.close();
  host = await launch({ lan: true, port, dataDir, env: { GP_TLS: 'self-signed', GP_TLS_PORT: String(tlsPort) } });
  expect(readFileSync(certFile, 'utf8')).toBe(first);
});
