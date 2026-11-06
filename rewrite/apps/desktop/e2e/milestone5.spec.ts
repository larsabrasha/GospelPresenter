// Milestone 5: the media library (spec 05 "Media"). A picture is fitted and
// re-encoded on the device, kept there, uploaded to the host's media folder,
// and shown on the output, all with no internet.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { launch, testPort, type Desktop } from './apps.ts';
import { createPresentation, createUser, openAdmin, pair, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

/** What the host keeps in its media folder: every blob under `media/`, whatever the layout beneath it. */
function storedBlobs(dataDir: string): Buffer[] {
  return readdirSync(dataDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.parentPath.includes(`${join('media')}`) && /^[0-9a-f]{64}$/.test(e.name))
    .map((e) => readFileSync(join(e.parentPath, e.name)));
}

test('a picture is imported, added to a presentation and shown on the output; trashed, it still shows', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Bilder');
  await expect(page.getByText('Inga bilder än')).toBeVisible();

  // A 2400×1350 PNG with transparency, a bitmap (not accepted) and a text file named .jpg (not a picture).
  await page.getByTestId('image-file').setInputFiles([
    { name: 'Logotyp.png', mimeType: 'image/png', buffer: solidPng(2400, 1350, [200, 30, 30]) },
    { name: 'bakgrund.bmp', mimeType: 'image/bmp', buffer: Buffer.from('BM not a supported type') },
    { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is text, not a picture') },
  ]);
  await expect(page.getByTestId('image-failures')).toContainText('2 bild(er) kunde inte importeras');
  await expect(page.getByTestId('image-failures')).toContainText('bakgrund.bmp: bara JPG, PNG, WebP och GIF kan importeras.');
  await expect(page.getByTestId('image-failures')).toContainText('x.jpg: filen är ingen giltig bild.');
  await expect(page.locator('[data-library-item]')).toHaveCount(1);

  // The thumbnail is fitted within 400×225 (MEDIA-A2).
  const thumb = page.getByTestId('image-card').getByRole('img', { name: 'Logotyp.png' });
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([400, 225]);
  // The host's own window keeps no copy (docs/media-and-files.md, "The host's own window"): reloaded, its
  // database in memory starts empty, and the picture comes from the server beside it.
  await page.reload();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([400, 225]);

  // The host keeps both blobs in its media folder, as WebP, as the PNG had transparency (MEDIA-A3).
  await expect.poll(() => storedBlobs(host!.dataDir).length).toBe(2);
  for (const blob of storedBlobs(host.dataDir)) expect([blob.subarray(0, 4).toString(), blob.subarray(8, 12).toString()]).toEqual(['RIFF', 'WEBP']);

  // Search by file name, any case (MEDIA-A7); "Sök..." in the empty field, as the current app.
  await expect(page.getByLabel('Sök', { exact: true })).toHaveAttribute('placeholder', 'Sök...');
  await page.getByLabel('Sök', { exact: true }).fill('LOGO');
  await expect(page.getByTestId('image-card')).toHaveCount(1);
  await page.getByLabel('Sök', { exact: true }).fill('zzz');
  await expect(page.getByText('Inga bilder matchar din sökning')).toBeVisible();
  await page.getByLabel('Rensa sökningen').click();

  // Into a presentation, through the add dialog's third tab.
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click(); // + is a menu (spec 03 2f)
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: 'Logotyp.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Logotyp.png' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Logotyp\.png/]);

  // Live: the picture fills the output, at 1920 px (MEDIA-A2), over the theme's background.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Logotyp.png 1' }).click();
  const shown = output.getByTestId('slide-image');
  await expect(shown).toBeVisible();
  await expect(output.getByTestId('slide-stage')).toHaveAttribute('data-kind', 'media');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1920, 1080]);

  // Trashed, the picture is gone from the library but still shows (MEDIA-R8).
  await page.goBack();
  await openAdmin(page, 'Bilder');
  // Radera is in the picture's menu, opened by a right click as in Photos.
  await page.getByLabel('Logotyp.png', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByRole('status').getByText('Logotyp.png flyttad till papperskorgen')).toBeVisible();
  await expect(page.getByText('Inga bilder än')).toBeVisible();
  await expect(shown).toBeVisible();
  await page.getByRole('link', { name: 'Papperskorg' }).click();
  await expect(page.getByRole('list', { name: 'Papperskorg' }).getByRole('listitem')).toHaveText([/Logotyp\.png.*Bild/]);

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('a picture imported while the host is down is kept, and reaches the host and its other devices when it is back', async () => {
  const port = testPort();
  host = await launch({ port });
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const page = second.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  const hostData = host.dataDir;
  await host.app.close();
  host = undefined;
  await expect(page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles({ name: 'Kors.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 60, 200]) });
  await expect(page.getByTestId('image-card').getByRole('img', { name: 'Kors.png' })).toBeVisible(); // shown at once, from this device
  await expect(page.getByTestId('status')).toContainText('1 ändring väntar');

  // The host comes back on the same port: the blobs are uploaded, then the add is pushed.
  host = await launch({ port, dataDir: hostData });
  await host.page.getByTestId('status').waitFor();
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await openAdmin(host.page, 'Bilder');
  const onHost = host.page.getByTestId('image-card').getByRole('img', { name: 'Kors.png' });
  await expect(onHost).toBeVisible({ timeout: 10_000 });
  // The host fetched the picture's bytes from its own media folder, not just the row.
  await expect.poll(() => onHost.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByText('En ändring kunde inte synkas.')).toHaveCount(0);
});

test('another device shows a picture large, in Bilder and in Lägg till bild, fetching each one only near view', async () => {
  host = await launch();
  await setUpHost(host);
  await openAdmin(host.page, 'Bilder');
  const files = Array.from({ length: 8 }, (_, i) => ({ name: `Bild ${i + 1}.png`, mimeType: 'image/png', buffer: solidPng(1600, 900, [20, 60, 20 + i * 25]) }));
  await host.page.getByTestId('image-file').setInputFiles(files);
  await expect(host.page.getByTestId('image-card')).toHaveCount(8);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  await createPresentation(host.page, 'Söndag');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const page = second.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
  // The picture itself, 1600 wide, not its thumbnail (400), nor "Hämtas..." for good (Lars, 2026-11-06, on an iPad).
  const width = (img: Locator, wide: number) => expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 10_000 }).toBe(wide);

  await openAdmin(page, 'Bilder');
  await page.getByRole('radio', { name: 'Stora', exact: true }).click();
  const cards = page.getByTestId('image-card').getByRole('img');
  await width(cards.first(), 1600);
  // The last, screens below, is still its thumbnail: the observers answered together, before the first one's fetch.
  await width(cards.last(), 400);
  await cards.last().scrollIntoViewIfNeeded();
  await width(cards.last(), 1600);

  await page.goto(new URL(page.url()).origin);
  await page.getByRole('link', { name: /Söndag/ }).click();
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('radio', { name: 'Stora', exact: true }).click();
  const picks = picker.getByTestId('image-picker').getByRole('img');
  await width(picks.first(), 1600);
  await picks.last().scrollIntoViewIfNeeded();
  await width(picks.last(), 1600);
});
