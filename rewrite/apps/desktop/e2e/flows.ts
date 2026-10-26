// Steps the e2e tests share, written as a user would do them.
import { expect, type Page } from '@playwright/test';

/** Creates a song with labelled parts and stays in its editor. */
export async function createSong(page: Page, name: string, parts: [string, string][]) {
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByPlaceholder('Sångens namn').fill(name);
  await page.getByRole('button', { name: 'Ny sång' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  for (const [i, [label, text]] of parts.entries()) {
    await page.getByRole('button', { name: 'Lägg till del' }).click();
    const part = page.getByLabel(`Delar ${i + 1}`, { exact: true });
    await part.fill(text);
    await part.blur();
    await page.getByRole('combobox', { name: 'Delar' }).nth(i).selectOption({ label });
  }
}
