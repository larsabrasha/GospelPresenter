// https on the LAN (README): the host serves the LAN over https with a
// certificate the operator provides. A device that trusts it is a secure
// context, so it keeps its database in OPFS through a reload, as a tablet's
// Safari should with the certificate installed. The page itself still comes
// from the host: with the host gone it cannot be reloaded (no service worker).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong, pair, setUpHost } from './flows.ts';

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
  const tlsPort = 20_000 + Math.floor(Math.random() * 20_000);
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
  await tablet.getByRole('link', { name: 'Sånger' }).click();
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
  await tablet.getByRole('link', { name: 'Sånger' }).click();
  await expect(tablet.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible();

  // The host goes away: the open page keeps working from its own copy.
  await host.app.close();
  host = undefined;
  await expect(tablet.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await expect(tablet.getByTestId('status')).not.toContainText('minnet');
  await tablet.getByRole('link', { name: 'Härlig är jorden' }).click();
  await expect(tablet.getByRole('heading', { name: 'Härlig är jorden' })).toBeVisible();
});

test('GP_TLS=self-signed: the host makes its own certificate once and keeps it; a browser that accepts the warning gets in', async () => {
  test.skip(!lan, 'this machine has no LAN address');
  const tlsPort = 20_000 + Math.floor(Math.random() * 20_000);
  const port = 20_000 + Math.floor(Math.random() * 20_000);
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
