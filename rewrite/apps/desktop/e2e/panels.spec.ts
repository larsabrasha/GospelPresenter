// A presentation's side columns folded away and out again, as iPadOS's and macOS's sidebars (ui/sidePanels.ts): away by
// the toggle in the column's foot, out by the one floating at the middle's foot while it is folded (ui/PanelToggle.tsx),
// the live column's while presenting, kept on the device.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, endPresentation, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('the running order and the live column fold away and out again, and stay as they were left after a reload', async () => {
  // Arrange
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const order = page.getByRole('list', { name: 'Programpunkter' });
  const live = page.getByTestId('live-panel');
  await expect(order).toBeVisible();
  await expect(live).toBeVisible();

  // Act: both folded away.
  await page.getByRole('button', { name: 'Göm sidofält' }).click();
  await page.getByRole('button', { name: 'Göm livekolumnen' }).click();

  // Assert: gone once they have slid off, the slides still there and the buttons now bring them out.
  await expect(order).toBeHidden();
  await expect(live).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sång A 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Göm sidofält' })).toHaveCount(0);
  if (process.env.GP_PANELS_PICTURE) await page.screenshot({ path: `${process.env.GP_PANELS_PICTURE}/folded.png` });

  // A reload keeps them folded; the left one comes out again.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Visa sidofält' })).toBeVisible();
  await expect(order).toBeHidden();
  await expect(live).toBeHidden();
  await page.getByRole('button', { name: 'Visa sidofält' }).click();
  await expect(order).toBeVisible();
  await expect(live).toBeHidden();
  await page.getByRole('button', { name: 'Visa livekolumnen' }).click();
  await expect(live).toBeVisible();
  if (process.env.GP_PANELS_PICTURE) await page.screenshot({ path: `${process.env.GP_PANELS_PICTURE}/out.png` });
});

test('a start brings the live column out even when it was folded, its toggle in its foot', async () => {
  // Arrange: presenting with the live column folded, then ended.
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Göm livekolumnen' }).click();
  await expect(page.getByTestId('live-panel')).toBeHidden();
  await endPresentation(page);
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible();

  // Act
  await page.getByRole('button', { name: 'Starta presentation' }).click();

  // Assert: out, with its toggle in its own foot, and no floating one.
  await expect(page.getByTestId('live-panel')).toBeVisible();
  await expect(page.getByTestId('live-panel').getByRole('button', { name: 'Göm livekolumnen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Visa livekolumnen' })).toHaveCount(0);
});
