// How quickly a tablet over plain http answers while it fetches a large file
// in the background. Without Web Crypto it hashes on the same thread as the
// database answers the page, so the hash must give the thread back.
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { PROTOCOL_VERSION } from '../../../packages/core/src/protocol.ts';
import { SCHEMA_VERSION } from '../../../packages/core/src/schema.ts';
import { launch, type Desktop } from './apps.ts';
import { highlight, makeZip, searchSongs, utf8Encode } from '../../../packages/core/src/index.ts';
import { addSongs, allowRemote, createPresentation, createSong, openAdmin, openPresentations, pair, pickItem, setUpHost } from './flows.ts';
import { toneWav } from './wav.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

test('"Ta kontroll" opens in well under a second while a 19 MB audio file is still being fetched and checked', async () => {
  // The file is fetched because the tablet opened the presentation in the editor just before.
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  test.skip(!lan, 'this machine has no LAN address');
  host = await launch({ lan: true });
  await setUpHost(host);
  browser = await chromium.launch();
  const phone = await browser.newPage();
  // A tablet is slower than this machine.
  await (await phone.context().newCDPSession(phone)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await phone.goto(`http://${lan}:${host.port}/`);
  await pair(host.page, phone, 'Surfplattan');
  await expect(phone.getByTestId('status')).toContainText('Synkad', { timeout: 10_000 });
  // Plain http has no OPFS: unlike the host's own window, in memory by design, the tablet says so.
  await expect(phone.getByTestId('sync-warnings')).toContainText('Data sparas bara i minnet');

  const page = host.page;
  await openAdmin(page, 'Ljud');
  await page.getByTestId('audio-file').setInputFiles({ name: 'Lång.wav', mimeType: 'audio/wav', buffer: toneWav(1200) });
  await expect(page.getByRole('heading', { name: 'Alla ljudfiler (1)' })).toBeVisible({ timeout: 20_000 });
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.keyboard.press('Control+4');
  await page.getByRole('dialog', { name: 'Lägg till' }).getByRole('button', { name: 'Lång.wav', exact: true }).click();
  await page.getByRole('dialog', { name: 'Lägg till' }).getByRole('button', { name: 'Lägg till Lång.wav' }).click();
  await page.getByRole('dialog', { name: 'Lägg till' }).getByRole('button', { name: 'Stäng' }).click();
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await allowRemote(page);

  await openPresentations(phone);
  const take = phone.getByRole('list', { name: 'Visas just nu' }).getByRole('link', { name: 'Ta kontroll' });
  await take.waitFor({ timeout: 10_000 });
  // Opening it in the editor has the tablet fetch its audio (a remote control alone would not); then straight to control.
  await phone.getByRole('link', { name: 'Söndag' }).click();
  await expect(phone.getByTestId('media-ready')).toBeVisible();
  await phone.goBack();
  const started = Date.now();
  await take.click();
  await phone.getByTestId('live-panel').waitFor({ timeout: 30_000 });
  // About 830 ms when the hash held the thread, about 125 ms since it gives it back.
  expect(Date.now() - started).toBeLessThan(500);
});

/**
 * Pushes mutations straight into the server, as another device would, in
 * batches; the page gets them in its next pull. `markStart` sets `gpStart`
 * just before, for `syncOne`.
 */
async function push(page: Page, mutations: { name: string; v: number; args: unknown }[], clientId = `perf-seed-${Date.now()}`, markStart = false) {
  const numbered = mutations.map((m, i) => ({ id: i + 1, ...m }));
  await page.evaluate(
    async ({ all, protocol, schemaVersion, id, mark }) => {
      if (mark) window.gpStart = performance.now();
      const session = JSON.parse(localStorage.getItem('gp.session')!) as { token: string };
      const device = JSON.parse(localStorage.getItem('gp.device') ?? 'null') as string | null;
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, ...(device ? { 'x-gp-device': device } : {}) };
      for (let at = 0; at < all.length; at += 1000) {
        const res = await fetch('/api/sync/push', { method: 'POST', headers, body: JSON.stringify({ protocol, schemaVersion, clientId: id, mutations: all.slice(at, at + 1000) }) });
        if (!res.ok) throw new Error(`push ${res.status}: ${await res.text()}`);
      }
    },
    { all: numbered, protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, id: clientId, mark: markStart },
  );
}

