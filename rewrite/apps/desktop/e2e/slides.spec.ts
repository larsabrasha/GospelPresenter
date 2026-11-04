// PDFs (D29, PRES-R11, docs/custom-slides.md): a PDF is rendered on the device by pdf.js, one picture per page,
// kept there, uploaded to the host and shown on the output. A PowerPoint is refused with how to save it as PDF. A
// PDF is a slideshow of the library (Inställningar → Bildspel), its pages its pages' pictures, and an item names it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { closeAdmin, createPresentation, openAdmin, setUpHost } from './flows.ts';
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

test('a three-page PDF becomes a slideshow item whose pages show on the output; a PowerPoint and a 101-page PDF are refused', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+6');
  await expect(dialog.getByRole('tab', { name: 'Bildspel' })).toHaveAttribute('aria-selected', 'true');
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
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Predikan.pdf 1' }).click();
  const shown = output.getByTestId('custom-page').locator('img');
  await expect(shown).toBeVisible();
  await expect(output.getByTestId('slide-stage')).toHaveAttribute('data-kind', 'media');
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1920, 1080]);

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('a PDF imported into the library goes into a presentation as a reference, and a new PDF changes it there', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bildspel');
  await page.getByTestId('slide-deck-file').setInputFiles({ name: 'Predikan.pdf', mimeType: 'application/pdf', buffer: colouredPdf(2) });
  const card = page.getByTestId('custom-slide-card');
  await expect(card).toContainText('Predikan.pdf', { timeout: 15_000 });
  await closeAdmin(page);

  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+6');
  await dialog.getByRole('checkbox', { name: 'Predikan.pdf' }).click();
  await dialog.getByRole('button', { name: 'Lägg till Predikan.pdf' }).click();
  await dialog.getByRole('button', { name: 'Stäng' }).click();
  const parts = page.getByRole('list', { name: 'Predikan.pdf' }).getByRole('listitem');
  await expect(parts).toHaveCount(2);

  // Ersätt med ny PDF, in the slideshow's menu, after a question: the presentation shows the new pages.
  await openAdmin(page, 'Bildspel');
  await card.getByRole('link', { name: 'Predikan.pdf', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ersätt med ny PDF' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog', { name: 'Ersätt med ny PDF' }).getByRole('button', { name: 'Välj PDF' }).click()]);
  await chooser.setFiles({ name: 'Predikan v2.pdf', mimeType: 'application/pdf', buffer: colouredPdf(3) });
  await expect(page.getByRole('status').getByText('Predikan.pdf har fått nya sidor')).toBeVisible({ timeout: 15_000 });
  await closeAdmin(page);
  await expect(parts).toHaveCount(3);
});
