// How quickly a tablet over plain http answers while it fetches a large file
// in the background. Without Web Crypto it hashes on the same thread as the
// database answers the page, so the hash must give the thread back.
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { PROTOCOL_VERSION } from '../../../packages/core/src/protocol.ts';
import { SCHEMA_VERSION } from '../../../packages/core/src/schema.ts';
import { launch, type Desktop } from './apps.ts';
import { addSongs, allowRemote, createPresentation, createSong, openAdmin, openPresentations, pair, setUpHost } from './flows.ts';
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
  await page.getByRole('link', { name: 'Starta presentation' }).click();
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
  await phone.getByRole('button', { name: 'Sång A 1' }).waitFor({ timeout: 30_000 });
  // About 830 ms when the hash held the thread, about 125 ms since it gives it back.
  expect(Date.now() - started).toBeLessThan(500);
});

/**
 * Puts `n` songs straight into the server, as another device's push would, in
 * batches; the page gets them in its next pull. Each has five parts of four
 * lines, about as long as a hymn.
 */
async function seedSongs(page: Page, n: number) {
  const words = ['Herre', 'Jesus', 'nåd', 'ljus', 'frid', 'himmel', 'kärlek', 'tro', 'hopp', 'sång', 'jord', 'Gud', 'helig', 'stjärna', 'morgon', 'kväll', 'väg', 'hjärta', 'evig', 'glädje'];
  const word = (i: number, k: number) => words[(i * 7 + k * 13 + (k * k * 3)) % words.length]!;
  const line = (i: number, k: number) => `${word(i, k)} och ${word(i, k + 1)} över ${word(i, k + 2)} i ${word(i, k + 3)}s ${word(i, k + 4)}`;
  const mutations = [];
  for (let i = 0; i < n; i++) {
    const id = `perf-${i}`;
    mutations.push({ name: 'createSong', v: 1, args: { id, name: `${word(i, 0)} ${word(i, 1)} ${i}`, author: `Författare ${i % 97}` } });
    for (const k of [1, 2, 3, 4, 5])
      mutations.push({
        name: 'addSongPart',
        v: 1,
        args: { id: `${id}-${k}`, songId: id, labelText: k === 5 ? 'Chorus' : `Verse ${k}`, content: [0, 1, 2, 3].map((l) => line(i, k * 4 + l)).join('\n') },
      });
  }
  const numbered = mutations.map((m, i) => ({ id: i + 1, ...m }));
  await page.evaluate(
    async ({ all, protocol, schemaVersion }) => {
      const session = JSON.parse(localStorage.getItem('gp.session')!) as { token: string };
      const device = JSON.parse(localStorage.getItem('gp.device') ?? 'null') as string | null;
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, ...(device ? { 'x-gp-device': device } : {}) };
      const clientId = `perf-seed-${Date.now()}`;
      for (let at = 0; at < all.length; at += 1000) {
        const res = await fetch('/api/sync/push', { method: 'POST', headers, body: JSON.stringify({ protocol, schemaVersion, clientId, mutations: all.slice(at, at + 1000) }) });
        if (!res.ok) throw new Error(`push ${res.status}: ${await res.text()}`);
      }
    },
    { all: numbered, protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION },
  );
}

/**
 * Types one key into the add dialog's song search and measures, in the page,
 * how long until React has put the new list in the DOM and the browser has
 * laid it out. Paint is not counted (the test windows are hidden).
 */
async function timeKey(page: Page, value: string): Promise<number> {
  return page.evaluate(async (typed) => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input[aria-label="Sök på titel, författare eller textrad"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const changed = new Promise<void>((resolve) => {
      const mo = new MutationObserver(() => {
        mo.disconnect();
        resolve();
      });
      mo.observe(dialog, { childList: true, subtree: true, characterData: true, attributes: true });
    });
    const start = performance.now();
    setValue.call(input, typed);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await changed;
    void (dialog as HTMLElement).offsetHeight; // the layout of the new list
    return performance.now() - start;
  }, value);
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
  // The tab prepares the library for search in small steps once it has it; a person takes longer than this to start typing.
  await page.waitForTimeout(1500);

  const run = async () => {
    // From all 3 000 down a word, letter by letter, then back to all of them.
    const keys = ['h', 'he', 'her', 'herr', 'herre', 'herr', 'her', 'he', 'h', ''];
    const keystrokes: number[] = [];
    for (const k of keys) keystrokes.push(await timeKey(page, k));
    return { keystrokes: keystrokes.map(Math.round), scrollStep: Math.round(await timeScroll(page, 30)) };
  };
  const normal = await run();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await run();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`3000 songs, ms per keystroke (h … herre … empty): ${normal.keystrokes.join(', ')}; per scroll step: ${normal.scrollStep}`);
  console.log(`the same, CPU 4x slower: ${slow.keystrokes.join(', ')}; per scroll step: ${slow.scrollStep}`);
  test.info().annotations.push({ type: 'measured', description: JSON.stringify({ normal, slow }) });
  expect(Math.max(...normal.keystrokes)).toBeLessThan(1000); // a measurement first; the bound only catches a collapse
});
