// Themes of an organisation's own (docs/themes.md): an admin makes one in Teman, changes it in its editor as a
// slideshow is changed, makes it the default, and the output shows a song in it; deleted, the output is dark again.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, pickItem, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('an own theme, made and changed in its editor, is the default the output shows, until it is deleted', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Amazing Grace', [['Verse', 'Amazing grace']]);

  // + makes a copy of the default, named first, and opens its editor.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Nytt tema' }).click();
  const naming = page.getByRole('dialog', { name: 'Nytt tema' });
  await naming.getByLabel('Namn').fill('Söndag');
  await naming.getByLabel('Namn').press('Enter');
  const canvas = page.getByTestId('theme-canvas');
  await expect(canvas).toBeVisible();

  // A tap on the song's text picks it; Versaler is one of its choices in Format.
  await canvas.getByTestId('slide-text').click();
  await expect(canvas).toHaveAttribute('data-picked', 'main');
  const capitals = page.getByRole('switch', { name: 'Versaler' }).filter({ visible: true });
  if (!(await capitals.count())) await page.getByRole('button', { name: 'Format', exact: true }).click();
  await capitals.click();
  await expect(canvas.getByTestId('slide-text')).toHaveCSS('text-transform', 'uppercase');
  await expect(page.getByTestId('saved')).toBeVisible();
  // Escape closes Format's sheet where the editor is narrow; the sheet would cover Inställningar's list.
  const sheet = page.getByTestId('format-sheet');
  if (await sheet.isVisible()) await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // The default theme, from its sheet in Teman.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Söndag', exact: true }).click();
  await page.getByRole('dialog', { name: 'Söndag' }).getByRole('button', { name: 'Använd som standard' }).click();
  await expect(page.getByRole('status').getByText('Standardtemat sparat')).toBeVisible();

  // A presentation that follows the default shows the song in it on the output.
  await createPresentation(page, 'Gudstjänst');
  await addSongs(page, ['Amazing Grace']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await pickItem(page, 'Amazing Grace');
  await page.getByRole('button', { name: 'Amazing Grace 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Amazing grace');
  await expect(output.getByTestId('slide-text')).toHaveCSS('text-transform', 'uppercase');
  await expect(output.getByTestId('slide-stage')).not.toHaveAttribute('data-theme', 'classic');

  // Deleted, the default is gone with it, and the output is in the dark theme at once.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Söndag', exact: true }).click();
  await page.getByRole('dialog', { name: 'Söndag' }).getByRole('button', { name: 'Ta bort tema' }).click();
  await page.getByRole('dialog', { name: 'Ta bort tema' }).getByRole('button', { name: 'Ta bort tema' }).click();
  await expect(page.getByRole('button', { name: 'Söndag', exact: true })).toHaveCount(0);
  await expect(output.getByTestId('slide-stage')).toHaveAttribute('data-theme', 'classic');
  await expect(output.getByTestId('slide-text')).toHaveCSS('text-transform', 'none');
});
