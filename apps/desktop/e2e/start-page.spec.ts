// The start page (spec 03 screen 1, PRES-A5, PRES-A6, PRES-A40): Lista with what is planned by month and what has no
// date folded, Kalender for any month, the past too, and Tabell as a sheet; the view is this device's.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** The date `days` from today, `YYYY-MM-DD`, as the date field takes it. */
function fromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A month's caption as Lista writes it: "November", with the year when it is not this year's. */
function monthCaption(date: string): string {
  const d = new Date(`${date}T12:00`);
  const name = d.toLocaleDateString('sv', { month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Next week's, an undated and last week's presentation, and the start page open. */
async function threePresentations(page: Page) {
  await createPresentation(page, 'Nästa vecka', fromToday(7));
  await createPresentation(page, 'Utkast');
  await createPresentation(page, 'Förra veckan', fromToday(-7));
  await openPresentations(page);
}

test('Lista shows what is planned by month, folds what has no date, and leaves the past out', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);

  await expect(page.getByRole('list', { name: monthCaption(fromToday(7)) }).getByRole('link', { name: /^Nästa vecka/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Utkast/ })).toHaveCount(0);
  await page.getByRole('button', { name: /1 utan datum/ }).click();
  await expect(page.getByRole('link', { name: /^Utkast/ })).toBeVisible();
  await page.getByRole('link', { name: 'Mallar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mallar', exact: true })).toBeVisible();
});

test('Kalender goes back to a past month, shows a day picked, and is still chosen after a reload', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);
  const lastWeek = fromToday(-7);

  await page.getByRole('radio', { name: 'Kalender' }).click();
  if (lastWeek.slice(0, 7) !== fromToday(0).slice(0, 7)) await page.getByRole('button', { name: 'Föregående månad' }).click();
  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toBeVisible();
  const day = new Date(`${lastWeek}T12:00`).toLocaleDateString('sv', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  await page.getByRole('button', { name: day, exact: true }).click();
  await expect(page.getByRole('link', { name: /^(Förra veckan|Nästa vecka)/ })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Kalender' })).toHaveAttribute('aria-checked', 'true');
});

test('Tabell takes the past in when asked, sorts by a column caption, and hides a column', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);
  await page.getByRole('radio', { name: 'Tabell' }).click();
  const names = page.getByRole('table').getByRole('link');

  await expect(names).toHaveText(['Nästa vecka', 'Utkast']);
  await page.getByRole('switch', { name: 'Tidigare' }).check();
  await expect(names).toHaveText(['Förra veckan', 'Nästa vecka', 'Utkast']);
  await page.getByRole('columnheader', { name: 'Namn' }).getByRole('button').click();
  // In Swedish order: Förra veckan, Nästa vecka, Utkast; by name the months go, one list.
  await expect(names).toHaveText(['Förra veckan', 'Nästa vecka', 'Utkast']);
  await page.getByRole('columnheader', { name: 'Namn' }).getByRole('button').click();
  await expect(names).toHaveText(['Utkast', 'Nästa vecka', 'Förra veckan']);
  await page.getByRole('button', { name: 'Kolumner' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Plats' }).click();
  await expect(page.getByRole('columnheader', { name: 'Plats' })).toHaveCount(0);
});