const words = ['Herre', 'Jesus', 'nåd', 'ljus', 'frid', 'himmel', 'kärlek', 'tro', 'hopp', 'sång', 'jord', 'Gud', 'helig', 'stjärna', 'morgon', 'kväll', 'väg', 'hjärta', 'evig', 'glädje'];
const word = (i: number, k: number) => words[(i * 7 + k * 13 + k * k * 3) % words.length]!;
const line = (i: number, k: number) => `${word(i, k)} och ${word(i, k + 1)} över ${word(i, k + 2)} i ${word(i, k + 3)}s ${word(i, k + 4)}`;
/** The name of seeded song `i`. */
const songName = (i: number) => `${word(i, 0)} ${word(i, 1)} ${i}`;

/**
 * `n` songs, each with five parts of four lines, about as long as a hymn,
 * pushed straight into the server.
 */
async function seedSongs(page: Page, n: number) {
  const mutations = [];
  for (const song of library(n)) {
    mutations.push({ name: 'createSong', v: 1, args: { id: song.id, name: song.name, author: song.author } });
    for (const [k, content] of song.parts.entries())
      mutations.push({ name: 'addSongPart', v: 1, args: { id: `${song.id}-${k + 1}`, songId: song.id, labelText: k === 4 ? 'Chorus' : `Verse ${k + 1}`, content } });
  }
  await push(page, mutations);
}

/** The songs `seedSongs` makes. */
function library(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `perf-${i}`,
    name: songName(i),
    author: `Författare ${i % 97}`,
    parts: [1, 2, 3, 4, 5].map((k) => [0, 1, 2, 3].map((l) => line(i, k * 4 + l)).join('\n')),
  }));
}

/**
 * `n` presentations, a week apart from today backwards, each with five
 * songs; the first, "Perf 30", today, with `items` songs.
 */
async function seedPresentations(page: Page, n: number, items: number) {
  const today = new Date();
  const mutations = [];
  for (let p = 0; p < n; p++) {
    const id = `perf-p${p}`;
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 * p).toLocaleDateString('sv-SE');
    mutations.push({ name: 'createPresentation', v: 1, args: { id, name: p === 0 ? 'Perf 30' : `Gudstjänst ${p}`, eventDate: date } });
    for (let i = 0; i < (p === 0 ? items : 5); i++)
      mutations.push({ name: 'addSongToPresentation', v: 1, args: { itemId: `${id}-i${i}`, presentationId: id, songId: `perf-${(p * 31 + i) % 3000}` } });
  }
  await push(page, mutations);
}

/** Chapters per book of the Protestant canon, in order. */
const CHAPTERS: [string, number][] = Object.entries({
  GEN: 50, EXO: 40, LEV: 27, NUM: 36, DEU: 34, JOS: 24, JDG: 21, RUT: 4, '1SA': 31, '2SA': 24, '1KI': 22, '2KI': 25, '1CH': 29, '2CH': 36, EZR: 10, NEH: 13, EST: 10,
  JOB: 42, PSA: 150, PRO: 31, ECC: 12, SNG: 8, ISA: 66, JER: 52, LAM: 5, EZK: 48, DAN: 12, HOS: 14, JOL: 3, AMO: 9, OBA: 1, JON: 4, MIC: 7, NAM: 3, HAB: 3,
  ZEP: 3, HAG: 2, ZEC: 14, MAL: 4, MAT: 28, MRK: 16, LUK: 24, JHN: 21, ACT: 28, ROM: 16, '1CO': 16, '2CO': 13, GAL: 6, EPH: 6, PHP: 4, COL: 4, '1TH': 5,
  '2TH': 3, '1TI': 6, '2TI': 4, TIT: 3, PHM: 1, HEB: 13, JAS: 5, '1PE': 5, '2PE': 3, '1JN': 5, '2JN': 1, '3JN': 1, JUD: 1, REV: 22,
});

