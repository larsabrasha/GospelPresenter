// Steps the e2e tests share, written as a user would do them.
import { expect, type Page } from '@playwright/test';

/** Creates a song with labelled parts and stays in its editor. */
export async function createSong(page: Page, name: string, parts: [string, string][]) {
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa sång' });
  await dialog.getByLabel('Namn').fill(name);
  await dialog.getByLabel('Namn').press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  for (const [i, [label, text]] of parts.entries()) {
    await page.getByRole('button', { name: 'Lägg till del' }).click();
    const part = page.getByLabel(`Delar ${i + 1}`, { exact: true });
    await part.fill(text);
    await part.blur();
    await page.getByRole('combobox', { name: 'Delar' }).nth(i).selectOption({ label });
  }
}

/** Creates a presentation and stays in its editor. */
export async function createPresentation(page: Page, name: string, date?: string) {
  await page.getByRole('link', { name: 'Presentationer' }).click();
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa presentation' });
  await dialog.getByLabel('Namn').fill(name);
  if (date) await dialog.getByLabel('Datum').fill(date);
  await dialog.getByLabel('Namn').press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Adds songs through the picker, each found by typing its name, and closes it. */
export async function addSongs(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  for (const name of names) {
    await picker.getByLabel('Sök på titel, författare eller textrad').fill(name);
    await picker.getByRole('button', { name: `Lägg till ${name}` }).click();
    await expect(page.getByRole('status').getByText(`"${name}" har lagts till`)).toBeVisible();
  }
  await picker.getByRole('button', { name: 'Stäng' }).click();
}
