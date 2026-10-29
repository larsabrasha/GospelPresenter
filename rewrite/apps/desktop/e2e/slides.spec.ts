// Slide decks (D29, PRES-R11): a PDF is rendered on the device by pdf.js, one
// picture per page, kept there, uploaded to the host and shown on the output.
// A PowerPoint is refused with how to save it as PDF.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, setUpHost } from './flows.ts';
import { colouredPdf } from './pdf.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** What the host keeps in its media folder: every blob under `media/`. */
function storedBlobs(dataDir: string): Buffer[] {
  return readdirSync(dataDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.parentPath.includes('media') && /^[0-9a-f]{64}$/.test(e.name))
    .map((e) => readFileSync(join(e.parentPath, e.name)));
}

test('a three-page PDF becomes a slide deck item whose pages show on the output; a PowerPoint and a 101-page PDF are refused', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+5');
  await expect(dialog.getByRole('tab', { name: 'PowerPoint' })).toHaveAttribute('aria-selected', 'true');
  const file = dialog.getByTestId('slides-file');

  // A PowerPoint is refused with how to save it as PDF.
  await file.setInputFiles({ name: 'Predikan.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PK not really') });
  await expect(dialog.getByRole('alert')).toHaveText(/PowerPoint-filer kan inte importeras direkt\. Spara bildspelet som PDF/);

  // More than 100 pages is refused, as in the old app.
  await file.setInputFiles({ name: 'Lång.pdf', mimeType: 'application/pdf', buffer: colouredPdf(101) });
  await expect(dialog.getByRole('alert')).toHaveText('Filen har för många sidor. Maximum är 100 sidor.');

  // Three pages become one item named after the file; the modal stays open (D15).
  await file.setInputFiles({ name: 'Predikan.pdf', mimeType: 'application/pdf', buffer: colouredPdf(3) });
  await expect(page.getByRole('status').getByText('"Predikan.pdf" har lagts till')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Predikan\.pdf/]);
  await expect(page.getByRole('list', { name: 'Predikan.pdf' }).getByRole('listitem')).toHaveCount(3);

  // The host keeps two WebP blobs per page: the picture and its thumbnail.
  await expect.poll(() => storedBlobs(host!.dataDir).length, { timeout: 10_000 }).toBe(6);
  for (const blob of storedBlobs(host.dataDir)) expect([blob.subarray(0, 4).toString(), blob.subarray(8, 12).toString()]).toEqual(['RIFF', 'WEBP']);

  // Live: each page is one slide, its picture at 1920×1080 filling the output.
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: /Predikan\.pdf/ }).first().click();
  const shown = output.getByTestId('slide-image');
  await expect(shown).toBeVisible();
  await expect(output.getByTestId('slide-stage')).toHaveAttribute('data-kind', 'media');
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1920, 1080]);

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});