/** A whole Bible as a DBL zip: every book and chapter, 26 verses a chapter (about 31 000 verses, as a real one). */
function fullBibleZip(): Uint8Array {
  const verse = (b: string, c: number, v: number) => `${b} ${c}:${v} ${line(c * 31 + v, v)}, ${line(v, c)}.`;
  const usx = (code: string, chapters: number) => {
    let body = '';
    for (let c = 1; c <= chapters; c++) {
      body += `<chapter number="${c}" style="c" sid="${code} ${c}"/>\n<para style="p">`;
      for (let v = 1; v <= 26; v++) body += `<verse number="${v}" style="v" sid="${code} ${c}:${v}"/>${verse(code, c, v)}<verse eid="${code} ${c}:${v}"/>`;
      body += '</para>\n';
    }
    return `<?xml version="1.0" encoding="utf-8"?>\n<usx version="3.0">\n<book code="${code}" style="id">Perf</book>\n${body}</usx>\n`;
  };
  const metadata = `<?xml version="1.0" encoding="utf-8"?>
<DBLMetadata version="2.0"><identification><name>Perf Bible</name><nameLocal>Prestandabibeln</nameLocal>
<abbreviation>PERF</abbreviation><abbreviationLocal>PERF</abbreviationLocal></identification>
<language><iso>swe</iso><name>Swedish</name></language></DBLMetadata>`;
  return makeZip([
    { name: 'release/metadata.xml', data: utf8Encode(metadata) },
    ...CHAPTERS.map(([code, n]) => ({ name: `release/USX_1/${code}.usx`, data: utf8Encode(usx(code, n)) })),
  ]);
}

/**
 * Helpers in the page, put there again after every load: `gpArm(cond)` starts
 * watching the DOM, and `gpDone` resolves with the time `cond()` first held,
 * after the layout. `gpKeyAt` is when the last key went down, so a real key
 * press (Playwright's) is timed from its own event.
 */
