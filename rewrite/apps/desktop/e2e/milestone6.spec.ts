// Milestone 6: the rest of live, in slices. Stage view (spec 04 section 3).
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('stage view: the picker opens by itself, next stays within the item, and the output follows', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();

  await page.getByRole('button', { name: 'Scenläge' }).click();
  const stage = page.getByTestId('stage-view');
  // Nothing selected and a running order: the item picker is open. Picking puts the first part live.
  await stage.getByRole('dialog', { name: 'Välj programpunkt' }).getByRole('button', { name: 'Sång A' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(stage.getByText('LIVE')).toHaveCount(1);
  await expect(stage.getByRole('button', { name: 'Nästa' })).toBeVisible();

  // Next goes to part 2; on the last part it does nothing and does not enter the next item (LIVE-R41).
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await expect(stage.getByRole('button', { name: 'Nästa' })).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  // The preview has no credits, and the part label shows on the stage only.
  await expect(stage.getByTestId('slide-credits')).toHaveCount(0);
  await expect(stage.getByText('Chorus').first()).toBeVisible();

  // Rensa blacks the output and hides itself; picking a part brings it back.
  await stage.getByRole('button', { name: 'Rensa' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(stage.getByRole('button', { name: 'Rensa' })).toBeHidden();
  await stage.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  await stage.getByRole('button', { name: 'Lämna scenläge' }).click();
  await expect(stage).toHaveCount(0);
});
