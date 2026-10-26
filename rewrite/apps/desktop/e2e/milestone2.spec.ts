// Milestone 2: songs and presentations as spec 02 and 03 describe them, and
// the output window when the operator's database has no shared file.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('without OPFS the output still shows the slide, read through the operator window', async () => {
  host = await launch({ memory: true });
  const page = host.page;
  await expect(page.getByTestId('status')).toContainText('Data sparas bara i minnet');
  await createSong(page, 'Blott en dag', [
    ['Verse 1', 'Blott en dag'],
    ['Chorus', 'Ett ögonblick i sänder'],
  ]);
  await page.getByRole('link', { name: 'Presentationer' }).click();
  await page.getByPlaceholder('Presentationens namn').fill('Kväll');
  await page.getByRole('button', { name: 'Ny presentation' }).click();
  await page.getByRole('button', { name: 'Lägg till sång' }).click();
  await page.getByRole('dialog', { name: 'Lägg till sång' }).getByRole('button', { name: 'Lägg till' }).click();
  await page.getByRole('button', { name: 'Stäng' }).click();
  await page.getByRole('link', { name: 'Starta' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Blott en dag 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Ett ögonblick i sänder');

  // An edit in the operator's in-memory database reaches the output too (D7).
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByRole('link', { name: 'Blott en dag' }).click();
  await page.getByLabel('Delar 2', { exact: true }).fill('Varje dag och varje stund');
  await page.getByLabel('Delar 2', { exact: true }).blur();
  await expect(output.getByTestId('slide-text')).toHaveText('Varje dag och varje stund');
});
