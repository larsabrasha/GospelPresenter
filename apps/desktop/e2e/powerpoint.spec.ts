// A PowerPoint deck as a slideshow (docs/powerpoint-deckcraft.md, step 1, Lars 2026-11-20): the desktop host draws
// every slide shown at every click with DeckCraft's libraries (crates/gp-pptx), and the pictures are the item's pages
// as a PDF's are, a click a slide on the output. The deck is crates/gp-pptx/fixtures/deck.pptx: a list built a point
// a click (four pages), a hidden slide (none) and a chart (one page, and the notice that a PDF may show it better).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, setUpHost } from './flows.ts';

const deck = readFileSync(new URL('../../../crates/gp-pptx/fixtures/deck.pptx', import.meta.url));

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a PowerPoint deck becomes a slideshow item, a page a click, its hidden slide left out and its chart noted', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bildspel', exact: true }).click(); // + is a menu (spec 03 2f)
  const dialog = page.getByRole('dialog', { name: 'Lägg till' });

  await dialog.getByTestId('slides-file').setInputFiles({ name: 'Predikan.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: deck });

  await expect(page.getByRole('status').getByText('"Predikan.pptx" har lagts till')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('status').filter({ hasText: 'Bildspelet har diagram' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByRole('list', { name: 'Predikan.pptx' }).getByRole('listitem')).toHaveCount(5);

  // Live: a click is a slide, its picture filling the output at 1920×1080.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Predikan.pptx 2' }).click();
  const shown = output.getByTestId('custom-page').locator('img');
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1920, 1080]);

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});
