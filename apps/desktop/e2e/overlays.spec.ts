// Overlays (spec 03 §4, spec 04 LIVE-R15, R16 as changed in TODO.md, docs/custom-slides.md): made under Överlägg
// in the custom slides' editor, carried by an item, toggled during live, switched off by Släck.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createOverlay, createPresentation, createSong, openAdmin, pickItem, setUpHost, typePastLimit } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('an item carries its overlay while live; a manual toggle lasts until the item changes; Släck switches it off', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  await createOverlay(page, 'Välkommen', 'Välkommen hit');
  await openAdmin(page, 'Överlägg');
  await expect(page.getByTestId('overlay-card')).toHaveCount(2);

  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  // Sång A carries Kollekt, chosen under its heading: its tiles show it. The middle shows the item selected alone.
  await pickItem(page, 'Sång A');
  await page.getByRole('region', { name: 'Sång A' }).getByRole('button', { name: 'Fler val för Sång A' }).click();
  await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
  await page.getByRole('menuitemradio', { name: 'Kollekt' }).click();
  // The … closes on a press outside it, also from a heading that sticks (its blur once held the cover to it).
  await page.getByRole('region', { name: 'Sång A' }).getByRole('button', { name: 'Fler val för Sång A' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  // A press in the middle's own margin, beside the item shown alone there.
  await page.getByTestId('live-slides').click({ position: { x: 5, y: 300 } });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Sång A' }).getByTestId('slide-overlay').first()).toHaveText('Swish 123 45');

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  const overlay = output.getByTestId('slide-overlay');

  // On when the item goes live, kept through its slides, off when it leaves.
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(overlay).toHaveText('Swish 123 45');
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await expect(overlay).toHaveText('Swish 123 45');
  await pickItem(page, 'Sång B');
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(overlay).toHaveCount(0);

  // Switched off by hand, it stays off within the item; back on the item, it comes on again.
  await pickItem(page, /^Sång A/); // its row names its overlay too
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(overlay).toHaveText('Swish 123 45');
  const toggles = page.getByRole('list', { name: 'Överlägg' });
  await toggles.getByLabel('Kollekt').uncheck();
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await expect(overlay).toHaveCount(0);
  await pickItem(page, 'Sång B');
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await pickItem(page, /^Sång A/); // its row names its overlay too
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(overlay).toHaveText('Swish 123 45');

  // Another overlay chosen by hand replaces it (LIVE-R15), and stays when the item is left.
  await toggles.getByLabel('Välkommen').check();
  await expect(overlay).toHaveText('Välkommen hit');
  await expect(toggles.getByLabel('Kollekt')).not.toBeChecked();
  await pickItem(page, 'Sång B');
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(overlay).toHaveText('Välkommen hit');

  // Släck switches it off; the next slide comes back without it. The black screen fades in and out over 500 ms,
  // a cover above the slide and the overlay, as LiveDisplay.razor's.
  const cover = output.getByTestId('black-cover');
  await expect(cover).toHaveCSS('opacity', '0');
  await expect(cover).toHaveCSS('transition-duration', '0.5s');
  await expect(cover).toHaveCSS('z-index', '60');
  await page.getByRole('button', { name: 'Släck' }).click();
  await expect(cover).toHaveCSS('opacity', '1');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(cover).toHaveCSS('opacity', '0');
  await expect(overlay).toHaveCount(0);

  // The shown item's own overlay, changed in its …, shows at once, and goes at once when it is set to none.
  const menuB = page.getByRole('region', { name: 'Sång B' }).getByRole('button', { name: 'Fler val för Sång B' });
  await menuB.click();
  await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
  await page.getByRole('menuitemradio', { name: 'Kollekt' }).click();
  await expect(overlay).toHaveText('Swish 123 45');
  await menuB.click();
  await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
  await page.getByRole('menuitemradio', { name: 'Ingen' }).click();
  await expect(overlay).toHaveCount(0);
});

