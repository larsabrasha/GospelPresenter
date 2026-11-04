// Slideshows (Bildspel, docs/custom-slides.md): one made in Inställningar → Bildspel, a text and a shape put on it
// from +, undone and done again, and the slideshow added to a presentation from Lägg till's Bildspel, drawn there.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { closeAdmin, createPresentation, nameNew, openAdmin, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a custom slide is made with a text and a rectangle, undone and redone, and added to a presentation', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Bildspel');
  await page.getByRole('button', { name: 'Nytt bildspel' }).click();
  await nameNew(page, 'Kollekt');
  const canvas = page.getByTestId('slide-canvas');
  await expect(canvas).toBeVisible();

  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rektangel', exact: true }).click();
  await expect(canvas.locator('[data-element]')).toHaveCount(2);
  await expect(canvas).toContainText('Text');

  await page.getByRole('button', { name: 'Ångra' }).click();
  await expect(canvas.locator('[data-element]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Gör om' }).click();
  await expect(canvas.locator('[data-element]')).toHaveCount(2);
  await expect(page.getByTestId('saved')).toBeVisible();

  // A picture from this device is the slideshow's own: drawn on the page, and not put in Bilder.
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click();
  await page.getByRole('dialog', { name: 'Välj bild' }).getByTestId('picture-file').setInputFiles({ name: 'Swish.png', mimeType: 'image/png', buffer: solidPng(640, 360, [14, 165, 233]) });
  await expect(canvas.locator('img[data-element]')).toHaveCount(1);
  await expect(page.getByTestId('saved')).toBeVisible();

  // In the library under Välj, the slide is drawn as wide as outside it (it was 0 wide once).
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await expect.poll(async () => (await page.getByRole('checkbox', { name: 'Kollekt' }).getByTestId('custom-page').boundingBox())?.width ?? 0).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Klar', exact: true }).click();
  await openAdmin(page, 'Bilder');
  await expect(page.getByText('Inga bilder')).toBeVisible();
  await closeAdmin(page);

  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+6');
  await picker.getByRole('checkbox', { name: 'Kollekt' }).click();
  await picker.getByRole('button', { name: 'Lägg till Kollekt' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();

  const order = page.getByRole('list', { name: 'Programpunkter' });
  await expect(order.getByRole('button', { name: 'Kollekt', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-page').first()).toContainText('Text');
});
