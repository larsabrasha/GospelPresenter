// The libraries' common page (apps/web/src/ui/Library.tsx), on Sånger: Välj marks items, a Shift-click a range, and
// Radera trashes them all;
// a song's menu, opened by a right click, renames it.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('Välj marks songs, a Shift-click the ones between, Markera alla the rest, and Radera trashes them all after one question', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Alfa', []);
  await createSong(page, 'Beta', []);
  await createSong(page, 'Gamma', []);
  await openAdmin(page, 'Sånger');

  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Alfa' }).click();
  await expect(page.getByRole('toolbar', { name: 'Markerade' })).toContainText('1 markerad');
  // Shift: from the song clicked before to this one, across the letters' sections; on a marked one, unmarked again.
  await page.getByRole('checkbox', { name: 'Gamma' }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: 'Markerade' })).toContainText('3 markerade');
  await page.getByRole('checkbox', { name: 'Beta' }).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: 'Markerade' })).toContainText('1 markerad');
  await expect(page.getByRole('checkbox', { name: 'Alfa' })).toBeChecked();
  await page.getByRole('button', { name: 'Markera alla' }).click();
  await expect(page.getByRole('toolbar', { name: 'Markerade' })).toContainText('3 markerade');
  await page.getByRole('toolbar', { name: 'Markerade' }).getByRole('button', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();

  await expect(page.getByText('3 flyttade till papperskorgen')).toBeVisible();
  await expect(page.getByText('Inga sånger i biblioteket ännu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Välj', exact: true })).toHaveCount(0);
});

test('a song’s menu renames it, and Escape ends Välj without closing the page', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Gammalt namn', []);
  await openAdmin(page, 'Sånger');

  // A song has no ⋯ (its page renames and deletes it); held or right-clicked, it has the menu.
  await expect(page.getByRole('button', { name: 'Fler val för Gammalt namn' })).toHaveCount(0);
  await page.getByRole('list', { name: 'Sånger' }).getByText('Gammalt namn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Byt namn' }).click();
  const dialog = page.getByRole('dialog', { name: 'Byt namn' });
  await dialog.getByLabel('Namn').fill('Nytt namn');
  await dialog.getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByRole('list', { name: 'Sånger' }).getByText('Nytt namn')).toBeVisible();

  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Välj', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
