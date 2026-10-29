// Overlays (spec 03 §4, spec 04 LIVE-R15, R16 as changed in TODO.md): made under
// Overlays, carried by an item, toggled during live, switched off by Rensa.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, dropFiles, openAdmin, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

async function createOverlay(page: Page, title: string, text: string) {
  await openAdmin(page, 'Overlays');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa overlay' });
  await dialog.getByLabel('Namn').fill(title);
  await dialog.getByLabel('Namn').press('Enter');
  const content = page.getByLabel('Textinnehåll');
  await content.fill(text);
  await content.blur();
  await expect(page.getByTestId('slide-overlay')).toHaveText(text); // the preview
}

test('an item carries its overlay while live; a manual toggle lasts until the item changes; Rensa switches it off', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  await createOverlay(page, 'Välkommen', 'Välkommen hit');
  await openAdmin(page, 'Overlays');
  await expect(page.getByRole('list', { name: 'Overlays' }).getByRole('listitem')).toHaveCount(2);

  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  // Sång A carries Kollekt: the editor's tiles show it, and the running order names it.
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Sång A', exact: true }).click();
  await page.getByRole('combobox', { name: 'Overlay' }).selectOption({ label: 'Kollekt' });
  await expect(page.getByRole('list', { name: 'Sång A' }).getByTestId('slide-overlay').first()).toHaveText('Swish 123 45');
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByText('Kollekt')).toBeVisible();

  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();
  const overlay = output.getByTestId('slide-overlay');

  // On when the item goes live, kept through its slides, off when it leaves.
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(overlay).toHaveText('Swish 123 45');
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await expect(overlay).toHaveText('Swish 123 45');
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(overlay).toHaveCount(0);

  // Switched off by hand, it stays off within the item; back on the item, it comes on again.
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(overlay).toHaveText('Swish 123 45');
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  const toggles = page.getByRole('list', { name: 'Overlays' });
  await toggles.getByLabel('Kollekt').uncheck();
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(overlay).toHaveText('Swish 123 45');

  // Another overlay chosen by hand replaces it (LIVE-R15), and stays when the item is left.
  await toggles.getByLabel('Välkommen').check();
  await expect(overlay).toHaveText('Välkommen hit');
  await expect(toggles.getByLabel('Kollekt')).not.toBeChecked();
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(overlay).toHaveText('Välkommen hit');

  // Rensa switches it off; the next slide comes back without it. The black screen fades in and out over 500 ms,
  // a cover above the slide and the overlay, as LiveDisplay.razor's.
  const cover = output.getByTestId('black-cover');
  await expect(cover).toHaveCSS('opacity', '0');
  await expect(cover).toHaveCSS('transition-duration', '0.5s');
  await expect(cover).toHaveCSS('z-index', '60');
  await page.getByRole('button', { name: 'Rensa' }).click();
  await expect(cover).toHaveCSS('opacity', '1');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Sång B 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await expect(cover).toHaveCSS('opacity', '0');
  await expect(overlay).toHaveCount(0);

  // The stage view has the same toggles, with a dot while one is on.
  await page.getByRole('button', { name: 'Scenläge' }).click();
  const stage = page.getByTestId('stage-view');
  await expect(stage.getByTestId('overlay-on')).toHaveCount(0);
  await stage.getByRole('button', { name: 'Visa/dölj overlays' }).click();
  await stage.getByRole('dialog', { name: 'Overlays' }).getByLabel('Välkommen').check();
  await expect(overlay).toHaveText('Välkommen hit');
  await expect(stage.getByTestId('overlay-on')).toHaveCount(1);
});

test('a refused overlay save says "Kunde inte spara", in the overlay and on an item', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createOverlay(page, 'Kollekt', 'Swish 123 45');
  const failed = page.getByRole('alert').getByText('Kunde inte spara');

  // The text is at most 2 000 characters; without the field's own limit, the write is refused.
  const content = page.getByLabel('Textinnehåll');
  await content.evaluate((el) => el.removeAttribute('maxlength'));
  await content.fill('x'.repeat(2001));
  await content.blur();
  await expect(failed).toBeVisible();
  await expect(page.getByTestId('slide-overlay')).toHaveText('Swish 123 45');

  // An overlay that does not exist, chosen for an item: refused, and the item carries none.
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Sång A', exact: true }).click();
  await expect(failed).toHaveCount(0, { timeout: 6000 });
  const select = page.getByRole('combobox', { name: 'Overlay' });
  await select.evaluate((el) => {
    (el as HTMLSelectElement).options[1]!.value = 'no-such-overlay';
  });
  await select.selectOption({ index: 1 });
  await expect(failed).toBeVisible();
  await expect(select).toHaveValue('');
});

test('an overlay saves as you type, takes a dropped picture into Bilder, and goes back to the list when deleted or unknown', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Overlays');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Namn').fill('Kollekt');
  await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Namn').press('Enter');

  // Saved 500 ms after typing, with "Sparad" in the header, without leaving the field (OverlayEditor.razor).
  await page.getByLabel('Textinnehåll').fill('Swish 123\nTack!');
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.getByTestId('slide-overlay')).toHaveText('Swish 123\nTack!');

  // A picture dropped on the picture's area goes into Bilder and becomes the overlay's.
  const area = page.locator('[data-dropzone]').filter({ hasText: 'Bild (valfritt)' });
  await dropFiles(area, [{ name: 'Swish.png', mimeType: 'image/png', buffer: solidPng(320, 180, [14, 165, 233]) }]);
  await expect(page.getByRole('button', { name: 'Byt bild' })).toBeVisible();
  await expect(area.getByRole('img', { name: 'Swish.png' })).toBeVisible();

  // The list shows the whole text, cut short by its width, not only its first line.
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  const row = page.getByRole('list', { name: 'Overlays' }).getByRole('listitem');
  await expect(row).toContainText('Swish 123 Tack!');

  // Deleted: back to the list, with no toast.
  await row.getByRole('link').click();
  await page.getByRole('button', { name: 'Radera', exact: true }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page).toHaveURL(/\/admin\/overlays$/);
  await expect(page.getByText('Inga overlays')).toBeVisible();
  await expect(page.getByText('Kollekt borttagen')).toHaveCount(0);

  // An overlay that does not exist goes back to the list (OverlayDetail.razor).
  await page.goto(`${host.base}/admin/overlays/no-such-overlay`);
  await expect(page).toHaveURL(/\/admin\/overlays$/);

  await openAdmin(page, 'Bilder');
  await expect(page.getByTestId('image-card').getByRole('img', { name: 'Swish.png' })).toBeVisible();
});
