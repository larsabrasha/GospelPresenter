// Screenshots of the app, every page, desktop and mobile, light and dark, to set
// beside the current app's (rewrite/scripts/capture-old-app.mjs). Not a test: it
// runs only with GP_CAPTURE set to the directory the pictures go to.
//   GP_CAPTURE=/tmp/new pnpm --filter @gp/desktop exec playwright test capture
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sampleDblZip } from '../../../packages/core/test/bible-fixtures.ts';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

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

  // Something on every list, as in the current app's mock data: Familjegudstjänst holds the same two songs.
  // Blott en dag as in the current app's mock data: who wrote it, three parts, and an arrangement that repeats the chorus.
  await createSong(page, 'Blott en dag', [
    ['Verse 1', 'Blott en dag, ett ögonblick i sänder,\nVad det lyser mig på vägars gång!\nDet är nog, ty med din hand mig leder\nDu som känner mina svaghetsplag.'],
    ['Chorus', 'Ja, allt vad jag behöver dag för dagen,\nDet giver du mig, o Fader kär;\nVad sen skall hända, är i dina händer\nOch jag vet att du också är där.'],
    ['Verse 2', 'Morgondagen, hur den kommer, vet jag icke,\nMen jag vet att du är konung där.\nVad dig lyster låter du mig möta\nNär den dagen gryr i öster.'],
  ]);
  await page.getByLabel('Upphovspersoner').fill('Lina Sandell');
  await page.getByLabel('År').fill('1865');
  await page.getByLabel('År').blur();
  await page.getByRole('button', { name: 'Skapa arrangemang' }).click();
  await page.getByRole('group', { name: 'Arrangemang 1' }).getByRole('combobox', { name: 'Lägg till del' }).selectOption({ label: '2. Chorus' });
  await createSong(page, 'Härlig är jorden', [
    ['Verse 1', 'Härlig är jorden,\nHärlig är Guds himmel,\nSkön är själarnas pilgrimsgång.\nGenom de fagra riken på jorden\nGår vi till paradiset fram.'],
    ['Verse 2', 'Tidevarv komma,\nTidevarv försvinna,\nSläkten följa släktens gång.\nAldrig uppslocknar tonen från himlen\nI själens glada pilgrimssång.'],
    ['Verse 3', 'Änglar den sjöngo\nFörst för markens herdar;\nSkön var sången, ljuv och lång.\nFrid på vår jord nu!\nGud till oss sände\nHimmelens frid med Davids son.'],
  ]);
  await createSong(page, 'Tryggare kan ingen vara', [['Verse 1', 'Tryggare kan ingen vara,\nän Guds lilla barnaskara']]);
  await page.getByLabel('Upphovspersoner').fill('Lina Sandell');
  await page.getByLabel('Upphovspersoner').blur();
  // A Bible for the add dialog's second tab.
  await openAdmin(page, 'Biblar');
  await page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(page.getByTestId('bible-import-message')).toBeVisible();
  await createPresentation(page, 'Utan datum');
  for (const [name, offset] of [
    ['Bönekväll', -18],
    ['Söndagsgudstjänst', -7],
    ['Ungdomsgudstjänst', -1],
    ['Söndagsgudstjänst', 0],
    ['Familjegudstjänst', 6],
  ] as const)
    await createPresentation(page, name, day(offset));
  await addSongs(page, ['Härlig är jorden', 'Tryggare kan ingen vara']);
  const presentation = new URL(page.url()).pathname;
  const id = presentation.split('/').pop()!;
  const song = await (async () => {
    await page.goto(`${host!.base}/admin/songs`);
    return (await page.getByRole('link', { name: 'Blott en dag' }).getAttribute('href'))!;
  })();

  // Steps on a page before its picture, and after it; the names match capture-old-app.mjs.
  const pickItem = (p: Page) => p.getByRole('list', { name: 'Programpunkter' }).getByRole('button').first().click();
  const openAdd = async (p: Page, key?: string) => {
    await p.getByRole('button', { name: 'Lägg till', exact: true }).click();
    if (key) await p.keyboard.press(key);
  };
  const goLive = (p: Page) => p.getByRole('button', { name: 'Härlig är jorden 1' }).click();
  const stopLive = (p: Page) => p.getByRole('button', { name: 'Avsluta' }).click();
  // On a phone the admin menu covers the page at first; tap the dimmed page to close it.
  const closeAdminMenu = async (p: Page) => {
    if (p.viewportSize()!.width < 1024 && (await p.locator('aside:visible').count())) await p.mouse.click(370, 400);
    await p.waitForTimeout(400);
  };
  // Every scrolling box to its end, for what is below the first screen.
  const scrollDown = (p: Page) =>
    p.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const y = getComputedStyle(el).overflowY;
        if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
    });
  const pages: [string, string, ((p: Page) => Promise<unknown>)?, ((p: Page) => Promise<unknown>)?][] = [
    ['home', '/'],
    ['presentation', presentation],
    ['presentation-item', presentation, pickItem],
    [
      'add-songs',
      presentation,
      async (p) => {
        await openAdd(p);
        await p.getByLabel('Sök på titel, författare eller textrad').fill('a');
        await p.getByRole('dialog', { name: 'Lägg till' }).getByRole('list', { name: 'Sånger' }).getByRole('button').first().click();
      },
    ],
    ['add-bible', presentation, (p) => openAdd(p, 'Control+2')],
    ['add-images', presentation, (p) => openAdd(p, 'Control+3')],
    ['add-audio', presentation, (p) => openAdd(p, 'Control+4')],
    ['live', `/live/${id}`, goLive, stopLive],
    [
      'stage',
      `/live/${id}`,
      async (p) => {
        await goLive(p);
        await p.getByRole('button', { name: 'Scenläge' }).click();
      },
      async (p) => {
        await p.getByRole('button', { name: 'Lämna scenläge' }).click();
        await stopLive(p);
      },
    ],
    ['trash', '/trash'],
    ['settings', '/settings'],
    ['profile', '/logins'],
    ['admin', '/admin'],
    ['songs', '/admin/songs'],
    [
      'songs-search',
      '/admin/songs',
      async (p) => {
        await closeAdminMenu(p);
        await p.getByLabel('Sök', { exact: true }).fill('dag');
      },
    ],
    [
      'song-create',
      '/admin/songs',
      async (p) => {
        await closeAdminMenu(p);
        await p.getByRole('button', { name: 'Skapa', exact: true }).click();
      },
    ],
    ['song', song, closeAdminMenu],
    [
      'song-end',
      song,
      async (p) => {
        await closeAdminMenu(p);
        await scrollDown(p);
      },
    ],
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
      for (const [name, path, act, after] of pages) {
        await page.goto(host.base + path);
        await page.getByTestId('me').waitFor();
        await page.waitForTimeout(500);
        if (act) {
          await act(page);
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: `${out}/${name}_${theme}_${vp}.png` });
        await after?.(page);
      }
    }
  }
});
