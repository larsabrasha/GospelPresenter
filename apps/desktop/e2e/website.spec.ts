// The pictures on gospelpresenter.com (website/, its carousel in website/src/carousel.js): eight views of the app, in
// Swedish and English, light and dark, desktop (1440×900) and phone (390×844), at twice the pixels, as WebP
// named `<view>_<lang>_<theme>_<viewport>.webp`. Not a test: it runs only with GP_WEBSITE set to the directory
// the pictures go to; `pnpm screenshots` writes them over website/src/screenshots.
// Every song and Bible text here is in the public domain.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { makeZip, utf8Encode } from '../../../packages/core/src/index.ts';
import { texts, type Language } from '../../web/src/i18n.ts';
import { launch, MUTED, type Desktop } from './apps.ts';
import { addSongs, backToSong, createOverlay, createPresentation, createSong, openAdmin, openArrangement, pair, pickItem, setUpHost } from './flows.ts';
import { sermonFile, sermonPdf } from './website-art.ts';

const out = process.env.GP_WEBSITE;
test.skip(!out, 'only with GP_WEBSITE=<directory>');

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
] as const;
const SCALE = 2;

interface Song {
  title: string;
  authors: string;
  parts: [string, string][];
}

/**
 * What a church in each language has: its songs, its Bible, its services and the search that finds several songs; and
 * what shows the features on today's service (Lars, 2026-11-26): its description, and on its third song (ARRANGED) an
 * arrangement with the chorus again at the end, a comment and an overlay.
 */
const CONTENT: Record<
  Language,
  { org: string; songs: Song[]; bible: [string, string, string[]]; services: [string, number][]; phones: string; search: string; description: string; comment: string; overlay: [string, string]; phone: string }
