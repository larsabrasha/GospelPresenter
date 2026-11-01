// The presentation on a phone (390×844): editing, as the current app's, with the running order in a drawer from the
// left and Lägg till's song preview over the add dialog; presenting, the 2.0 layout (docs/layout-2-0.md): the picture,
// ‹ Rensa ›, and the running order with every part's text.
import { expect, test, type Locator } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, dragTo, setUpHost } from './flows.ts';

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

test('on a phone the running order is a drawer and Lägg till previews a song over the dialog; presenting shows the picture, ‹ Rensa › and every part', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createSong(page, 'Sång C', [['Verse 1', 'C ett']]);
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

  // Presenting: one column, the picture with ‹ Rensa › under it, and every part of every item with its text.
  await page.mouse.click(370, 400);
  await expect(order).toBeHidden();
  await start.click();
  const live = page.getByTestId('phone-live');
  const picture = page.getByTestId('phone-live-picture');
  const liveOrder = page.getByTestId('live-order');
  await expect(live).toBeVisible();
  // The title sits in the very middle of the bar, however wide the buttons beside it.
  const title = (await live.getByRole('button', { name: 'Om presentationen' }).boundingBox())!;
  expect(Math.abs(title.x + title.width / 2 - PHONE.width / 2)).toBeLessThan(1);
  await onScreen(picture);
  await onScreen(page.getByRole('button', { name: 'Rensa' }));
  await expect(liveOrder.locator('section')).toHaveCount(2);
  await expect(liveOrder.getByRole('button', { name: /A två/ })).toBeVisible();

  // A tap on a part shows it: VISAS on it, NÄSTA on the next, the picture on the outputs.
  await liveOrder.getByRole('button', { name: /A ett/ }).click();
  await expect(picture).toContainText('A ett');
  await expect(liveOrder.getByRole('button', { name: /A ett/ })).toContainText('VISAS');
  await expect(liveOrder.getByRole('button', { name: /A två/ })).toContainText('NÄSTA');
  await page.getByRole('button', { name: 'Nästa bild' }).click();
  await expect(picture).toContainText('A två');

  // Rensa blacks the outputs and turns into Visa igen; the bar says RENSAD instead of LIVE.
  await page.getByRole('button', { name: 'Rensa' }).click();
  await expect(page.getByRole('button', { name: 'Visa igen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(live.getByRole('button', { name: 'Om presentationen' })).toContainText('RENSAD');
  await page.getByRole('button', { name: 'Visa igen' }).click();
  await expect(live.getByRole('button', { name: 'Om presentationen' })).toContainText('LIVE');

  // Lägg till while presenting adds right after the item shown, not at the end; nothing changes on the outputs.
  await live.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('button', { name: /Sång C/ }).click();
  await page.getByRole('dialog', { name: 'Sång C' }).getByRole('button', { name: 'Lägg till Sång C' }).click();
  await expect(page.getByRole('dialog', { name: 'Sång C' })).toBeHidden();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(liveOrder.locator('section')).toHaveCount(3);
  expect(await liveOrder.locator('section').evaluateAll((all) => all.map((x) => x.getAttribute('aria-label')))).toEqual(['Sång A', 'Sång C', 'Sång B']);
  await expect(picture).toContainText('A två');

  // Redigera folds the list to one row per item, moved by ≡; the shown item cannot be removed.
  await live.getByRole('button', { name: 'Redigera' }).click();
  const edit = page.getByTestId('live-edit');
  await expect(edit.getByRole('listitem')).toHaveText([/Sång A/, /Sång C/, /Sång B/]);
  await expect(edit.getByRole('button', { name: 'Ta bort Sång A' })).toBeDisabled();
  await dragTo(page, edit.getByTestId('drag-handle').nth(1), edit.getByRole('listitem').nth(2), 'below');
  await expect(edit.getByRole('listitem')).toHaveText([/Sång A/, /Sång B/, /Sång C/]);
  await live.getByRole('button', { name: 'Klar' }).click();
  expect(await liveOrder.locator('section').evaluateAll((all) => all.map((x) => x.getAttribute('aria-label')))).toEqual(['Sång A', 'Sång B', 'Sång C']);

  // Redigera sången in an item's … opens the song alone in Inställningar: no list, no way back, only Stäng.
  await liveOrder.getByRole('button', { name: 'Mer om Sång B' }).click();
  await page.getByRole('button', { name: 'Redigera sången' }).click();
  const settings = page.getByRole('dialog', { name: 'Inställningar' });
  await expect(settings.getByRole('heading', { name: 'Sång B', exact: true })).toBeVisible();
  await expect(settings.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: /Inställningar|Tillbaka/ })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Stäng', exact: true }).first().click();
  await expect(settings).toHaveCount(0);
  await expect(live).toBeVisible();

  // At desktop size the editor and the live column are back; on the phone again, the one column.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(live).toBeHidden();
  await expect(page.getByTestId('live-panel')).toBeVisible();
  await page.setViewportSize(PHONE);
  await expect(live).toBeVisible();

  // A sheet is pulled down by its bar to close it, as on iOS.
  await live.getByRole('button', { name: 'Mer', exact: true }).click();
  const more = page.getByRole('dialog', { name: 'Söndag' });
  const bar = (await more.getByRole('heading', { name: 'Söndag' }).boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 400, { steps: 8 });
  await page.mouse.up();
  await expect(more).toBeHidden();

  // Avsluta presentation is last in …, and asks first.
  await live.getByRole('button', { name: 'Mer', exact: true }).click();
  await page.getByRole('dialog', { name: 'Söndag' }).getByRole('button', { name: 'Avsluta presentation' }).click();
  await page.getByRole('dialog', { name: 'Avsluta presentation' }).getByRole('button', { name: 'Avsluta presentation' }).click();
  await expect(live).toBeHidden();
  await expect(menu).toBeVisible();
});
