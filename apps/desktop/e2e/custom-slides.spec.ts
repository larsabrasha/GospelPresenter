// Slideshows (Bildspel, docs/custom-slides.md): one made in Inställningar → Bildspel, a text and a shape put on it
// from +, undone and done again, and the slideshow added to a presentation from Lägg till's Bildspel, drawn there.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addToSlide, closeAdmin, createPresentation, nameNew, openAdmin, setUpHost } from './flows.ts';
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
  await page.getByRole('button', { name: /^(Nytt bildspel|Gör ett bildspel)$/ }).click();
  await nameNew(page, 'Kollekt');
  const canvas = page.getByTestId('slide-canvas');
  await expect(canvas).toBeVisible();

  await addToSlide(page, 'Text');
  await addToSlide(page, 'Rektangel');
  await expect(canvas.locator('[data-element]')).toHaveCount(2);
  await expect(canvas).toContainText('Text');

  await page.getByRole('button', { name: 'Ångra' }).click();
  await expect(canvas.locator('[data-element]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Gör om' }).click();
  await expect(canvas.locator('[data-element]')).toHaveCount(2);
  await expect(page.getByTestId('saved')).toBeVisible();

  // A picture from this device is the slideshow's own: drawn on the page, and not put in Bilder.
  await addToSlide(page, 'Bild');
  await page.getByRole('dialog', { name: 'Välj bild' }).getByTestId('picture-file').setInputFiles({ name: 'Swish.png', mimeType: 'image/png', buffer: solidPng(640, 360, [14, 165, 233]) });
  await expect(canvas.locator('img[data-element]')).toHaveCount(1);
  await expect(page.getByTestId('saved')).toBeVisible();

  // Its pixels not see-through in one colour (a black logo made white), and back to its own colours.
  if (!(await page.getByTestId('inspector').filter({ visible: true }).count())) await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByRole('tab', { name: 'Bild', exact: true }).filter({ visible: true }).click();
  const inspector = page.getByTestId('inspector').filter({ visible: true });
  await inspector.getByRole('button', { name: 'Färg: Bildens egna' }).click();
  await inspector.getByRole('radio', { name: '#ffffff' }).click();
  await expect.poll(() => canvas.locator('[data-element]').last().evaluate((el) => [el.tagName, getComputedStyle(el).backgroundColor, getComputedStyle(el).maskImage.startsWith('url(')])).toEqual(['DIV', 'rgb(255, 255, 255)', true]);
  await inspector.getByRole('button', { name: 'Färg: #ffffff' }).click();
  await inspector.getByRole('radio', { name: 'Bildens egna' }).click();
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
  await page.getByRole('menuitem', { name: 'Bildspel', exact: true }).click(); // + is a menu (spec 03 2f)
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('checkbox', { name: 'Kollekt' }).click();
  await picker.getByRole('button', { name: 'Lägg till Kollekt' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();

  const order = page.getByRole('list', { name: 'Programpunkter' });
  await expect(order.getByRole('button', { name: 'Kollekt', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-page').first()).toContainText('Text');
});

test('an element covered by another is picked by a tap again or from Lager, and moved in the drawing order', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bildspel');
  await page.getByRole('button', { name: /^(Nytt bildspel|Gör ett bildspel)$/ }).click();
  await nameNew(page, 'Lager');
  const canvas = page.getByTestId('slide-canvas');
  for (const kind of ['Text', 'Rektangel'] as const) {
    await addToSlide(page, kind);
  }
  const ids = () => canvas.locator('[data-element]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-element')));
  const [textId, rectId] = await ids();
  // Format is a column or a popover by the editor's width; the inspector is drawn in one of them.
  const shown = (name: string) => page.getByRole('tab', { name, exact: true }).filter({ visible: true });
  const openFormat = async () => {
    // The brush shows and hides it: pressed only when no inspector is in view.
    if (!(await page.getByTestId('inspector').filter({ visible: true }).count())) await page.getByRole('button', { name: 'Format', exact: true }).click();
  };

  // The middle of the page has the rectangle over the text: a tap picks the rectangle, a tap again the text.
  await canvas.click();
  await canvas.click();
  await openFormat();
  await expect(shown('Text')).toBeVisible();

  await shown('Ordna').click();
  const layers = page.getByTestId('layer-list').filter({ visible: true });
  await expect(layers.getByTestId('layer-name')).toHaveText(['Rektangel', 'Text']);
  await layers.getByRole('button', { name: 'Rektangel' }).press('Alt+ArrowDown');
  await expect(layers.getByTestId('layer-name')).toHaveText(['Text', 'Rektangel']);
  await expect.poll(ids).toEqual([rectId, textId]);

  await layers.getByRole('button', { name: 'Rektangel' }).click();
  await expect(shown('Stil')).toBeVisible();
});