> = {
  sv: {
    org: 'Lilla Kyrkan',
    songs: [
      {
        title: 'Härlig är jorden',
        authors: 'B. S. Ingemann',
        parts: [
          ['Verse 1', 'Härlig är jorden,\nhärlig är Guds himmel,\nskön är själarnas pilgrimsgång.\nGenom de fagra riken på jorden\ngå vi till paradis med sång.'],
          ['Verse 2', 'Tider skola komma,\ntider skola försvinna,\nsläkten följa släktens gång.\nAldrig förstummas tonen från himlen\ni själens glada pilgrimssång.'],
        ],
      },
      {
        title: 'Tryggare kan ingen vara',
        authors: 'Lina Sandell',
        parts: [
          ['Verse 1', 'Tryggare kan ingen vara\nän Guds lilla barnaskara,\nstjärnan ej på himlafästet,\nfågeln ej i kända nästet.'],
          ['Verse 2', 'Herren sina trogna vårdar\nuti Sions helga gårdar;\növer dem han sig förbarmar,\nbär dem uti fadersarmar.'],
        ],
      },
      {
        title: 'O store Gud',
        authors: 'Carl Boberg',
        parts: [
          ['Verse 1', 'O store Gud, när jag den värld beskådar\nsom du har skapat med ditt allmaktsord,\nhur där din visdom väver livets trådar\noch alla väsen mättas vid ditt bord:'],
          ['Chorus', 'Då brister själen ut i lovsångsljud:\nO store Gud! O store Gud!'],
          ['Verse 2', 'När jag hör åskans röst och stormens susning\noch blixtens klingor springa fram ur sky,\nnär regnets kalla, friska vindar susa\noch löftets båge glänser ny:'],
        ],
      },
      {
        title: 'Blott en dag',
        authors: 'Lina Sandell',
        parts: [['Verse 1', 'Blott en dag, ett ögonblick i sänder,\nvilken tröst, vad än som kommer på!\nAllt ju vilar i min Faders händer,\nskulle jag, som barn, väl ängslas då?']],
      },
      {
        title: 'Den blomstertid nu kommer',
        authors: 'Israel Kolmodin',
        parts: [['Verse 1', 'Den blomstertid nu kommer\nmed lust och fägring stor:\ndu nalkas, ljuva sommar,\ndå gräs och gröda gror.']],
      },
    ],
    bible: [
      'Svenska 1917',
      'swe',
      [
        'I begynnelsen skapade Gud himmel och jord.',
        'En psalm av David. HERREN är min herde, mig skall intet fattas.',
        'Ty så älskade Gud världen, att han utgav sin enfödde Son, på det att var och en som tror på honom skall icke förgås, utan hava evigt liv.',
      ],
    ],
    services: [
      ['Bönekväll', -3],
      ['Ungdomsgudstjänst', -1],
      ['Konsert', 12],
      ['Familjegudstjänst', 0],
    ],
    phones: 'Mobiler',
    search: 'Gud',
    description: 'Med dop, och kyrkkaffe efteråt',
    phone: 'Annas mobil',
    comment: 'Kören sjunger med i sista refrängen',
    overlay: ['Kollekt', 'Swish 123 456 78 90'],
  },
  en: {
    org: 'Grace Chapel',
    songs: [
      {
        title: 'Abide With Me',
        authors: 'Henry F. Lyte',
        parts: [
          ['Verse 1', 'Abide with me; fast falls the eventide;\nThe darkness deepens; Lord, with me abide;\nWhen other helpers fail and comforts flee,\nHelp of the helpless, oh, abide with me.'],
          ['Verse 2', "Swift to its close ebbs out life's little day;\nEarth's joys grow dim, its glories pass away;\nChange and decay in all around I see;\nO Thou who changest not, abide with me."],
          ['Verse 3', "I need Thy presence every passing hour;\nWhat but Thy grace can foil the tempter's power?\nWho, like Thyself, my guide and stay can be?\nThrough cloud and sunshine, Lord, abide with me."],
        ],
      },
      {
        title: 'Amazing Grace',
        authors: 'John Newton',
        parts: [
          ['Verse 1', 'Amazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.'],
          ['Verse 2', "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed."],
        ],
      },
      {
        title: 'It Is Well with My Soul',
        authors: 'Horatio G. Spafford',
        parts: [
          ['Verse 1', 'When peace, like a river, attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.'],
          ['Chorus', 'It is well with my soul,\nIt is well, it is well with my soul.'],
          ['Verse 2', 'Though Satan should buffet, though trials should come,\nLet this blest assurance control,\nThat Christ hath regarded my helpless estate,\nAnd hath shed His own blood for my soul.'],
        ],
      },
      {
        title: 'Holy, Holy, Holy',
        authors: 'Reginald Heber',
        parts: [['Verse 1', 'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!']],
      },
      {
        title: 'Be Thou My Vision',
        authors: 'Mary E. Byrne',
        parts: [['Verse 1', 'Be Thou my vision, O Lord of my heart;\nNaught be all else to me, save that Thou art;\nThou my best thought, by day or by night,\nWaking or sleeping, Thy presence my light.']],
      },
    ],
    bible: [
      'King James Version',
      'eng',
      [
        'In the beginning God created the heaven and the earth.',
        'The LORD is my shepherd; I shall not want.',
        'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      ],
    ],
    services: [
      ['Prayer Meeting', -3],
      ['Youth Service', -1],
      ['Concert', 12],
      ['Family Service', 0],
    ],
    phones: 'Phones',
    search: 'grace',
    description: 'With a baptism, and coffee afterwards',
    phone: "Anne's phone",
    comment: 'The choir joins in on the last chorus',
    overlay: ['Offering', 'example.org/give'],
  },
};

// The 66 books, so the Bible tab lists them all; each holds one verse (the three above where they belong).
/** The song of today's service that has an arrangement, a comment and an overlay: its third, with a chorus. */
const ARRANGED = 2;
/** The sermon's slideshow, after the three songs. */
const SERMON = 3;

const BOOKS = (
  'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL ' +
  'MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'
).split(' ');

/** A DBL zip of the whole canon, a verse in each book. */
function bibleZip([name, iso, [gen, psa, jhn]]: [string, string, string[]]): Uint8Array {
  const verse = (code: string): [number, string] => (code === 'PSA' ? [23, psa!] : code === 'JHN' ? [3, jhn!] : [1, gen!]);
  const usx = (code: string) => {
    const [c, text] = verse(code);
    return `<?xml version="1.0" encoding="utf-8"?>\n<usx version="3.0">\n<book code="${code}" style="id">${name}</book>\n<chapter number="${c}" style="c" sid="${code} ${c}"/>\n<para style="p"><verse number="1" style="v" sid="${code} ${c}:1"/>${text}<verse eid="${code} ${c}:1"/></para>\n</usx>\n`;
  };
  const metadata = `<?xml version="1.0" encoding="utf-8"?>\n<DBLMetadata version="2.0"><identification><name>${name}</name><nameLocal>${name}</nameLocal><abbreviation>${name}</abbreviation></identification><language><iso>${iso}</iso></language></DBLMetadata>`;
  return makeZip([{ name: 'release/metadata.xml', data: utf8Encode(metadata) }, ...BOOKS.map((b) => ({ name: `release/USX_1/${b}.usx`, data: utf8Encode(usx(b)) }))]);
}

/** A date this many days from today, `YYYY-MM-DD`. */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let browser: Browser | undefined;
test.afterAll(async () => browser?.close());

/** A PNG as WebP at quality 85, encoded by Chromium (Playwright takes only PNG and JPEG). */
async function webp(png: Buffer): Promise<Buffer> {
  browser ??= await chromium.launch({ args: MUTED });
  const page = await browser.newPage();
  const encoded = await page.evaluate(async (src) => {
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })).arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, `data:image/png;base64,${png.toString('base64')}`);
  await page.close();
  return Buffer.from(encoded, 'base64');
}

