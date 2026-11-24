// Themes of an organisation's own (docs/themes.md): an admin makes one in Teman, changes it in its editor as a
// slideshow is changed, makes it the default, and the output shows a song in it; deleted, the output is dark again.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, nameNew, openAdmin, pickItem, setUpHost } from './flows.ts';

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

  // + makes a copy of the default at once and opens its editor, its name picked to type over.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Nytt tema' }).click();
  await nameNew(page, 'Söndag');
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

  // The default theme, from its ⋯ in Teman.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Fler val för Söndag' }).click();
  await page.getByRole('menuitem', { name: 'Använd som standard' }).click();
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
  await page.getByRole('button', { name: 'Fler val för Söndag' }).click();
  await page.getByRole('menuitem', { name: 'Ta bort tema' }).click();
  await page.getByRole('dialog', { name: 'Ta bort tema' }).getByRole('button', { name: 'Ta bort tema' }).click();
  await expect(page.getByRole('button', { name: 'Söndag', exact: true })).toHaveCount(0);
  await expect(output.getByTestId('slide-stage')).toHaveAttribute('data-theme', 'classic');
  await expect(output.getByTestId('slide-text')).toHaveCSS('text-transform', 'none');
});

test("a theme's menu, right-clicked on its tile or from its ⋯; a tap opens an own one; Välj deletes own ones, Escape one step at a time", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Teman');

  // A built-in theme is copied, not edited or deleted, and is not marked under Välj.
  await page.getByRole('img', { name: 'Ljust', exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Ljust' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Använd som standard', 'Duplicera']);
  await menu.getByRole('menuitem', { name: 'Duplicera' }).click();
  await expect(page.getByTestId('theme-canvas')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Namn', exact: true }).filter({ visible: true })).toHaveValue('Kopia av Ljust');

  // The copy's ⋯ has what an own one can do; a tap on it opens its editor, with no sheet in between.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Fler val för Kopia av Ljust' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Använd som standard', 'Redigera', 'Duplicera', 'Ta bort tema']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kopia av Ljust', exact: true }).click();
  await expect(page.getByTestId('theme-canvas')).toBeVisible();

  // Välj: only own ones are ticked. Escape closes the question over it, then ends Välj, and Inställningar stays.
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Kopia av Ljust' }).click();
  const bar = page.getByRole('toolbar', { name: 'Markerade' });
  await bar.getByRole('button', { name: 'Radera' }).click();
  const confirm = page.getByRole('dialog', { name: 'Ta bort tema' });
  await expect(confirm).toContainText('Ta bort Kopia av Ljust?');
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Teman' })).toBeVisible();

  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await page.getByRole('button', { name: 'Markera alla' }).click();
  await bar.getByRole('button', { name: 'Radera' }).click();
  await confirm.getByRole('button', { name: 'Ta bort tema' }).click();
  await expect(page.getByRole('button', { name: 'Kopia av Ljust', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Välj', exact: true })).toHaveCount(0);
});