function pageHelpers() {
  const until = (cond: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      if (cond()) return resolve();
      const mo = new MutationObserver(() => {
        if (!cond()) return;
        mo.disconnect();
        clearTimeout(timer);
        resolve();
      });
      // A condition that never holds fails the test, rather than its timeout.
      const timer = setTimeout(() => (mo.disconnect(), reject(new Error(`never held: ${cond.toString()}`))), 30_000);
      mo.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  window.gpArm = (cond) => {
    window.gpDone = until(cond).then(() => {
      void document.body.offsetHeight;
      return performance.now();
    });
  };
  window.gpGo = (cond, action) => {
    window.gpArm(cond);
    window.gpStart = performance.now();
    void action();
  };
  addEventListener('keydown', () => (window.gpKeyAt = performance.now()), { capture: true });
}

declare global {
  interface Window {
    gpArm: (cond: () => boolean) => void;
    gpDone: Promise<number>;
    gpKeyAt: number;
    gpGo: (cond: () => boolean, action: () => unknown) => void;
    gpStart: number;
  }
}

/** The median of `runs` runs of `once`, in ms. */
async function median(runs: number, once: () => Promise<number>): Promise<number> {
  const all: number[] = [];
  for (let i = 0; i < runs; i++) all.push(await once());
  return Math.round(all.toSorted((a, b) => a - b)[Math.floor(runs / 2)]!);
}

/** Presses `key` and times it from its keydown in the page until what `arm` (a page function calling `gpArm`) waits for. */
async function timeKeyPress<A>(page: Page, key: string, arm: (arg: A) => void, arg: A): Promise<number> {
  await page.evaluate(arm as (arg: unknown) => void, arg);
  await page.keyboard.press(key);
  return page.evaluate(async () => (await window.gpDone) - window.gpKeyAt);
}

/** Runs `act` in the page, a page function that calls `gpGo(cond, action)`, and times the action until `cond` holds. */
async function timeInPage<A>(page: Page, act: (arg: A) => void, arg: A): Promise<number> {
  await page.evaluate(act as (arg: unknown) => void, arg);
  return page.evaluate(async () => (await window.gpDone) - window.gpStart);
}

/**
 * Types one key into the add dialog's song search and measures, in the page,
 * how long until the list shows the hits of what was typed, `expected` (the
 * first names, how many, and the first one's marked words), and the browser
 * has laid it out: `screen`, once the first rows are right (what a screen
 * holds: the list draws a long one in steps), and `all`, once every hit is
 * there. Paint is not counted (the test windows are hidden).
 */
async function timeKey(page: Page, value: string, expected: { first: string[]; count: number; marked: string[] }): Promise<{ screen: number; all: number }> {
  return page.evaluate(
    async ({ typed, want }) => {
      const dialog = document.querySelector('[role="dialog"]')!;
      const input = dialog.querySelector<HTMLInputElement>('input[aria-label="Sök på titel, författare eller textrad"]')!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const shown = (screen: boolean) => {
        const items = [...dialog.querySelectorAll('ul[aria-label="Sånger"] > li')];
        const names = items.slice(0, want.first.length).map((li) => li.querySelector('span')?.textContent ?? '');
        const marked = [...(items[0]?.querySelector('span')?.querySelectorAll('mark') ?? [])].map((m) => m.textContent);
        const count = screen ? items.length >= Math.min(want.count, 20) && items.length <= want.count : items.length === want.count;
        return count && names.join('|') === want.first.join('|') && marked.join('|') === want.marked.join('|');
      };
      /** Resolves with the time `shown(screen)` first holds, after the layout. */
      const when = (screen: boolean) =>
        new Promise<number>((resolve) => {
          const done = () => {
            void (dialog as HTMLElement).offsetHeight; // the layout of the new list
            resolve(performance.now());
          };
          const mo = new MutationObserver(() => {
            if (!shown(screen)) return;
            mo.disconnect();
            done();
          });
          mo.observe(dialog, { childList: true, subtree: true, characterData: true, attributes: true });
        });
      const screen = when(true);
      const all = when(false);
      const start = performance.now();
      setValue.call(input, typed);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { screen: (await screen) - start, all: (await all) - start };
    },
    { typed: value, want: expected },
  );
}

/** Scrolls the add dialog's song list through `steps` positions, laying it out at each; the mean ms per step. */
async function timeScroll(page: Page, steps: number): Promise<number> {
  return page.evaluate(async (n) => {
    const list = document.querySelector<HTMLElement>('[role="dialog"] ul[aria-label="Sånger"]')!;
    const start = performance.now();
    for (let i = 1; i <= n; i++) {
      list.scrollTop = (list.scrollHeight * i) / n;
      void list.offsetHeight;
      list.querySelectorAll('li')[Math.floor((list.querySelectorAll('li').length * i) / n) - 1]?.getBoundingClientRect();
      await new Promise((r) => setTimeout(r, 0));
    }
    return (performance.now() - start) / n;
  }, steps);
}

test('the add dialog\'s song list with 3 000 songs: a keystroke and a scroll step, measured', async () => {
  test.setTimeout(120_000);
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  await seedSongs(page, 3000);
  await openAdmin(page, 'Sånger');
  await expect(page.getByText('Alla sånger (3000)')).toBeVisible({ timeout: 30_000 });
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await expect(picker.getByRole('list', { name: 'Sånger' }).getByRole('listitem')).toHaveCount(3000, { timeout: 10_000 });
  // The worker prepares the search texts a second after the songs arrive; a person takes longer than this to start typing.
  await page.waitForTimeout(1500);

  // What the list must show after each key: the search over the same songs, in library order (as the list sorts).
  const songs = library(3000)
    .map((s) => ({ ...s, firstPart: s.parts[0]!, lyrics: s.parts.join('\n') }))
    .toSorted((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }));
  const run = async () => {
    // From all 3 000 down a word, letter by letter, then back to all of them.
    const keys = ['h', 'he', 'her', 'herr', 'herre', 'herr', 'her', 'he', 'h', ''];
    const keystrokes: { screen: number; all: number }[] = [];
    for (const k of keys) {
      const hits = searchSongs(songs, k);
      const marked = highlight(hits[0]?.name ?? '', k).filter((p) => p.hit).map((p) => p.text);
      keystrokes.push(await timeKey(page, k, { first: hits.slice(0, 20).map((h) => h.name), count: hits.length, marked }));
    }
    return {
      keystrokes: keystrokes.map((t) => Math.round(t.screen)),
      wholeList: keystrokes.map((t) => Math.round(t.all)),
      scrollStep: Math.round(await timeScroll(page, 30)),
    };
  };
  const normal = await run();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await run();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`3000 songs, ms per keystroke until the first rows are right (h … herre … empty): ${normal.keystrokes.join(', ')}; per scroll step: ${normal.scrollStep}`);
  console.log(`  until every hit is in the list: ${normal.wholeList.join(', ')}`);
  console.log(`the same, CPU 4x slower: ${slow.keystrokes.join(', ')}; per scroll step: ${slow.scrollStep}`);
  console.log(`  until every hit is in the list: ${slow.wholeList.join(', ')}`);
  test.info().annotations.push({ type: 'measured', description: JSON.stringify({ normal, slow }) });
  // About 2-3 times what was measured on 2026-10-30 (docs/performance.md): a slowdown shows, a busy machine does not fail it.
  expect(Math.max(...normal.keystrokes)).toBeLessThan(250);
  expect(Math.max(...slow.keystrokes)).toBeLessThan(900);
  expect(Math.max(...normal.wholeList)).toBeLessThan(500);
  expect(normal.scrollStep).toBeLessThan(20);
  expect(slow.scrollStep).toBeLessThan(50);
});

