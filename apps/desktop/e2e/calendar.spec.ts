// The calendar on the start page (docs/planning.md): empty, it says what it is for; a church's sheet imported becomes
// events, edited in Tabell; an event from Ny händelse gets a member in a field and a presentation, which shows the event
// it belongs to; a presentation made with a date is an event; "Med presentation" shows only those. The names are made up.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** The date `days` from today, `YYYY-MM-DD`. */
function fromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A picture for whoever checks the look by eye, when GP_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  if (process.env.GP_SHOTS) await page.screenshot({ path: `${process.env.GP_SHOTS}/${name}.png`, fullPage: true });
}

/** The start page, under the church's name. */
async function openCalendar(page: Page) {
  await openPresentations(page);
  await expect(page.getByRole('heading', { name: 'Lilla Kyrkan', exact: true })).toBeVisible();
}

test('Kalender says what it is for; a sheet imported becomes events, and a cell is edited in Tabell', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openCalendar(page);
  await expect(page.getByText('Planera det som händer')).toBeVisible();
  await shot(page, 'calendar-empty');
  const sheet = ['Datum och tid;Samling;Predikan;Ljud', `${fromToday(7)} kl 11;Gudstjänst;Johan Lind;`, `${fromToday(12)} kl 15-18;Fredagscafé;;`, `${fromToday(-7)} kl 11;Förra söndagen;;`, 'Någon gång i vår;Utflykt;;'].join('\n');

  await page.getByRole('button', { name: 'Importera från Excel' }).click();
  await page.getByTestId('sheet-file').setInputFiles({ name: 'program.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet) });
  await expect(page.getByText('Hittade 3 händelser.')).toBeVisible();
  await expect(page.getByText('Någon gång i vår · Utflykt')).toBeVisible();
  await page.getByRole('button', { name: 'Importera 3' }).click();
  await page.getByRole('radio', { name: 'Tabell' }).click();

  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: 'Gudstjänst' })).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Datum och tid', 'Händelse', 'Skärm', 'Predikan']);
  await table.getByRole('button', { name: 'Lägg till Predikan på Fredagscafé' }).click();
  const cell = table.getByRole('combobox', { name: 'Predikan, Fredagscafé' });
  await cell.fill('Erik Holm');
  await cell.press('Enter');
  await expect(table.getByText('Erik Holm')).toBeVisible();
  await shot(page, 'calendar-table');
  await page.getByRole('button', { name: 'Tidigare händelser (1)' }).click();
  await expect(table.getByRole('link', { name: 'Förra söndagen' })).toBeVisible();
});

test('an event from Ny händelse gets a member in a field and a presentation, which shows the event', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openCalendar(page);

  await page.getByRole('button', { name: 'Ny händelse' }).first().click();
  await page.getByRole('button', { name: /^Gudstjänst/ }).click();
  await expect(page.getByRole('combobox', { name: 'Predikan' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Predikan' }).fill('Ann');
  await page.getByRole('option', { name: /Anna/ }).click();
  await expect(page.getByRole('link', { name: 'Anna', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tid', { exact: true })).toHaveValue('11:00');
  await shot(page, 'event-page');
  // A click, not check(): the switch follows the saved event, so it turns once the change is written.
  await page.getByRole('switch', { name: 'Hela dagen' }).click();
  await expect(page.getByRole('switch', { name: 'Hela dagen' })).toBeChecked();
  await expect(page.getByLabel('Tid', { exact: true })).toHaveCount(0);
  await shot(page, 'event-all-day');
  await page.getByRole('button', { name: 'Skapa presentation' }).click();

  await expect(page.getByRole('link', { name: /^I kalendern: Gudstjänst/ })).toBeVisible();
  await page.getByRole('link', { name: /^I kalendern: Gudstjänst/ }).click();
  await expect(page.getByRole('link', { name: /^Gudstjänst/ }).filter({ hasText: 'programpunkter' })).toBeVisible();
});

test('a presentation made with a date is in Kalender, its event', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await createPresentation(page, 'Advent', fromToday(7), '11:00');
  await openCalendar(page);

  await expect(page.getByRole('link', { name: /^Advent/ })).toBeVisible();
});

test('"Med presentation" shows only the events that have a presentation, and is still chosen after a reload', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Advent', fromToday(7), '11:00');
  await openCalendar(page);
  await page.getByRole('button', { name: 'Ny', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ny händelse' }).click();
  await page.getByRole('button', { name: /^Tom händelse/ }).click();
  await page.getByLabel('Titel').fill('Fredagscafé');
  await openCalendar(page);
  await expect(page.getByRole('link', { name: /^Fredagscafé/ })).toBeVisible();
  await shot(page, 'start-today');

  await page.getByRole('button', { name: 'Med presentation' }).click();

  await expect(page.getByRole('link', { name: /^Fredagscafé/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Advent/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Med presentation' })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'start-filtered');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'start-filtered-phone');
});