test('a refused overlay save says "Kunde inte spara", in the overlay and on an item', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const failed = page.getByRole('alert').getByText('Kunde inte spara');

  // A text is at most 2 000 characters; past the field's own limit, the page's write is refused.
  const field = page.getByRole('textbox', { name: 'Text', exact: true });
  await typePastLimit(field, 'x'.repeat(2001));
  await expect(failed).toBeVisible();

  // An overlay that does not exist, chosen for an item: refused, and the item carries none.
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Sång A', exact: true }).click();
  await expect(failed).toHaveCount(0, { timeout: 6000 });
  await page.getByRole('region', { name: 'Sång A' }).getByRole('button', { name: 'Fler val för Sång A' }).click();
  await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
  const choice = page.getByRole('menuitemradio').nth(1);
  await choice.evaluate((el) => (el as HTMLElement).setAttribute('data-choice', 'no-such-overlay'));
  await choice.click();
  await expect(failed).toBeVisible();
  await page.getByRole('region', { name: 'Sång A' }).getByRole('button', { name: 'Fler val för Sång A' }).click();
  await page.getByRole('menuitem', { name: /^Överlägg/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Ingen' })).toHaveAttribute('aria-checked', 'true');
});

test('an overlay is one page in the editor, shown in the list, and deleted from it after a question', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await createOverlay(page, 'Kollekt', 'Swish 123\nTack!');

  // One page: no pages to add, as a custom slide has.
  await expect(page.getByRole('button', { name: 'Ny sida' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  const card = page.getByTestId('overlay-card');
  await expect(card).toContainText('Swish 123');
  await expect(card).toContainText('Kollekt');

  // Deleting is permanent, after a question (PRES-R29).
  await card.getByRole('link', { name: 'Kollekt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Inga överlägg')).toBeVisible();
  await expect(page.getByText('Kollekt borttaget')).toBeVisible();
});

test("on a phone an item's overlay is a row of its sheet, the chosen one in grey, and it shows by the item's heading", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const order = page.getByTestId('live-order');
  await order.getByRole('button', { name: 'Mer om Sång A' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sång A' });

  await sheet.getByRole('combobox', { name: 'Överlägg' }).selectOption({ label: 'Kollekt' });

  await expect(sheet.getByRole('combobox', { name: 'Överlägg' }).locator('option:checked')).toHaveText('Kollekt');
  await sheet.getByRole('button', { name: 'Stäng' }).click();
  await expect(order.getByRole('region', { name: 'Sång A' })).toContainText('Kollekt');
});

test('the overlay is edited over a song, a Bible text or nothing, a checkerboard, as chosen under Exempelslide', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const canvas = page.getByTestId('slide-canvas');
  const behind = page.getByRole('radiogroup', { name: 'Exempelslide' });

  await expect(canvas).toContainText('Amazing grace');
  await behind.getByRole('radio', { name: 'Bibeltext' }).click();
  await expect(canvas).toContainText('Ty så älskade Gud världen');
  await behind.getByRole('radio', { name: 'Ingen' }).click();

  await expect(canvas).not.toContainText('Ty så älskade Gud världen');
  await expect(canvas.getByTestId('see-through')).toBeVisible();
  await expect(canvas).toContainText('Swish 123 45');
});

test('a point of Placering på sliden puts the picked text there, as far from the top as from the side, lined up to that side', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const canvas = page.getByTestId('slide-canvas');
  const text = canvas.locator('[data-element]').filter({ hasText: 'Swish 123 45' });

  await page.getByRole('tab', { name: 'Ordna' }).filter({ visible: true }).click();
  await page.getByRole('radio', { name: 'Uppe till vänster' }).filter({ visible: true }).click();

  const [box, slide] = [(await text.boundingBox())!, (await canvas.boundingBox())!];
  const inset = slide.height * 0.05;
  expect(Math.abs(box.x - slide.x - inset)).toBeLessThan(2);
  expect(Math.abs(box.y - slide.y - inset)).toBeLessThan(2);
  await page.getByRole('tab', { name: 'Text' }).filter({ visible: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Justering' }).getByRole('radio', { name: 'Vänster' })).toHaveAttribute('aria-checked', 'true');
});

test('a text box is made taller by its bottom handle, and lower again', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const text = page.getByTestId('slide-canvas').locator('[data-element]').filter({ hasText: 'Swish 123 45' });
  const handle = page.locator('.moveable-control.moveable-s');
  const drag = async (by: number) => {
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + by, { steps: 8 });
    await page.mouse.up();
  };
  await drag(60);
  const taller = (await text.boundingBox())!.height;

  await drag(-40);

  await expect.poll(async () => (await text.boundingBox())!.height).toBeLessThan(taller - 20);
});

test("an overlay's text has a theme's text's choices: its weight and shadow are drawn on the slide, and saved", async () => {
  // Arrange
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const text = page.getByTestId('slide-canvas').locator('[data-element]').filter({ hasText: 'Swish 123 45' });

  // Act
  await page.getByRole('radiogroup', { name: 'Vikt' }).getByRole('radio', { name: 'Halvfet' }).click();
  await page.getByRole('switch', { name: 'Skugga' }).filter({ visible: true }).click();

  // Assert
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(text).toHaveCSS('font-weight', '600');
  await expect(text).not.toHaveCSS('text-shadow', 'none');
});
