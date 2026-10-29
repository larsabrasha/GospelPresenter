// The presentation editor as the current app has it (Sidebar.razor, SlideGrid.razor): a quote when
// nothing is selected, the last selected item again on return, and Markera to remove several items.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, openPresentations, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a quote with nothing selected, the item selected again on return, and Markera removes a range', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  for (const name of ['Sång A', 'Sång B', 'Sång C']) await createSong(page, name, [['Verse 1', `${name} ett`]]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B', 'Sång C']);
  const order = page.getByRole('list', { name: 'Programpunkter' });

  // The add dialog selected what it added; opened again, the page selects it again.
  await order.getByRole('button', { name: 'Sång B', exact: true }).click();
  await openPresentations(page);
  await page.getByRole('link', { name: /Söndag/ }).click();
  await expect(order.getByRole('button', { name: 'Sång B', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Markera: tick A, Shift+click C ticks the range, and the three go together after the question.
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Markera' }).click();
  await expect(page.getByText('Välj objekt att radera')).toBeVisible();
  await order.getByRole('button', { name: 'Sång A' }).click();
  await order.getByRole('button', { name: 'Sång C' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Ta bort markerade (3)' }).click();
  const confirm = page.getByRole('dialog', { name: 'Radera' });
  await expect(confirm).toContainText('Vill du ta bort 3 objekt?');
  await confirm.getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByRole('status').getByText('3 objekt borttagna')).toBeVisible();
  await expect(order.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lägg till', exact: true })).toBeVisible();

  // With items and none selected, a quote or a verse stands in the main area.
  await addSongs(page, ['Sång A']);
  await page.reload();
  await expect(page.getByTestId('idle-hint')).not.toBeEmpty();
});

test('several pictures make one image item; Redigera removes one and adds more', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([
    { name: 'Röd.png', mimeType: 'image/png', buffer: solidPng(320, 180, [200, 30, 30]) },
    { name: 'Blå.png', mimeType: 'image/png', buffer: solidPng(320, 180, [30, 30, 200]) },
    { name: 'Grön.png', mimeType: 'image/png', buffer: solidPng(320, 180, [30, 200, 30]) },
  ]);
  await expect(page.getByRole('heading', { name: 'Alla bilder (3)' })).toBeVisible();
  await createPresentation(page, 'Söndag');

  // Two picked in the Bilder tab go in as one item, "2 bilder", a slide each.
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+3');
  await picker.getByRole('button', { name: 'Röd.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Blå.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till 2 bilder' }).click();
  await expect(page.getByRole('status').getByText('2 bilder har lagts till')).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  const order = page.getByRole('list', { name: 'Programpunkter' });
  await expect(order.getByRole('listitem')).toHaveText([/2 bilder/]);
  await expect(page.getByRole('list', { name: '2 bilder' }).getByRole('listitem')).toHaveCount(2);

  // Redigera: the ✕ on the first asks, then removes it; the dashed tile adds Grön last.
  await page.getByRole('button', { name: 'Redigera', exact: true }).click();
  await page.getByRole('button', { name: 'Ta bort bild 1' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByTestId('image-order').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Lägg till bilder' }).click();
  await picker.getByRole('button', { name: 'Grön.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Grön.png' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByTestId('image-order').getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Klar', exact: true }).click();
  await expect(order.getByRole('listitem')).toHaveCount(1);
});
