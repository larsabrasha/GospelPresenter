// Several organisations (spec 01 `/admin/organizations` and the switcher, ORG-A9–A11, decided on 2026-10-31): the
// Superadmin, in superadminläge, makes one and lands among its users, each organisation has its own songs, the picture's Byt organisation moves between
// them, and deleting one needs its name typed.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { closeAdmin, createSong, openAdmin, openPresentations, setUpHost, superMode } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('an organisation is made, switched to and from, keeps its own songs, and is deleted with its name typed', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Bara hemma', [['Verse', 'Ett']]);
  await superMode(page);

  await openAdmin(page, 'Alla organisationer');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa organisation' });
  await dialog.getByLabel('Namn').fill('Annexet');
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();

  // The page loads again in Annexet, among its users, which are none yet.
  await expect(page.getByTestId('me')).toHaveAttribute('aria-label', 'Anna · Annexet'); // under the dialog
  await expect(page.getByRole('heading', { name: 'Användare', exact: true })).toBeVisible();
  await expect(page.getByText('Inga användare')).toBeVisible();
  await openAdmin(page, 'Sånger');
  await expect(page.getByRole('link', { name: 'Bara hemma' })).toHaveCount(0);

  await closeAdmin(page);
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Byt organisation' }).click();
  await page.getByRole('menuitem', { name: 'Lilla Kyrkan' }).click();
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');
  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
  await openAdmin(page, 'Sånger');
  await expect(page.getByRole('link', { name: 'Bara hemma' })).toBeVisible();

  await openAdmin(page, 'Alla organisationer');
  await page.getByRole('link', { name: /Annexet/ }).click();
  await page.getByRole('button', { name: 'Radera organisation' }).click();
  const confirm = page.getByRole('dialog', { name: 'Radera organisation' });
  await confirm.getByLabel('Skriv Annexet för att bekräfta:').fill('annexet');
  await expect(confirm.getByRole('button', { name: 'Radera' })).toBeDisabled();
  await confirm.getByLabel('Skriv Annexet för att bekräfta:').fill('Annexet');
  await confirm.getByRole('button', { name: 'Radera' }).click();

  const list = page.getByRole('list', { name: 'Alla organisationer' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Lilla Kyrkan');
  await openPresentations(page);
});

test('the organisation the Superadmin is in is refused deletion while it is their only one', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await superMode(page);

  await openAdmin(page, 'Alla organisationer');
  await page.getByRole('link', { name: /Lilla Kyrkan/ }).click();
  await page.getByRole('button', { name: 'Radera organisation' }).click();
  const confirm = page.getByRole('dialog', { name: 'Radera organisation' });
  await confirm.getByLabel('Skriv Lilla Kyrkan för att bekräfta:').fill('Lilla Kyrkan');
  await confirm.getByRole('button', { name: 'Radera' }).click();

  await expect(confirm.getByRole('alert')).toBeVisible();
});
