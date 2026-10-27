// How quickly a tablet over plain http answers while it fetches a large file
// in the background. Without Web Crypto it hashes on the same thread as the
// database answers the page, so the hash must give the thread back.
import { chromium, expect, test, type Browser } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, openPresentations, pair, setUpHost } from './flows.ts';
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
  await expect(phone.getByTestId('status')).toContainText('Ansluten', { timeout: 10_000 });

  const page = host.page;
  await openAdmin(page, 'Ljud');
  await page.getByTestId('audio-file').setInputFiles({ name: 'Lång.wav', mimeType: 'audio/wav', buffer: toneWav(1200) });
  await expect(page.getByRole('heading', { name: 'Alla ljudfiler (1)' })).toBeVisible({ timeout: 20_000 });
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.keyboard.press('Control+4');
  await page.getByRole('dialog', { name: 'Lägg till' }).getByRole('button', { name: 'Lägg till Lång.wav' }).click();
  await page.getByRole('dialog', { name: 'Lägg till' }).getByRole('button', { name: 'Stäng' }).click();
  await addSongs(page, ['Sång A']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  await page.getByLabel('Tillåt fjärrstyrning').check();

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
