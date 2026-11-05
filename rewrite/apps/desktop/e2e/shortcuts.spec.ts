// The keyboard help (KeyboardShortcuts.razor, ShortcutHelpDialog.razor): `?` lists the keys of what is on screen.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** Opens the help with `?` and returns it, with the titles of its groups. */
async function openHelp(page: Page) {
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Kortkommandon' });
  await expect(help).toBeVisible();
  return help;
}

test('? lists the keys of the page or the dialog on screen, and closes again', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);

  // The start page: its group, then "Överallt", in the old texts.
  await openPresentations(page);
  let help = await openHelp(page);
  await expect(help.getByText('Kortkommandon fungerar när du inte skriver i ett textfält.')).toBeVisible();
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Startsidan', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Ny presentation' }).locator('kbd')).toHaveText('n');
  await expect(help.getByRole('listitem').filter({ hasText: 'Visa kortkommandon' }).locator('kbd')).toHaveText('?');
  await page.keyboard.press('?');
  await expect(help).toHaveCount(0);

  // The editor, and the add dialog above it, which hides the editor's keys.
  await page.getByRole('link', { name: 'Söndag' }).click();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Presentation', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Lägg till i presentationen' }).locator('kbd')).toHaveText('a');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.keyboard.press('a');
  const add = page.getByRole('dialog', { name: 'Lägg till sång' });
  // Out of the search field, where ? is a letter like any other.
  await add.getByRole('button', { name: 'Stäng' }).focus();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Lägg till', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Lägg till' }).first().locator('kbd')).toHaveText(/(Ctrl|⌘).*(↵|Enter)/);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(add).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(add).toHaveCount(0);

  // The live page's keys, a clicker's among them; Esc closes the help.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Live', 'Presentation', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Nästa slide' }).locator('kbd')).toHaveText(['→', 'Space', 'PageDown']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Svart' }).locator('kbd')).toHaveText(['B', '.']);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(page.getByTestId('live-panel')).toBeVisible();
});
