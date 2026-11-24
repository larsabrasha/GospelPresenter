// The menu bar (apps/desktop/src/menu.ts): its choices press the page's own keys, and Inställningar… opens the dialog.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, adminDialog, createPresentation, createSong, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** Clicks a choice of the app's menu bar, found by its id. */
async function choose(app: Desktop['app'], id: string) {
  await app.evaluate(({ Menu }, menuId) => Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click(), id);
}

test('the menu bar steps through the slides and blacks the output as the keys do, and opens Inställningar', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  await choose(host.app, 'next-slide');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await choose(host.app, 'previous-slide');
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await choose(host.app, 'black');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);

  await choose(host.app, 'settings');
  await expect(adminDialog(page)).toBeVisible();
});
