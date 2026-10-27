// Screenshots of the app, every page, desktop and mobile, light and dark, to set
// beside the current app's (rewrite/scripts/capture-old-app.mjs). Not a test: it
// runs only with GP_CAPTURE set to the directory the pictures go to.
//   GP_CAPTURE=/tmp/new pnpm --filter @gp/desktop exec playwright test capture
// GP_CAPTURE_ONLY=setup,login,… takes only the named pictures.
import { mkdirSync } from 'node:fs';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { sampleDblZip } from '../../../packages/core/test/bible-fixtures.ts';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, setUpHost, signOut } from './flows.ts';
import { solidPng } from './png.ts';
import { toneWav } from './wav.ts';

const out = process.env.GP_CAPTURE;
test.skip(!out, 'only with GP_CAPTURE=<directory>');
const only = process.env.GP_CAPTURE_ONLY?.split(',');
const wanted = (name: string) => !only || only.includes(name);

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
] as const;

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterAll(async () => {
  await browser?.close();
  await host?.app.close();
});

/** A page in a browser beside the app, as a TV or a phone would open one, in a theme and a size. */
async function beside(url: string, theme: string, width: number, height: number): Promise<Page> {
  browser ??= await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme as 'light' | 'dark' });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  const p = await ctx.newPage();
  await p.goto(url);
  return p;
}

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
  // First run, before anything else: the setup page (Setup.razor).
  if (wanted('setup')) {
    for (const theme of THEMES) {
      for (const [vp, width, height] of VIEWPORTS) {
        await page.evaluate((t) => localStorage.setItem('theme', t), theme);
        await page.setViewportSize({ width, height });
        await page.reload();
        await page.getByRole('heading', { name: 'Välkommen!' }).waitFor();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/setup_${theme}_${vp}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
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
  await page.getByRole('group', { name: 'Arrangemang 1' }).getByRole('combobox', { name: 'Lägg till del' }).click();
  await page.getByRole('group', { name: 'Arrangemang 1' }).getByRole('option', { name: '2. Chorus', exact: true }).click();
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
  // A picture and a sound, for Bilder's and Ljud's ⋯ menus.
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles({ name: 'Logotyp.png', mimeType: 'image/png', buffer: solidPng(1600, 900, [14, 165, 233]) });
  await expect(page.getByTestId('image-card')).toHaveCount(1);
  await openAdmin(page, 'Ljud');
  await page.getByTestId('audio-file').setInputFiles({ name: 'Preludium.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
  await expect(page.getByRole('list', { name: 'Ljud' }).getByRole('listitem')).toHaveCount(1);
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
  // The current app's mock overlays.
  for (const [title, content] of [
    ['Välkommen', 'Välkommen till Foo Bar Kyrka!'],
    ['Kollekt', 'Kollekt · Swish 123-456 78 90'],
    ['Fika', 'Fika serveras i källaren efter gudstjänsten'],
  ] as const) {
    await page.goto(`${host.base}/admin/overlays`);
    await page.getByRole('button', { name: 'Skapa', exact: true }).click();
    await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Titel').fill(title);
    await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Titel').press('Enter');
    await page.getByLabel('Textinnehåll').fill(content);
    await page.getByLabel('Textinnehåll').blur();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  const overlay = await (async () => {
    await page.goto(`${host!.base}/admin/overlays`);
    return (await page.getByRole('link', { name: /^Välkommen/ }).getAttribute('href'))!;
  })();

  // An invite for Eva, accepted at the host: its address is the invite page (InvitePage.razor).
  const invite = await (async () => {
    if (!wanted('invite')) return null;
    await openAdmin(page, 'Användare');
    await page.getByRole('button', { name: 'Skapa', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Skapa användare' });
    await create.getByLabel('Namn').fill('Eva');
    await create.getByLabel('E-post').fill('eva@kyrkan.se');
    await create.getByRole('button', { name: 'Skapa', exact: true }).click();
    await page.getByRole('button', { name: 'Logga in som Eva här' }).click();
    await page.getByRole('heading', { name: 'Välkommen Eva!' }).waitFor();
    const url = new URL(page.url());
    await page.goto(host!.base);
    await page.getByTestId('me').waitFor();
    return url.pathname + url.search + url.hash;
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
  // The admin pages' steps: the menu out of the way, then the first button of that name.
  const clickFirst = async (p: Page, name: string) => {
    await closeAdminMenu(p);
    await p.getByRole('button', { name, exact: true }).first().click();
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
    ['presentation-menu', presentation, (p) => p.getByRole('button', { name: 'Alternativ' }).click()],
    ['live', `/live/${id}`, goLive, stopLive],
    [
      'live-black',
      `/live/${id}`,
      async (p) => {
        await goLive(p);
        await p.getByRole('button', { name: 'Rensa' }).click();
        await p.getByRole('button', { name: 'Utgångar', exact: true }).scrollIntoViewIfNeeded();
      },
      stopLive,
    ],
    [
      'live-hints',
      `/live/${id}`,
      async (p) => {
        await goLive(p);
        for (const name of ['Overlays', 'Fjärrstyrning']) await p.getByRole('button', { name, exact: true }).click();
        for (const hint of await p.getByRole('button', { name: /^Förklaring: / }).all()) await hint.click();
        await p.getByRole('button', { name: 'Utgångar', exact: true }).scrollIntoViewIfNeeded();
      },
      stopLive,
    ],
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
      'song-label-menu',
      song,
      async (p) => {
        await closeAdminMenu(p);
        await p.getByRole('combobox', { name: 'Etikett' }).first().click();
      },
    ],
    [
      'song-end',
      song,
      async (p) => {
        await closeAdminMenu(p);
        await scrollDown(p);
      },
    ],
    ['images', '/admin/images', closeAdminMenu],
    ['images-menu', '/admin/images', (p) => clickFirst(p, 'Fler val för Logotyp.png')],
    ['audios', '/admin/audios', closeAdminMenu],
    ['audios-menu', '/admin/audios', (p) => clickFirst(p, 'Fler val för Preludium.wav')],
    ['bibles', '/admin/bibles', closeAdminMenu],
    ['overlays', '/admin/overlays', closeAdminMenu],
    ['overlay-create', '/admin/overlays', (p) => clickFirst(p, 'Skapa')],
    ['overlay', overlay, closeAdminMenu],
    ['themes', '/admin/themes', closeAdminMenu],
    [
      'themes-end',
      '/admin/themes',
      async (p) => {
        await closeAdminMenu(p);
        await scrollDown(p);
      },
    ],
    ['users', '/admin/users', closeAdminMenu],
    ['users-create', '/admin/users', (p) => clickFirst(p, 'Skapa')],
    ['devices', '/admin/devices', closeAdminMenu],
    ['displays', '/admin/displays', closeAdminMenu],
    [
      'displays-end',
      '/admin/displays',
      async (p) => {
        await closeAdminMenu(p);
        await scrollDown(p);
      },
    ],
    ['displays-add', '/admin/displays', (p) => clickFirst(p, 'Lägg till')],
    // One screen and one public output, made once, as capture-old-app.mjs makes them in the current app.
    [
      'displays-filled',
      '/admin/displays',
      async (p) => {
        await closeAdminMenu(p);
        for (const [add, name] of [
          ['Lägg till', 'Kyrksalen'],
          ['Skapa publik utgång', 'Mobiler'],
        ] as const) {
          if (await p.getByRole('listitem', { name }).count()) continue;
          await p.getByRole('button', { name: add, exact: true }).first().click();
          await p.getByRole('dialog').getByLabel('Namn').fill(name);
          await p.getByRole('dialog').getByRole('button', { name: 'Skapa' }).click();
          await p.getByRole('dialog', { name }).getByRole('button', { name: 'Stäng' }).click();
        }
      },
    ],
    ['displays-link', '/admin/displays', (p) => clickFirst(p, 'Visa länk')],
    ['displays-qr', '/admin/displays', (p) => clickFirst(p, 'Visa QR-kod')],
    // "Anslut tillfällig skärm" (PairingCodeDialog.razor), and after a TV beside it has been paired.
    [
      'pair-screen',
      `/live/${id}`,
      async (p) => {
        await goLive(p);
        await p.getByRole('button', { name: 'Anslut tillfällig skärm' }).click();
        await p.getByRole('img', { name: 'QR-kod för att ansluta en skärm' }).waitFor();
      },
      async (p) => {
        await p.getByRole('dialog', { name: 'Anslut tillfällig skärm' }).getByRole('button', { name: 'Avbryt' }).click();
        await stopLive(p);
      },
    ],
    [
      'pair-screen-done',
      `/live/${id}`,
      async (p) => {
        await goLive(p);
        await p.getByRole('button', { name: 'Anslut tillfällig skärm' }).click();
        const tv = await beside(`${host!.base}/display`, 'dark', 1440, 900);
        const code = (await tv.getByTestId('display-pin').textContent())!;
        await tv.context().close();
        const dialog = p.getByRole('dialog', { name: 'Anslut tillfällig skärm' });
        for (const [i, d] of [...code].entries()) await dialog.getByLabel(`Siffra ${i + 1}`).fill(d);
        await dialog.getByText('Skärmen är ansluten').waitFor();
      },
      async (p) => {
        await p.getByRole('dialog', { name: 'Anslut tillfällig skärm' }).getByRole('button', { name: 'Stäng' }).click();
        await stopLive(p);
      },
    ],
  ];
  // The saved screen's link and the public output's, read once both exist (displays-filled makes them).
  let links: { screen: string; watch: string } | undefined;
  const outputLinks = async () => {
    if (links) return links;
    await page.goto(`${host!.base}/admin/displays`);
    await closeAdminMenu(page);
    for (const [add, name] of [
      ['Lägg till', 'Kyrksalen'],
      ['Skapa publik utgång', 'Mobiler'],
    ] as const) {
      if (await page.getByRole('listitem', { name }).count()) continue;
      await page.getByRole('button', { name: add, exact: true }).first().click();
      await page.getByRole('dialog').getByLabel('Namn').fill(name);
      await page.getByRole('dialog').getByRole('button', { name: 'Skapa' }).click();
      await page.getByRole('dialog', { name }).getByRole('button', { name: 'Stäng' }).click();
    }
    await page.getByRole('button', { name: 'Visa länk', exact: true }).first().click();
    const screen = await page.getByRole('dialog').getByLabel('Länk').inputValue();
    await page.getByRole('dialog').getByRole('button', { name: 'Stäng' }).click();
    const watch = await page.getByLabel('Länk Mobiler').inputValue();
    return (links = { screen, watch });
  };
  const local = (url: string) => {
    const u = new URL(url);
    return u.pathname + u.search;
  };
  // Pages with no one signed in, in the app's own window: the invite, /display and /watch.
  const open: [string, () => Promise<string | null>, (p: Page) => Promise<unknown>][] = [
    ['invite', async () => invite, (p) => p.getByRole('heading', { name: 'Välkommen Eva!' }).waitFor()],
    ['invite-invalid', async () => '/invite#not-a-token', (p) => p.getByRole('heading', { name: 'Ogiltig eller redan använd inbjudan.' }).waitFor()],
    ['display', async () => '/display', (p) => p.getByTestId('display-pin').waitFor()],
    ['display-saved', async () => local((await outputLinks()).screen), (p) => p.getByTestId('display-idle').waitFor()],
    ['watch', async () => local((await outputLinks()).watch), (p) => p.getByTestId('watch-waiting').waitFor()],
  ];
  // Live with Välkommen over Härlig är jorden 1, then what a TV, a phone or the output window shows beside it.
  const liveWithOverlay = async (output?: string) => {
    await page.goto(`${host!.base}/live/${id}`);
    await goLive(page);
    if (output) {
      const toggle = page.getByRole('list', { name: 'Utgångar' }).getByLabel(output);
      await expect(toggle).toBeEnabled({ timeout: 10_000 });
      await toggle.check();
    }
    await page.getByRole('button', { name: 'Overlays', exact: true }).click();
    await page.getByRole('list', { name: 'Overlays' }).getByLabel('Välkommen').check();
  };
  const besideLive: [string, (theme: string, width: number, height: number) => Promise<Page>][] = [
    [
      'watch-slide',
      async (theme, width, height) => {
        await liveWithOverlay('Mobiler');
        const phone = await beside((await outputLinks()).watch, theme, width, height);
        await phone.getByTestId('watch-overlay').waitFor();
        return phone;
      },
    ],
    [
      'display-slide',
      async (theme, width, height) => {
        const tv = await beside((await outputLinks()).screen, theme, width, height);
        await tv.getByTestId('display-idle').waitFor();
        await liveWithOverlay('Kyrksalen');
        await tv.getByTestId('watch-overlay').waitFor();
        return tv;
      },
    ],
    [
      'output',
      async (_theme, width, height) => {
        await liveWithOverlay();
        const [output] = await Promise.all([host!.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
        await output.setViewportSize({ width, height });
        await output.getByTestId('slide-overlay').waitFor();
        return output;
      },
    ],
    ['pair', (theme, width, height) => beside(host!.base, theme, width, height).then(async (p) => (await p.getByRole('heading', { name: 'Anslut till värddatorn' }).waitFor(), p))],
  ];

  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem('theme', t), theme);
    for (const [vp, width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      for (const [name, path, act, after] of pages) {
        if (!wanted(name)) continue;
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
      for (const [name, path, ready] of open) {
        if (!wanted(name)) continue;
        const to = await path();
        if (!to) continue;
        await page.goto('about:blank'); // a new document, also when only the fragment differs
        await page.goto(host.base + to);
        await ready(page);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/${name}_${theme}_${vp}.png` });
      }
      for (const [name, show] of besideLive) {
        if (!wanted(name)) continue;
        const shot = await show(theme, width, height);
        await shot.waitForTimeout(800);
        await shot.screenshot({ path: `${out}/${name}_${theme}_${vp}.png` });
        if (shot !== page) {
          if (name === 'output') await shot.close();
          else await shot.context().close();
        }
        if (name !== 'pair') {
          await page.goto(`${host.base}/live/${id}`);
          await stopLive(page);
        }
      }
    }
  }
  // Last, signed out: the sign-in page (Login.razor).
  if (wanted('login')) {
    await page.goto(host.base);
    await signOut(page);
    await page.getByRole('heading', { name: 'Logga in' }).waitFor(); // forgotten here before the reload
    for (const theme of THEMES) {
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      for (const [vp, width, height] of VIEWPORTS) {
        await page.setViewportSize({ width, height });
        await page.reload();
        await page.getByRole('heading', { name: 'Logga in' }).waitFor();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/login_${theme}_${vp}.png` });
      }
    }
  }
});