for (const lang of ['sv', 'en'] as const) {
  test(`the website's pictures in ${lang}`, async () => {
    test.setTimeout(600_000);
    mkdirSync(out!, { recursive: true });
    const content = CONTENT[lang];
    const t = (key: keyof (typeof texts)['sv']) => texts[lang][key];
    const host: Desktop = await launch();
    let remote: Desktop | undefined;
    try {
      const page = host.page;
      // Filled in Swedish, as the steps in flows.ts are; shown in the language afterwards.
      await setUpHost(host, { name: lang === 'sv' ? 'Anna' : 'Anne', org: content.org, google: { sub: 'google-anna', email: 'anna@example.org', name: 'Anna' } });
      for (const [i, song] of content.songs.entries()) {
        await createSong(page, song.title, song.parts);
        await page.getByLabel('Upphovspersoner').fill(song.authors);
        await page.getByLabel('Upphovspersoner').blur();
        if (i !== ARRANGED) continue;
        // Its arrangement: the parts in their order, then the chorus again.
        await openArrangement(page);
        await page.getByRole('group', { name: 'Arrangemang' }).getByRole('button', { name: 'Lägg till Chorus' }).click();
        await backToSong(page);
      }
      await createOverlay(page, content.overlay[0], content.overlay[1]);
      // Its text put at the top left by Placering på sliden, clear of a song's lines (Lars, 2026-11-26), lined up to
      // the left, as far from the side as from the top; a part's label is at the top right.
      await page.getByRole('tab', { name: 'Ordna' }).filter({ visible: true }).click();
      await page.getByRole('radio', { name: 'Uppe till vänster' }).filter({ visible: true }).click();
      await expect(page.getByRole('radio', { name: 'Uppe till vänster' }).filter({ visible: true })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('saved')).toBeVisible();
      const overlayEditor = new URL(page.url()).pathname;
      // The built-in Blått, a picture behind the words, made the default: every slide in the pictures shows it, and a
      // church gets the same look in one tap (Lars, 2026-11-26).
      browser ??= await chromium.launch({ args: MUTED });
      await openAdmin(page, 'Teman');
      await page.getByRole('button', { name: 'Fler val för Blått' }).click();
      await page.getByRole('menuitem', { name: 'Använd som standard' }).click();
      await expect(page.getByRole('status').getByText('Standardtemat sparat')).toBeVisible();
      // A phone of the church's, paired with this computer, to control from (the remote picture).
      remote = await launch({ server: host.base });
      await pair(page, remote.page, content.phone);
      // Pairing let the network in; off again, so no picture's QR code holds this machine's address on it.
      await openAdmin(page, 'Enheter i nätverket');
      const lan = page.getByRole('switch', { name: 'Låt mobiler och skärmar ansluta' });
      if (await lan.isChecked()) await lan.click();
      await expect(lan).not.toBeChecked();
      await openAdmin(page, 'Biblar');
      await page.getByTestId('bible-file').setInputFiles({ name: 'bible.zip', mimeType: 'application/zip', buffer: Buffer.from(bibleZip(content.bible)) });
      await expect(page.getByTestId('bible-import-message')).toBeVisible();
      // A public output, for the view a phone in the pews follows.
      await page.goto(`${host.base}/admin/public-outputs`);
      await page.getByRole('button', { name: 'Skapa länk', exact: true }).first().click();
      await page.getByRole('dialog').last().getByLabel('Namn').fill(content.phones);
      await page.getByRole('dialog').last().getByRole('button', { name: 'Skapa' }).click();
      await page.getByRole('dialog', { name: content.phones }).getByRole('button', { name: 'Stäng' }).click();
      await page.getByRole('listitem', { name: content.phones }).getByRole('button', { name: 'Visa QR-kod' }).click();
      const watch = await page.getByRole('dialog').last().getByLabel('Länk').inputValue();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Stäng' }).click();
      // The services on the start page, two songs in each; the last, today's, holds three.
      for (const [name, offset] of content.services.slice(0, -1)) {
        await createPresentation(page, name, day(offset));
        await addSongs(
          page,
          content.songs.slice(3, 5).map((s) => s.title),
        );
      }
      const [today, offset] = content.services.at(-1)!;
      await createPresentation(page, today, day(offset));
      await addSongs(
        page,
        content.songs.slice(0, 3).map((s) => s.title),
      );
      // The sermon's slideshow after the songs, a PDF as a church exports one from PowerPoint or Keynote.
      await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Bildspel', exact: true }).click();
      const deck = page.getByRole('dialog', { name: 'Lägg till' });
      await deck.getByTestId('slides-file').setInputFiles({ name: sermonFile(lang), mimeType: 'application/pdf', buffer: await sermonPdf(browser, lang) });
      await expect(page.getByRole('status').getByText(`"${sermonFile(lang)}" har lagts till`)).toBeVisible({ timeout: 15_000 });
      await deck.getByRole('button', { name: 'Stäng' }).click();
      const presentation = new URL(page.url()).pathname;
      await page.getByRole('button', { name: 'Alternativ' }).click();
      await page.getByRole('menuitem', { name: 'Redigera detaljer' }).click();
      const details = page.getByRole('dialog', { name: 'Redigera detaljer' });
      await details.getByRole('textbox', { name: 'Beskrivning' }).fill(content.description);
      await details.getByRole('button', { name: 'Spara' }).click();
      const arranged = content.songs[ARRANGED]!.title;
      await pickItem(page, arranged);
      const itemMenu = page.getByTestId('live-slides').getByRole('button', { name: `Fler val för ${arranged}` });
      await itemMenu.click();
      await page.getByRole('menuitem', { name: /^Arrangemang/ }).click();
      await page.getByRole('menuitemradio', { name: 'Arrangemang 1' }).click();
      await itemMenu.click();
      await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
      await page.getByRole('menuitemradio', { name: content.overlay[0] }).click();
      await page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem').nth(ARRANGED).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Kommentar' }).click();
      await page.getByRole('dialog', { name: 'Kommentar' }).getByLabel('Kommentar').fill(content.comment);
      await page.getByRole('dialog', { name: 'Kommentar' }).getByRole('button', { name: 'Spara' }).click();
      await expect(page.getByRole('region', { name: arranged }).getByTestId('item-note')).toHaveText(content.comment);
      await page.evaluate((l) => localStorage.setItem('language', l), lang);

      // A phone shows the running order in one column, each item a row (Lars, 2026-11-26): there is no list to pick
      // from, and the first item is opened instead, so the picture shows its parts among the other rows.
      let phone = false;
      const openRow = async (p: Page, title: string) => {
        // Its name begins with the title; a comment and an overlay follow it.
        const name = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        const row = p.getByRole('region', { name: title }).getByRole('button', { name, expanded: false }).first();
        if (await row.count()) await row.click();
      };
      const openFirst = (p: Page) => openRow(p, content.songs[0]!.title);
      // The song with the arrangement, the comment and the overlay, so the picture shows them.
      const showArranged = async (p: Page) => {
        // By its place: its name now holds its comment and overlay too.
        if (!phone) await p.getByRole('list', { name: t('presentation.items') }).getByRole('listitem').nth(ARRANGED).getByRole('button').first().click();
        else await openRow(p, arranged);
      };
      const pickFirst = async (p: Page) => {
        if (!phone) await p.getByRole('list', { name: t('presentation.items') }).getByRole('button').first().click();
        else await openFirst(p);
      };
      const openAdd = async (p: Page, kind: string) => {
        await p.getByRole('button', { name: t('presentation.add'), exact: true }).click();
        // A menu on a computer; on a phone a sheet of buttons.
        const sheet = p.getByRole('dialog', { name: t('presentation.add') }).getByRole('button', { name: kind, exact: true });
        await p.getByRole('menuitem', { name: kind, exact: true }).or(sheet).click();
      };
      // Live, the first song's first slide shown; a phone presents in one column with every part in view.
      const goLive = async (p: Page) => {
        const start = p.getByRole('button', { name: t('presentation.start') });
        if (await start.count()) {
          await pickFirst(p);
          await start.click();
        }
        const [first] = content.songs;
        if (phone) {
          await openFirst(p);
          await p.getByRole('region', { name: first!.title }).getByRole('button', { name: first!.parts[0]![0] }).click();
        } else await p.getByRole('button', { name: `${first!.title} 1`, exact: true }).click();
        await livePictureSettled(p, first!.parts[0]![1].split('\n')[0]!);
      };
      // The live picture beside the slides (on a phone, over them) fades in out of a blur after its column slides in
      // (liveMotion.ts): taken only once it shows the slide, its fonts and pictures loaded, at rest and sharp.
      const livePictureSettled = async (p: Page, line: string) => {
        const picture = p.locator('[data-live-picture]:visible').first();
        await expect(picture).toContainText(line);
        await expect
          .poll(() =>
            picture.evaluate(async (el) => {
              await document.fonts.ready;
              await Promise.all([...el.querySelectorAll('img')].map((i) => i.decode().catch(() => undefined)));
              const moving = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
              await Promise.all(moving.map((a) => a.finished.catch(() => undefined)));
              const style = getComputedStyle(el);
              const sharp = style.filter === 'none' || style.filter === 'blur(0px)';
              const still = style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)';
              return style.opacity === '1' && sharp && still && moving.length === 0;
            }),
          )
          .toBe(true);
      };
      const stopLive = async (p: Page) => {
        await p.goto(host.base + presentation);
        const scope = phone ? p.getByTestId('phone-live') : p;
        await scope.getByRole('button', { name: t('live.end'), exact: true }).first().click();
        await p.getByRole('dialog', { name: t('live.end') }).getByRole('button', { name: t('live.end') }).click();
        await expect(p.getByRole('button', { name: t('presentation.start') })).toBeVisible(); // stopped before the next view
      };
      // On a phone a page of Inställningar shows alone; an open menu over it is closed by a tap beside it.
      const closeAdminMenu = async (p: Page) => {
        if (phone && (await p.locator('aside:visible').count())) await p.mouse.click(370, 400);
      };
      const views: [string, string, (p: Page) => Promise<unknown>][] = [
        ['home', '/', async () => {}],
        ['songs', '/admin/songs', closeAdminMenu],
        ['presentation', presentation, showArranged],
        [
          'slideshow',
          presentation,
          async (p) => {
            if (!phone) await p.getByRole('list', { name: t('presentation.items') }).getByRole('listitem').nth(SERMON).getByRole('button').first().click();
            else await openRow(p, sermonFile(lang));
          },
        ],
        [
          'add-song',
          presentation,
          async (p) => {
            await openAdd(p, t('add.song'));
            await p.getByLabel(t('presentation.searchSongs')).fill(content.search);
          },
        ],
        ['bible', presentation, (p) => openAdd(p, t('add.bible'))],
        [
          'overlay-editor',
          overlayEditor,
          async (p) => {
            await closeAdminMenu(p);
            if (phone) return;
            // Its text picked, so Format beside the slide shows its choices rather than a hint.
            await p.getByTestId('slide-canvas').locator('[data-element]').filter({ hasText: content.overlay[1] }).first().click();
            await expect(p.getByRole('radiogroup', { name: t('slideEditor.align') })).toBeVisible();
          },
        ],
        ['presentation-live', presentation, goLive],
        // Still live: Fjärrstyrning switched on, its QR code for whoever is to control from a phone.
        [
          'remote',
          presentation,
          async (p) => {
            await p.locator('[data-testid="remote-status"]:visible').first().click();
            const sheet = p.getByRole('dialog', { name: t('live.remote'), exact: true });
            await sheet.getByLabel(t('remote.allow')).check();
            const qr = sheet.getByRole('img', { name: t('remote.qr') });
            await expect(qr).toBeVisible();
            controlLink = (await qr.getAttribute('data-value'))!;
            // The code in the picture holds this machine's own address, never one on its network.
            expect(new URL(controlLink).origin).toBe(new URL(host.base).origin);
          },
        ],
      ];

      let controlLink = '';
      const cdp = await page.context().newCDPSession(page);
      const remotePage = remote.page;
      const remoteCdp = await remotePage.context().newCDPSession(remotePage);
      for (const theme of THEMES) {
        for (const [viewport, width, height] of VIEWPORTS) {
          await page.evaluate((th) => localStorage.setItem('theme', th), theme);
          // Twice the pixels, as a Retina screen, in the hidden window (Chromium's --force-device-scale-factor is not
          // heeded there).
          phone = viewport === 'mobile';
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
          // A Mac's and a phone's scroll bars show only while scrolling; the hidden window draws them always.
          await cdp.send('Emulation.setScrollbarsHidden', { hidden: true });
          const shoot = async (p: Page, name: string) => {
            await p.mouse.move(0, 0); // no hover, no tooltip
            // Not the room a Mac's window keeps for its three buttons (app.css `.mac-frame`): the buttons are drawn by
            // macOS, not in the picture, which showed an empty gap before ‹ (Lars, 2026-11-26); a phone has none.
            await p.evaluate(() => document.documentElement.classList.remove('mac-frame'));
            await p.waitForTimeout(300); // a step's animation starts a moment after the click
            // Every animation that ends has ended (the live picture fades in out of a blur); the background's run forever.
            await p.evaluate(() =>
              Promise.all(
                document
                  .getAnimations()
                  .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
                  .map((a) => a.finished.catch(() => undefined)),
              ),
            );
            writeFileSync(`${out}/${name}_${lang}_${theme}_${viewport}.webp`, await webp(await p.screenshot()));
          };
          for (const [name, path, act] of views) {
            await page.goto(host.base + path);
            await page.locator('[data-testid="me"]:visible, [data-testid="presentation-bar"]:visible').first().waitFor();
            await page.waitForTimeout(300); // the first render's fonts and pictures settle
            await act(page);
            await shoot(page, name);
          }
          // Fjärrstyrning's sheet, left open by the last picture, closed: it covers the page.
          const remoteSheet = page.getByRole('dialog', { name: t('live.remote'), exact: true });
          if (await remoteSheet.isVisible()) await remoteSheet.getByRole('button', { name: t('common.close'), exact: true }).first().click();
          await expect(remoteSheet).toHaveCount(0);
          // The phone that scanned the QR code, controlling what the computer presents.
          await remoteCdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
          await remoteCdp.send('Emulation.setScrollbarsHidden', { hidden: true });
          await remotePage.evaluate(([th, l]) => (localStorage.setItem('theme', th), localStorage.setItem('language', l)), [theme, lang] as const);
          const link = new URL(controlLink);
          await remotePage.goto(`${host.base}${link.pathname}${link.search}`);
          await livePictureSettled(remotePage, content.songs[0]!.parts[0]![1].split('\n')[0]!);
          await shoot(remotePage, 'control');
          // Still live: a phone in the pews that follows the public output. On a phone the outputs are in Visning's sheet.
          if (phone) await page.getByRole('button', { name: t('live.display'), exact: true }).click();
          const toggle = page.getByRole('list', { name: t('live.outputs') }).getByLabel(content.phones);
          await expect(toggle).toBeEnabled({ timeout: 10_000 });
          await toggle.check();
          if (phone) await page.getByRole('dialog', { name: t('live.display') }).getByRole('button', { name: t('common.close') }).click();
          const ctx = await (browser ??= await chromium.launch({ args: MUTED })).newContext({
            viewport: { width, height },
            deviceScaleFactor: SCALE,
            colorScheme: theme,
            locale: lang === 'sv' ? 'sv-SE' : 'en-GB',
          });
          const viewer = await ctx.newPage();
          await viewer.goto(watch);
          await viewer.getByTestId('watch-text').waitFor();
          await shoot(viewer, 'watch');
          await ctx.close();
          await stopLive(page);
        }
      }
    } finally {
      await remote?.app.close();
      await host.app.close();
    }
  });
}
