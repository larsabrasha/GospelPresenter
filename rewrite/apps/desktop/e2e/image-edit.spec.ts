// A picture edited and taken back (MEDIA-R19, MEDIA-A17), a phone's upright photo imported upright, and two small
// things of the add dialog: ⌘K's "Lägg till video…" and Avmarkera alla.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, openAdmin, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** A JPEG `w` × `h` whose EXIF says to turn it a quarter clockwise (Orientation 6), as a phone stores an upright photo. */
async function sidewaysJpeg(page: Page, w: number, h: number): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ([width, height]) => {
      const c = document.createElement('canvas');
      c.width = width!;
      c.height = height!;
      c.getContext('2d')!.fillRect(0, 0, width!, height!);
      const jpeg = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg'))).arrayBuffer());
      const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
      const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
      const len = payload.length + 2;
      return [...jpeg.slice(0, 2), 0xff, 0xe1, (len >> 8) & 255, len & 255, ...payload, ...jpeg.slice(2)];
    },
    [w, h],
  );
  return Buffer.from(bytes);
}

test('a picture is cropped to 16:9, shown so in the library, compared with its original, and taken back to it', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([{ name: 'Fyrkant.png', mimeType: 'image/png', buffer: solidPng(400, 400, [200, 30, 30]) }]);
  const row = page.getByRole('button', { name: 'Fler val för Fyrkant.png' });
  await row.click();
  await page.getByRole('menuitem', { name: 'Redigera' }).click();
  const editor = page.getByTestId('image-editor');
  await expect(editor).toBeVisible();

  // Held, Jämför shows the original and says so.
  const compare = editor.getByTestId('compare');
  await compare.hover();
  await page.mouse.down();
  await expect(editor.getByTestId('showing-original')).toHaveText(/original/i);
  await page.mouse.up();
  await expect(editor.getByTestId('showing-original')).toHaveCount(0);

  await editor.getByRole('radio', { name: '16:9' }).click();
  await editor.getByRole('button', { name: 'Klar' }).click();
  await expect(editor).toHaveCount(0);
  // The library's picture is the edit: 400 × 225, and its menu offers the original back.
  const thumb = page.getByRole('img', { name: 'Fyrkant.png' }).first();
  await expect.poll(() => thumb.evaluate((i) => (i as HTMLImageElement).naturalWidth / (i as HTMLImageElement).naturalHeight)).toBeCloseTo(16 / 9, 1);

  await row.click();
  await page.getByRole('menuitem', { name: 'Återgå till original' }).click();
  await page.getByRole('dialog', { name: 'Återgå till original' }).getByRole('button', { name: 'Återgå till original' }).click();
  await expect.poll(() => thumb.evaluate((i) => (i as HTMLImageElement).naturalWidth / (i as HTMLImageElement).naturalHeight)).toBeCloseTo(1, 1);
  await row.click();
  await expect(page.getByRole('menuitem', { name: 'Återgå till original' })).toHaveCount(0);
});

test("a phone's upright photo, stored on its side with a note to turn it, is imported upright", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([{ name: 'Stående.jpg', mimeType: 'image/jpeg', buffer: await sidewaysJpeg(page, 320, 180) }]);
  // 320 × 180 turned a quarter: standing, 180 × 320.
  const thumb = page.getByRole('img', { name: 'Stående.jpg' }).first();
  await expect.poll(() => thumb.evaluate((i) => (i as HTMLImageElement).naturalHeight / (i as HTMLImageElement).naturalWidth)).toBeCloseTo(320 / 180, 1);
});

test('⌘K in a presentation offers "Lägg till video…", and Avmarkera alla lets go of the pictures picked', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([
    { name: 'A.png', mimeType: 'image/png', buffer: solidPng(320, 180, [200, 30, 30]) },
    { name: 'B.png', mimeType: 'image/png', buffer: solidPng(320, 180, [30, 30, 200]) },
  ]);
  await expect(page.locator('[data-library-item]')).toHaveCount(2);
  await createPresentation(page, 'Söndag');
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('searchbox', { name: 'Sök i allt' }).fill('video');
  await expect(page.getByRole('option', { selected: true })).toContainText('Lägg till video…');
  // Videor is a command already ("Gå till Videor"), so not a page of Inställningar too.
  await expect(page.getByRole('group', { name: 'Inställningar' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Lägg till video' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Lägg till video' }).getByRole('button', { name: 'Stäng' }).click();

  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: 'A.png', exact: true }).click();
  await picker.getByRole('button', { name: 'B.png', exact: true }).click();
  await expect(picker.getByRole('button', { name: 'Lägg till 2 bilder' })).toBeVisible();
  await picker.getByRole('button', { name: 'Avmarkera alla' }).click();
  await expect(picker.getByRole('button', { name: /Lägg till \d bilder/ })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Avmarkera alla' })).toHaveCount(0);
});
