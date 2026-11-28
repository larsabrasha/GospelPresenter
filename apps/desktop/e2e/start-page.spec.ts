// The start page (docs/planning.md, "One list"): under the church's name, what happens as Lista or Tabell, each row an
// event; Lista by month with presentations without a date folded and the past behind a button where it ends; Välj dag,
// a filter, a month above it, the past too; Tabell as a sheet; a search; the view and the filters are this device's.
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

test('Lista shows what is planned by month under the church’s name, folds what has no date, and keeps the past behind a button', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);

  await expect(page.getByRole('heading', { name: 'Lilla Kyrkan', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: monthCaption(fromToday(7)) }).getByRole('link', { name: /^Nästa vecka/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Utkast/ })).toHaveCount(0);
  await page.getByRole('button', { name: /1 utan datum/ }).click();
  await expect(page.getByRole('link', { name: /^Utkast/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tidigare händelser (1)' }).click();
  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fler val' }).click();
  await page.getByRole('menuitem', { name: 'Mallar för presentationer' }).click();
  await expect(page.getByRole('heading', { name: 'Mallar', exact: true })).toBeVisible();
});

test('Välj dag, a filter, goes back to a past month, shows a day picked, and is still on after a reload', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);
  const lastWeek = fromToday(-7);

  await page.getByRole('button', { name: 'Välj dag', exact: true }).click();
  if (lastWeek.slice(0, 7) !== fromToday(0).slice(0, 7)) await page.getByRole('button', { name: 'Föregående månad' }).click();
  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toBeVisible();
  const day = new Date(`${lastWeek}T12:00`).toLocaleDateString('sv', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  await page.getByRole('button', { name: day, exact: true }).click();
  await expect(page.getByRole('link', { name: /^(Förra veckan|Nästa vecka)/ })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Välj dag', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (process.env.GP_SHOTS) await page.screenshot({ path: `${process.env.GP_SHOTS}/start-month.png` });
});

test('Tabell is the sheet of what is planned, and takes the past in when asked', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);
  await page.getByRole('radio', { name: 'Tabell' }).click();
  const names = page.getByRole('table').getByRole('link', { name: /^(Nästa vecka|Förra veckan)$/ });

  await expect(names).toHaveText(['Nästa vecka']);
  await page.getByRole('button', { name: 'Tidigare händelser (1)' }).click();
  await expect(names).toHaveText(['Förra veckan']);
});

test('the search finds an event by a name in its fields, past ones too', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await threePresentations(page);

  await page.getByRole('searchbox', { name: 'Sök' }).fill('förra');

  await expect(page.getByRole('link', { name: /^Förra veckan/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Nästa vecka/ })).toHaveCount(0);
});
