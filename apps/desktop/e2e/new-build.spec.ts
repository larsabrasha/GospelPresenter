// A newer build on the host, taken quietly (apps/web/src/newBuild.ts; Lars, 2026-11-08): no line and no button; the
// next move to another page is followed by a reload into the newer build, never while the machine presents, and
// what the page left was typing is saved first.
import { networkInterfaces } from 'node:os';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { copyOfWebApp, launch, MUTED, testPort, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, endPresentation, openPresentations, openAdmin, pair, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

/** Marks the page, so a reload shows: the mark is gone. */
const markPage = (page: Page) => page.evaluate(() => Object.assign(window, { gpSamePage: true }));
const samePage = (page: Page) => page.evaluate(() => 'gpSamePage' in window);

/** Has the page ask the host now, as it does when the network comes back, and waits until it knows of the newer build. */
async function askHost(page: Page) {
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('html[data-newer-build]')).toHaveCount(1);
}

test('a newer build on the host loads after the next move to another page, and not while presenting', async () => {
  const web = copyOfWebApp();
  host = await launch({ env: { GP_WEB_ROOT: web.dir } });
  await setUpHost(host);
  const page = host.page;
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Härlig är jorden']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await expect(page.getByTestId('presentation-bar')).toBeVisible();

  web.mark('next');
  await askHost(page);
  await markPage(page);
  await openPresentations(page);
  await page.waitForTimeout(1_000); // past the reload's wait after a move (AFTER_MOVE_MS), which must not come
  expect(await samePage(page)).toBe(true);

  await page.getByRole('link', { name: /Söndag/ }).first().click();
  await endPresentation(page);
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible(); // ended: the page is no longer busy
  await openPresentations(page);
  await expect(page.locator('meta[name="gp-build"]')).toHaveAttribute('content', 'next');
  expect(await samePage(page)).toBe(false);
});

test('a field typed in on a tablet and left at once by a move keeps what was typed through the reload into the newer build', async () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  test.skip(!lan, 'this machine has no LAN address');
  const web = copyOfWebApp();
  const port = testPort();
  host = await launch({ lan: true, port, env: { GP_WEB_ROOT: web.dir } });
  await setUpHost(host);
  await createSong(host.page, 'Sparas', [['Verse 1', 'Ett']]);
  // A secure context, as a tablet over https is: its database in OPFS, whose worker ends as the page leaves.
  browser = await chromium.launch({ args: [...MUTED, `--unsafely-treat-insecure-origin-as-secure=http://${lan}:${port}`] });
  const tablet = await browser.newPage();
  await tablet.goto(`http://${lan}:${port}/`);
  await pair(host.page, tablet, 'Surfplattan');
  await expect(tablet.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await openAdmin(tablet, 'Sånger');
  await tablet.getByRole('link', { name: 'Sparas' }).click();
  web.mark('next');
  await askHost(tablet);

  // Left within the save's 500 ms: the editor closes and saves, then the reload.
  await tablet.getByLabel('Upphovspersoner').fill('Lina Sandell');
  await openAdmin(tablet, 'Bilder');
  await expect(tablet.locator('meta[name="gp-build"]')).toHaveAttribute('content', 'next');
  await expect(tablet.getByRole('navigation', { name: 'Administration' })).toBeVisible(); // the reloaded page has started

  await openAdmin(tablet, 'Sånger');
  await tablet.getByRole('link', { name: 'Sparas' }).click();
  await expect(tablet.getByLabel('Upphovspersoner')).toHaveValue('Lina Sandell');
});
