// Programme points and comments in the running order (spec 03 2f, PRES-A38, A39): + is a menu with Programpunkt under
// the kinds, an item's menu puts a point right before it, presenting steps over a point, and a comment never reaches a
// screen.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, pickItem, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a programme point from + and one above an item stand in the running order, and presenting steps over them (PRES-A38)', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  const rows = page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem');

  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Programpunkt' }).click();
  const named = page.getByRole('dialog', { name: 'Ny programpunkt' });
  await named.getByLabel('Till exempel Kollekt eller Bön').fill('Kollekt');
  await named.getByRole('button', { name: 'Lägg till' }).click();
  await rows.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ny programpunkt ovanför' }).click();
  await named.getByLabel('Till exempel Kollekt eller Bön').fill('Predikan');
  await named.getByRole('button', { name: 'Lägg till' }).click();

  await expect(rows).toHaveText([/Sång A/, /Predikan/, /Sång B/, /Kollekt/]);
  await expect(page.getByTestId('live-slides').getByRole('region', { name: 'Predikan' })).toBeVisible();

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await pickItem(page, 'Sång A');
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
});

test("an item's comment shows under its name and not on the output (PRES-A39)", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);

  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Kommentar' }).click();
  const noting = page.getByRole('dialog', { name: 'Kommentar' });
  await noting.getByLabel('Kommentar').fill('Solosång, men texten ska visas ändå');
  await noting.getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByRole('region', { name: 'Sång A' }).getByTestId('item-note')).toHaveText('Solosång, men texten ska visas ändå');

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(output.getByText('Solosång')).toHaveCount(0);
});
