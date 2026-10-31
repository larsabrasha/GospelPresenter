// CCLI-rapport (spec 02 `/admin/ccli-report`, SONG-R48–R52, SONG-A34, SONG-A36): with collection on, a song with a
// CCLI number shown live for 10 s is listed under its presentation and day, and its card is marked reported.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, closeAdmin, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a song with a CCLI number shown for 10 seconds is listed, and its card is marked reported', async () => {
  test.slow();
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'CCLI-rapport');
  await expect(page.getByText('Inga CCLI-poster')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Aktivera CCLI-datainsamling' }).check();
  await createSong(page, 'Amazing Grace', [['Verse', 'Amazing grace']]);
  await page.getByLabel('CCLI', { exact: true }).fill('12345');
  await page.getByLabel('CCLI', { exact: true }).blur();
  await expect(page.getByText('Sparad')).toBeVisible();
  await closeAdmin(page);
  await createPresentation(page, 'Gudstjänst');
  await addSongs(page, ['Amazing Grace']);

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Amazing Grace 1' }).click();
  await page.waitForTimeout(10_500);
  await openAdmin(page, 'CCLI-rapport');

  const card = page.getByRole('region', { name: /^Gudstjänst \d{4}-\d{2}-\d{2}$/ });
  await expect(card).toContainText('Amazing Grace');
  await expect(card).toContainText('12345');
  await page.getByRole('button', { name: 'Orapporterade' }).click();
  await card.getByRole('checkbox', { name: /^Rapporterad/ }).check();
  await expect(card).toBeVisible(); // stays until the filter changes
  await page.getByRole('button', { name: 'Alla', exact: true }).click();
  await page.getByRole('button', { name: 'Orapporterade' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Rapporterade', exact: true }).click();
  await expect(card.getByRole('checkbox', { name: /^Rapporterad/ })).toBeChecked();
});
