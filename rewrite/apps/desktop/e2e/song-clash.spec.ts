// D18: two people editing the same part of a song. The one still typing when the other's text arrives is warned,
// and chooses which text stays.
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong, openAdmin, pair, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

/** Anna's host in the editor of "Sång A", and a second computer of hers in it too. */
async function bothInTheSong(): Promise<{ mine: Page; theirs: Page }> {
  host = await launch();
  await setUpHost(host);
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn');
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
  await createSong(host.page, 'Sång A', [['Verse 1', 'A ett']]);
  await openAdmin(second.page, 'Sånger');
  await second.page.getByRole('link', { name: 'Sång A' }).click({ timeout: 5_000 });
  await expect(second.page.getByLabel('Delar 1', { exact: true })).toHaveValue('A ett');
  return { mine: host.page, theirs: second.page };
}

test('a part changed elsewhere while I type in it warns me, and "Behåll min text" writes mine over theirs', async () => {
  const { mine, theirs } = await bothInTheSong();
  const myPart = mine.getByLabel('Delar 1', { exact: true });
  const theirPart = theirs.getByLabel('Delar 1', { exact: true });
  await myPart.click();
  await myPart.press('End');
  await mine.keyboard.type(' X');
  await expect(theirPart).toHaveValue('A ett X', { timeout: 5_000 });

  await theirPart.fill('B två');
  await theirPart.blur();

  const warning = mine.getByRole('alert').filter({ hasText: 'Någon annan ändrade den här texten medan du skrev.' });
  await expect(warning).toBeVisible({ timeout: 5_000 });
  await expect(warning.getByTestId('clash-theirs')).toHaveText('B två');
  await expect(myPart).toHaveValue('A ett X');
  await warning.getByRole('button', { name: 'Behåll min text' }).click();
  await expect(warning).toHaveCount(0);
  await expect(theirPart).toHaveValue('A ett X', { timeout: 5_000 });
});

test('"Använd deras" takes the other text and writes nothing of mine', async () => {
  const { mine, theirs } = await bothInTheSong();
  const myPart = mine.getByLabel('Delar 1', { exact: true });
  const theirPart = theirs.getByLabel('Delar 1', { exact: true });
  await myPart.click();
  await myPart.press('End');
  await mine.keyboard.type(' X');
  await expect(theirPart).toHaveValue('A ett X', { timeout: 5_000 });
  await theirPart.fill('B två');
  await theirPart.blur();
  const warning = mine.getByRole('alert').filter({ hasText: 'Någon annan ändrade den här texten medan du skrev.' });
  await expect(warning).toBeVisible({ timeout: 5_000 });

  await warning.getByRole('button', { name: 'Använd deras' }).click();

  await expect(warning).toHaveCount(0);
  await expect(myPart).toHaveValue('B två');
  await mine.waitForTimeout(1_000); // what a stray save of mine would need to reach the other computer
  await expect(theirPart).toHaveValue('B två');
});
