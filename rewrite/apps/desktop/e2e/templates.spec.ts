// Templates (spec 03 "Template", screen 3): made on the templates page or from a
// presentation, edited in the presentation editor under a banner, used to
// make presentations from the start page, and deleted to their own trash.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createSong, openAdmin, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** The next Sunday as `YYYY-MM-DD`, today if it is Sunday before `time` (PRES-A3). */
function nextSunday(time: string, now = new Date()): string {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let days = (7 - now.getDay()) % 7;
  if (days === 0 && hhmm >= time) days = 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('PRES-A30, A3, A31: a template is made, filled, used for a presentation, saved from one and deleted', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);

  // PRES-A30: the templates page, empty, then a template with its weekly slot, opened in the editor.
  await openAdmin(page, 'Mallar');
  await expect(page.getByRole('heading', { name: 'Inga mallar' })).toBeVisible();
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Skapa mall' });
  await create.getByLabel('Namn').fill('Söndag');
  await create.getByLabel('Dag').selectOption({ label: 'Söndag' });
  await create.getByLabel('Tid').fill('11:00');
  await create.getByLabel('Plats').fill('Kyrkan');
  await create.getByRole('button', { name: 'Skapa', exact: true }).click();
  await expect(page.getByText('Du redigerar en mall')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Söndag', exact: true })).toBeVisible();
  await expect(page.getByTestId('schedule')).toHaveText('Söndag 11:00Kyrkan');
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toHaveCount(0);
  await addSongs(page, ['Härlig är jorden']);
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await expect(page.getByRole('menuitem', { name: 'Spara som mall' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // PRES-A3: Skapa on the start page offers the template, and the dialog is prefilled from it.
  await openPresentations(page);
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Skapa presentation' });
  await expect(picker.getByRole('button', { name: 'Tom presentation' })).toBeVisible();
  await picker.getByRole('button', { name: /Söndag.*Söndag 11:00 · Kyrkan/ }).click();
  const details = page.getByRole('dialog', { name: 'Skapa presentation' });
  await expect(details.getByLabel('Namn')).toHaveValue('Söndag');
  await expect(details.getByLabel('Datum')).toHaveValue(nextSunday('11:00'));
  await details.getByLabel('Namn').fill('Söndag 1');
  await details.getByLabel('Namn').press('Enter');
  await expect(page.getByRole('heading', { name: 'Söndag 1', exact: true })).toBeVisible();
  await expect(page.getByText('Du redigerar en mall')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Härlig är jorden/]);
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible();

  // PRES-A31: Spara som mall, then both templates on the templates page.
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Spara som mall' }).click();
  const save = page.getByRole('dialog', { name: 'Spara som mall' });
  await expect(save.getByLabel('Namn')).toHaveValue('Söndag 1');
  await save.getByLabel('Namn').fill('Påsk');
  await save.getByRole('button', { name: 'Spara', exact: true }).click();
  await expect(page.getByRole('status').getByText('Sparad som mall')).toBeVisible();
  await openAdmin(page, 'Mallar');
  const list = page.getByRole('list', { name: 'Mallar' });
  await expect(list.getByRole('listitem')).toHaveText(['Påsk', 'Söndag']);

  // The copy has the song; deleting it goes to the templates' own trash.
  await list.getByRole('link', { name: 'Påsk' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Härlig är jorden/]);
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Radera mall' }).click();
  await expect(page.getByRole('status').getByText('Påsk flyttad till papperskorgen')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(['Söndag']);
  await page.getByRole('link', { name: 'Papperskorg' }).click();
  await expect(page.getByRole('listitem', { name: 'Påsk' })).toContainText('Mall · 30 dagar kvar');
});
