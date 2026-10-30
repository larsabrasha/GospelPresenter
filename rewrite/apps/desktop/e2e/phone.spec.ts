// The presentation on a phone (390×844), as the current app's: the running order in a drawer
// from the left, the live panel as a floating box that folds, and Lägg till's song preview over the add dialog.
import { expect, test, type Locator } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, pickItem, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

const PHONE = { width: 390, height: 844 };

/** The box of an element, which must lie wholly within the phone's screen. */
async function onScreen(l: Locator) {
  const box = (await l.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  return box;
}

test('on a phone the running order is a drawer, Lägg till previews a song over the dialog, and the live panel floats and folds', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.setViewportSize(PHONE);
  await page.reload();

  // The drawer is open when the page opens; choosing an item closes it and shows the slides.
  const order = page.getByRole('list', { name: 'Programpunkter' });
  const menu = page.getByRole('button', { name: 'Meny' });
  await expect(order).toBeVisible();
  await order.getByRole('button', { name: 'Sång A', exact: true }).click();
  await expect(order).toBeHidden();
  await expect(page.getByRole('list', { name: 'Sång A' })).toBeVisible();

  // The round menu button at the bottom left and Starta presentation at the right are side by side, on screen.
  const start = page.getByRole('button', { name: 'Starta presentation' });
  const m = await onScreen(menu);
  const s = await onScreen(start);
  expect(m.x + m.width).toBeLessThan(s.x);
  expect(m.y + m.height).toBeGreaterThan(PHONE.height - 100);
  expect(s.y + s.height).toBeGreaterThan(PHONE.height - 100);

  // The menu button opens the drawer again; a tap on the dimmed page beside it closes it.
  await menu.click();
  await expect(order).toBeVisible();
  await page.mouse.click(370, 400);
  await expect(order).toBeHidden();

  // Lägg till: the songs' preview is not beside the list; a tapped song opens it over the dialog.
  await menu.click();
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('button', { name: /Sång B/ }).click();
  const preview = page.getByRole('dialog', { name: 'Sång B' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('list', { name: 'Sång B' }).getByRole('listitem')).toHaveCount(1);
  // It covers the add dialog, a sheet over the dimmed page, not the whole screen (SongTab.razor).
  const sheet = await onScreen(preview);
  expect(sheet).toEqual((await picker.boundingBox())!);
  expect(sheet.height).toBeLessThan(PHONE.height);
  // Escape (or ✕) closes the preview only; the add dialog stays.
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('button', { name: /Sång B/ }).click();
  await preview.getByRole('button', { name: 'Stäng' }).click();
  await expect(preview).toBeHidden();
  // Added from the preview: it closes, and the dialog stays for the next song.
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('button', { name: /Sång B/ }).click();
  await preview.getByRole('button', { name: 'Lägg till Sång B' }).click();
  await expect(page.getByRole('status').getByText('"Sång B" har lagts till')).toBeVisible();
  await expect(preview).toBeHidden();
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(order.getByRole('listitem')).toHaveText([/Sång A/, /Sång B/]);

  // Live: the panel floats at the bottom right, open; its caption folds it to a small picture and opens it again.
  await page.mouse.click(370, 400);
  await expect(order).toBeHidden();
  await start.click();
  // Presenting keeps the running order, in the drawer, closed when it starts; Sång B, added last, is selected.
  await expect(order).toBeHidden();
  await menu.click();
  await pickItem(page, 'Sång A');
  await expect(order).toBeHidden();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  const panel = page.getByTestId('live-panel');
  const fold = panel.getByRole('button', { name: 'Fäll in eller ut live-vyn' });
  const open = await onScreen(panel);
  expect(open.x + open.width).toBeGreaterThan(PHONE.width - 20);
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: 'Rensa' })).toBeVisible();
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  // Folded, the content is clipped away and inert.
  await expect(panel.getByRole('button', { name: 'Rensa' })).not.toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Avsluta' })).not.toBeInViewport();
  const content = page.locator(`[id="${await fold.getAttribute('aria-controls')}"]`);
  await expect(content).toHaveAttribute('inert');
  // The fold is a 300 ms transition: wait for it to end before measuring.
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(100);
  const folded = await onScreen(panel);
  expect(folded.y + folded.height).toBeGreaterThan(PHONE.height - 30);
  await fold.click();
  await expect(panel.getByRole('button', { name: 'Avsluta' })).toBeInViewport();

  // At desktop size the same panel is the column at the right, with nothing to fold, and the editor has no menu button.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(fold).toBeHidden();
  await page.setViewportSize(PHONE);
  await fold.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  // Folded on the phone, it is open at desktop size.
  await expect(panel.getByRole('button', { name: 'Rensa' })).toBeInViewport();
  await expect(content).not.toHaveAttribute('inert');
  await panel.getByRole('button', { name: 'Avsluta' }).click();
  await expect(order).toBeVisible();
  await expect(menu).toBeHidden();
});