/** A link or button by its text or label, in the page. */
function byName(selector: string, name: string, root: ParentNode = document): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(selector)].find((e) => e.getAttribute('aria-label') === name || e.textContent?.trim() === name);
}
declare global {
  interface Window {
    gpByName: typeof byName;
  }
}

/** The flows measured, each a median in ms. */
interface Flows {
  /** The start page from another page, until its list shows. */
  startPage: number;
  /** A reload of the start page, from the navigation's start until its list shows: the window's start. */
  startReload: number;
  /** A reload of Sånger, until it shows 3 000 songs. */
  songsReload: number;
  /** A presentation of 30 songs (and those `syncOne` added) opened from the start page, until its running order and the first item's slides show. */
  openPresentation: number;
  /** ↓ in the editor, until the next item's slides show. */
  changeItem: number;
  /** → on the live page, until the next slide is the one shown. */
  liveStep: number;
  /** "Lägg till", until the song tab lists songs. */
  openAdd: number;
  /** A song found in the add dialog and added with Ctrl+Enter, until the running order shows it. */
  addSong: number;
  /** Ctrl+2 in the add dialog, until the Bible tab's search shows. */
  bibleTab: number;
  /** Ctrl+1 back, until the song tab lists songs. */
  songTab: number;
  /** "Joh 3:16-17" in the Bible search, until its two verses show. */
  bibleSearch: number;
  /** A book picked (Psaltaren), until its 150 chapters show. */
  bibleBook: number;
  /** A chapter picked (23), until its verses show. */
  bibleChapter: number;
  /** A song added to the open presentation by another device, from its push until the running order shows it; a change on its own. */
  syncOne: number;
}

