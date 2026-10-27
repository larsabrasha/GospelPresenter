// Screenshots of the app, every page, desktop and mobile, light and dark, to set
// beside the current app's (rewrite/scripts/capture-old-app.mjs). Not a test: it
// runs only with GP_CAPTURE set to the directory the pictures go to.
//   GP_CAPTURE=/tmp/new pnpm --filter @gp/desktop exec playwright test capture
import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, setUpHost } from './flows.ts';

const out = process.env.GP_CAPTURE;
test.skip(!out, 'only with GP_CAPTURE=<directory>');

let host: Desktop | undefined;
test.afterAll(async () => {
  await host?.app.close();
});

/** A date this many days from today, `YYYY-MM-DD`. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('capture every page', async () => {
  test.setTimeout(600_000);
  mkdirSync(out!, { recursive: true });
  host = await launch();
  const page = host.page;
  await setUpHost(host, { name: 'Anna', org: 'Foo Bar Kyrka', google: { sub: 'google-anna', email: 'anna@kyrkan.se', name: 'Anna' } });

  // Something on every list, as in the current app's mock data.
  await createSong(page, 'Blott en dag', [['Verse 1', 'Blott en dag, ett ögonblick i sänder']]);
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden, härlig är Guds himmel']]);
  for (const [name, offset] of [
    ['Bönekväll', -18],
    ['Söndagsgudstjänst', -7],
    ['Ungdomsgudstjänst', -1],
    ['Söndagsgudstjänst', 0],
    ['Familjegudstjänst', 6],
  ] as const)
    await createPresentation(page, name, day(offset));
  await createPresentation(page, 'Utan datum');
  await addSongs(page, ['Blott en dag', 'Härlig är jorden']);
  const presentation = new URL(page.url()).pathname;
  const song = await (async () => {
    await page.goto(`${host!.base}/admin/songs`);
    return (await page.getByRole('link', { name: 'Blott en dag' }).getAttribute('href'))!;
  })();

  const pages: [string, string][] = [
    ['home', '/'],
    ['presentation', presentation],
    ['trash', '/trash'],
    ['settings', '/settings'],
    ['profile', '/logins'],
    ['admin', '/admin'],
    ['songs', '/admin/songs'],
    ['song', song],
    ['images', '/admin/images'],
    ['audios', '/admin/audios'],
    ['bibles', '/admin/bibles'],
    ['overlays', '/admin/overlays'],
    ['themes', '/admin/themes'],
    ['users', '/admin/users'],
    ['devices', '/admin/devices'],
    ['displays', '/admin/displays'],
  ];
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => localStorage.setItem('theme', t), theme);
    for (const [vp, width, height] of [
      ['desktop', 1440, 900],
      ['mobile', 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const [name, path] of pages) {
        await page.goto(host.base + path);
        await page.getByTestId('me').waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/${name}_${theme}_${vp}.png` });
      }
    }
  }
});
