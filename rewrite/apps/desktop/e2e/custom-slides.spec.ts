// Custom slides (docs/custom-slides.md): one made in Inställningar → Egna slides, a text and a shape put on it from
// +, undone and done again, and the slide added to a presentation from Lägg till's Egna slides, drawn there.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { closeAdmin, createPresentation, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a custom slide is made with a text and a rectangle, undone and redone, and added to a presentation', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Egna slides');
  await page.getByRole('button', { name: 'Ny slide' }).click();
  const naming = page.getByRole('dialog', { name: 'Ny slide' });
  await naming.getByLabel('Namn').fill('Kollekt');
  await naming.getByLabel('Namn').press('Enter');
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

  // In the library under Välj, the slide is drawn as wide as outside it (it was 0 wide once).
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await expect.poll(async () => (await page.getByRole('checkbox', { name: 'Kollekt' }).getByTestId('custom-page').boundingBox())?.width ?? 0).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Klar', exact: true }).click();
  await closeAdmin(page);

  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+7');
  await picker.getByRole('checkbox', { name: 'Kollekt' }).click();
  await picker.getByRole('button', { name: 'Lägg till Kollekt' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();

  const order = page.getByRole('list', { name: 'Programpunkter' });
  await expect(order.getByRole('button', { name: 'Kollekt', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-page').first()).toContainText('Text');
});