async function measureFlows(page: Page, runs: number): Promise<Flows> {
  const f = {} as Flows;
  const helpers = async () => page.evaluate(pageHelpers);

  // The start page, from Teman (a light page) and back.
  f.startPage = await median(runs, async () => {
    await openAdmin(page, 'Teman');
    await helpers();
    return timeInPage(page, () => {
      window.gpGo(
        () => !!document.querySelector('a[href="/presentations/perf-p0"]'),
        () => document.querySelector<HTMLElement>('a[href="/"]')!.click(),
      );
    }, null);
  });
  f.startReload = await median(runs, async () => {
    await page.reload({ waitUntil: 'commit' });
    return page.evaluate(async () => {
      while (!document.querySelector('a[href="/presentations/perf-p0"]')) await new Promise((r) => setTimeout(r, 5));
      return performance.now();
    });
  });
  await helpers();

  // The presentation, from the start page; the first item is selected on open.
  f.openPresentation = await median(runs, async () => {
    await openPresentations(page);
    await page.locator('a[href="/presentations/perf-p0"]').waitFor();
    await helpers();
    return timeInPage(page, () => {
      window.gpGo(
        () => {
          if (document.querySelectorAll('ol[aria-label="Programpunkter"] > li').length < 30) return false;
          const selected = document.querySelector('ol[aria-label="Programpunkter"] [aria-pressed="true"]')?.textContent?.trim();
          return !selected || !!document.querySelector(`ol[aria-label="${CSS.escape(selected)}"] > li`);
        },
        () => document.querySelector<HTMLElement>('a[href="/presentations/perf-p0"]')!.click(),
      );
    }, null);
  });

  // ↓ through the items, from the first.
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: songName(0), exact: true }).click();
  await page.locator('ol[aria-label="Programpunkter"] [aria-pressed="true"]').waitFor();
  await page.locator('ol[aria-label="Programpunkter"] [aria-pressed="true"]').focus();
  f.changeItem = await median(runs * 2, async () => {
    const next = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('ol[aria-label="Programpunkter"] > li')];
      const at = rows.findIndex((r) => r.querySelector('[aria-pressed="true"]'));
      return rows[at + 1]!.textContent!.trim();
    });
    return timeKeyPress(
      page,
      'ArrowDown',
      (title) => window.gpArm(() => !!document.querySelector(`ol[aria-label="${CSS.escape(title)}"] > li`) && document.querySelector('ol[aria-label="Programpunkter"] [aria-pressed="true"]')?.textContent?.trim() === title),
      next,
    );
  });

  // The add dialog and its tabs.
  f.openAdd = await median(runs, async () => {
    await helpers();
    const t = await timeInPage(page, () => {
      window.gpGo(
        () => !!document.querySelector('[role="dialog"] ul[aria-label="Sånger"] > li'),
        () => window.gpByName('button', 'Lägg till')!.click(),
      );
    }, null);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Lägg till' })).toHaveCount(0);
    return t;
  });
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('listitem').first().waitFor();
  // A song found by its name and added with Ctrl+Enter, until the running order has it.
  let adding = 200;
  f.addSong = await median(runs + 2, async () => {
    const name = songName(adding++);
    const n = await page.locator('ol[aria-label="Programpunkter"] > li').count();
    await picker.getByLabel('Sök på titel, författare eller textrad').fill(name);
    await picker.getByRole('button', { name: `Lägg till ${name}` }).waitFor();
    return timeKeyPress(page, 'Control+Enter', (before) => window.gpArm(() => document.querySelectorAll('ol[aria-label="Programpunkter"] > li').length === before + 1), n);
  });
  const bibleSearch = 'input[aria-label="Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)"]';
  f.bibleTab = await median(runs, async () => {
    const t = await timeKeyPress(page, 'Control+2', (sel) => window.gpArm(() => !!document.querySelector(sel)?.checkVisibility()), bibleSearch);
    await timeKeyPress(page, 'Control+1', () => window.gpArm(() => !!document.querySelector('[role="dialog"] ul[aria-label="Sånger"] > li')?.checkVisibility()), null);
    return t;
  });
  f.songTab = await median(runs, async () => {
    await timeKeyPress(page, 'Control+2', (sel) => window.gpArm(() => !!document.querySelector(sel)?.checkVisibility()), bibleSearch);
    return timeKeyPress(page, 'Control+1', () => window.gpArm(() => !!document.querySelector('[role="dialog"] ul[aria-label="Sånger"] > li')?.checkVisibility()), null);
  });

  // The Bible tab: a reference, then browsing.
  await page.keyboard.press('Control+2');
  await picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)').waitFor();
  f.bibleSearch = await median(runs, async () => {
    await picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)').fill('');
    await picker.getByRole('button', { name: 'Psaltaren' }).waitFor();
    return timeInPage(page, (sel) => {
      window.gpGo(
        () => document.querySelectorAll('ol[aria-label="Verser"] > li').length === 2,
        () => {
          const input = document.querySelector<HTMLInputElement>(sel)!;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Joh 3:16-17');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
      );
    }, bibleSearch);
  });
  await picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)').fill('');
  // Back to the tab's list of books; the book is the last button of its name (the path above may name it too).
  const toBooks = async () => {
    while (await picker.getByRole('button', { name: 'Tillbaka' }).isVisible()) await picker.getByRole('button', { name: 'Tillbaka' }).click();
  };
  const psalms = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].filter((e) => e.textContent?.trim() === 'Psaltaren').at(-1)!;
  await page.evaluate(`window.gpPsalms = ${psalms.toString()}`);
  f.bibleBook = await median(runs, async () => {
    await toBooks();
    return timeInPage(page, () => {
      window.gpGo(
        () => document.querySelectorAll('[role="group"][aria-label="Välj startkapitel"] button').length === 150,
        () => (window as unknown as { gpPsalms: typeof psalms }).gpPsalms().click(),
      );
    }, null);
  });
  f.bibleChapter = await median(runs, async () => {
    await toBooks();
    await picker.getByRole('button', { name: 'Psaltaren' }).last().click();
    await picker.getByRole('group', { name: 'Välj startkapitel' }).getByRole('button', { name: '23', exact: true }).waitFor();
    return timeInPage(page, () => {
      window.gpGo(
        () => document.querySelectorAll('[role="group"][aria-label="Välj startvers"] button').length === 26,
        () => window.gpByName('[role="group"][aria-label="Välj startkapitel"] button', '23')!.click(),
      );
    }, null);
  });
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(picker).toHaveCount(0);

  // One change from another device, while the presentation is open.
  // One change at a time: the server pokes the first change of a quiet spell at once, and what follows within
  // 500 ms at the end of that window (SYNC-R38), so each change waits out the last one's window first.
  f.syncOne = await median(runs, async () => {
    await page.waitForTimeout(600);
    const n = await page.locator('ol[aria-label="Programpunkter"] > li').count();
    const itemId = `perf-sync-${Date.now()}`;
    await page.evaluate((before) => window.gpArm(() => document.querySelectorAll('ol[aria-label="Programpunkter"] > li').length === before + 1), n);
    await push(page, [{ name: 'addSongToPresentation', v: 1, args: { itemId, presentationId: 'perf-p0', songId: `perf-${100 + n}` } }], `perf-other-${itemId}`, true);
    return page.evaluate(async () => (await window.gpDone) - window.gpStart);
  });

  // The live page: → through the slides.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await pickItem(page, songName(0));
  await page.getByRole('button', { name: `${songName(0)} 1` }).click();
  await expect(page.getByRole('button', { name: `${songName(0)} 1` })).toHaveAttribute('aria-pressed', 'true');
  await helpers();
  // Each item has five slides, one per part: past the fifth, → goes on to the next item's first.
  let step = 0;
  f.liveStep = await median(runs * 2, async () => {
    step++;
    const name = `${songName(Math.floor(step / 5))} ${(step % 5) + 1}`;
    return timeKeyPress(page, 'ArrowRight', (label) => window.gpArm(() => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true'), name);
  });
  // Ended, so the start page links to the editor again.
  await page.getByRole('button', { name: 'Avsluta presentation' }).click();
  await expect(page.getByRole('heading', { name: 'Perf 30', exact: true })).toBeVisible();
  return f;
}

test('the most used flows with 3 000 songs, 50 presentations and a whole Bible, measured', async () => {
  test.setTimeout(600_000);
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  await page.addInitScript(pageHelpers);
  await page.addInitScript(`window.gpByName = ${byName.toString()}`);
  await page.evaluate(pageHelpers);
  await page.evaluate(`window.gpByName = ${byName.toString()}`);
  await openAdmin(page, 'Biblar');
  await page.getByTestId('bible-file').setInputFiles({ name: 'perf.zip', mimeType: 'application/zip', buffer: Buffer.from(fullBibleZip()) });
  await expect(page.getByTestId('bible-import-message')).toContainText('Importerade Prestandabibeln', { timeout: 60_000 });
  await seedSongs(page, 3000);
  await seedPresentations(page, 50, 30);
  await openAdmin(page, 'Sånger');
  await expect(page.getByText('Alla sånger (3000)')).toBeVisible({ timeout: 60_000 });
  // Sånger, reloaded: the window's start with 3 000 songs.
  const songsReload = async () =>
    median(3, async () => {
      await page.reload({ waitUntil: 'commit' });
      return page.evaluate(async () => {
        while (!document.body?.textContent?.includes('Alla sånger (3000)')) await new Promise((r) => setTimeout(r, 5));
        return performance.now();
      });
    });

  const normalReload = await songsReload();
  const normal = { ...(await measureFlows(page, 3)), songsReload: normalReload };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openAdmin(page, 'Sånger');
  const slowReload = await songsReload();
  // A reload keeps the throttling: it belongs to the page's target, not its document.
  const slow = { ...(await measureFlows(page, 3)), songsReload: slowReload };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const table = (Object.keys(normal) as (keyof Flows)[]).map((k) => `${k}: ${normal[k]} / ${slow[k]}`).join('\n');
  console.log(`flows, median ms, normal / CPU 4x slower:\n${table}`);
  test.info().annotations.push({ type: 'measured', description: JSON.stringify({ normal, slow }) });
  // About 2-3 times what was measured on 2026-10-30 (docs/performance.md), normal / CPU 4x slower.
  const limits: Record<keyof Flows, [number, number]> = {
    startPage: [100, 200],
    startReload: [1800, 2500],
    songsReload: [2000, 3000],
    openPresentation: [100, 200],
    changeItem: [50, 100],
    liveStep: [50, 100],
    openAdd: [150, 300],
    addSong: [700, 1200],
    bibleTab: [100, 200],
    songTab: [200, 600],
    bibleSearch: [50, 100],
    bibleBook: [100, 250],
    bibleChapter: [50, 150],
    syncOne: [150, 300],
  };
  for (const k of Object.keys(limits) as (keyof Flows)[]) {
    expect.soft(normal[k], `${k}, normal`).toBeLessThan(limits[k][0]);
    expect.soft(slow[k], `${k}, CPU 4x slower`).toBeLessThan(limits[k][1]);
  }
});

/** Arms `page` to note when its shown slide's text becomes `text`, as wall-clock ms (`performance.timeOrigin` based). */
async function armSlide(page: Page, text: string) {
  await page.evaluate((want) => {
    const w = window as unknown as { gpSlideAt: Promise<number> };
    const now = () => performance.timeOrigin + performance.now();
    const shown = () => [...document.querySelectorAll('[data-testid="slide-text"]')].some((e) => e.textContent?.trim() === want);
    w.gpSlideAt = new Promise((resolve) => {
      if (shown()) return resolve(now());
      const mo = new MutationObserver(() => {
        if (!shown()) return;
        mo.disconnect();
        resolve(now());
      });
      mo.observe(document, { childList: true, subtree: true, characterData: true });
    });
  }, text);
}

const slideAt = (page: Page) => page.evaluate(() => (window as unknown as { gpSlideAt: Promise<number> }).gpSlideAt);

test('a slide step reaches the output window and a paired screen at once, measured', async () => {
  test.setTimeout(120_000);
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  const labels = ['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4', 'Verse 5', 'Verse 6', 'Chorus', 'Chorus 1', 'Chorus 2', 'Bridge', 'Tag', 'Ending'];
  const parts = labels.map((l, i): [string, string] => [l, `Del ${i + 1}`]);
  await createSong(page, 'Sång A', parts);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);

  // A paired screen, switched on under Utgångar.
  await openAdmin(page, 'Skärmar');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('dialog', { name: 'Lägg till skärm' }).getByLabel('Namn').fill('Kyrksal');
  await page.getByRole('dialog', { name: 'Lägg till skärm' }).getByRole('button', { name: 'Lägg till' }).click();
  const url = await page.getByRole('dialog', { name: 'Kyrksal' }).getByLabel('Länk').inputValue();
  await page.getByRole('dialog', { name: 'Kyrksal' }).getByRole('button', { name: 'Stäng' }).click();
  browser = await chromium.launch();
  const screen = await browser.newPage();
  await screen.goto(url);
  await expect(screen.getByTestId('display-idle')).toBeVisible();

  await openPresentations(page);
  await page.getByRole('link', { name: /Söndag/ }).click();
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Sång A 1', exact: true }).click();
  await page.getByRole('list', { name: 'Utgångar' }).getByLabel('Kyrksal').check();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await expect(output.getByTestId('slide-text')).toHaveText('Del 1', { timeout: 10_000 });
  await expect(screen.getByTestId('slide-text')).toHaveText('Del 1', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Sång A 1', exact: true }).focus();
  await page.evaluate(pageHelpers);

  let at = 1;
  /** → on the live page; ms from its keydown until the output window and the screen show the next slide. */
  const step = async () => {
    at++;
    await Promise.all([armSlide(output, `Del ${at}`), armSlide(screen, `Del ${at}`)]);
    await page.keyboard.press('ArrowRight');
    const pressed = await page.evaluate(() => performance.timeOrigin + window.gpKeyAt);
    return { output: (await slideAt(output)) - pressed, screen: (await slideAt(screen)) - pressed };
  };
  const run = async (n: number) => {
    const samples: { output: number; screen: number }[] = [];
    for (let i = 0; i < n; i++) samples.push(await step());
    const mid = (k: 'output' | 'screen') => Math.round(samples.map((s) => s[k]).toSorted((a, b) => a - b)[Math.floor(n / 2)]!);
    return { output: mid('output'), screen: mid('screen') };
  };
  const normal = await run(5);
  // The receivers slowed as a tablet or a TV's browser would be.
  const slowed = await Promise.all([output, screen].map(async (p) => (await p.context().newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: 4 })));
  expect(slowed).toHaveLength(2);
  const slow = await run(5);
  console.log(`slide step, median ms, normal / receivers 4x slower: output window ${normal.output} / ${slow.output}, paired screen ${normal.screen} / ${slow.screen}`);
  test.info().annotations.push({ type: 'measured', description: JSON.stringify({ normal, slow }) });
  // Measured 2 / 7 ms and 15 / 14 ms on 2026-10-30 (docs/performance.md): a slide must show at once, so the
  // bounds are tight, with room for a busy machine.
  expect.soft(normal.output, 'output window').toBeLessThan(50);
  expect.soft(normal.screen, 'paired screen').toBeLessThan(100);
  expect.soft(slow.output, 'output window, 4x').toBeLessThan(100);
  expect.soft(slow.screen, 'paired screen, 4x').toBeLessThan(150);
});
