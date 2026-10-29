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

test('? lists the keys of the page, the dialog or the stage view on screen, and closes again', async () => {
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
  await expect(help.getByRole('listitem').filter({ hasText: 'Byt namn på valt inslag' }).locator('kbd')).toHaveText('F2');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.keyboard.press('a');
  const add = page.getByRole('dialog', { name: 'Lägg till' });
  // Out of the search field, where ? is a letter like any other.
  await add.getByRole('tab', { name: 'Bilder' }).click();
  await add.getByRole('tab', { name: 'Bilder' }).focus();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Lägg till', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Fliken Bibeltext' }).locator('kbd')).toHaveText(/^(Ctrl\+2|⌘2)$/);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(add).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(add).toHaveCount(0);

  // The live page, and the stage view, whose keys replace the live page's; Esc closes the help, not the stage view.
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Live', 'Överallt']);
  await expect(help.getByRole('listitem').filter({ hasText: 'Nästa slide' }).locator('kbd')).toHaveText(['→', 'Space', 'PageDown']);
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'Scenläge' }).click();
  const stage = page.getByTestId('stage-view');
  await stage.getByRole('dialog', { name: 'Välj', exact: true }).getByRole('button', { name: 'Sång A' }).click();
  help = await openHelp(page);
  await expect(help.getByRole('heading')).toHaveText(['Kortkommandon', 'Scenläge', 'Överallt']);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(stage).toBeVisible();
});
