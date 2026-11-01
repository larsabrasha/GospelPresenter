// The presentation on a phone (390×844), one view before and while presenting (docs/layout-2-0.md): the running
// order with every part's text and Lägg till's song preview over the add dialog; presenting adds the picture and
// ‹ Rensa ›.
import { expect, test, type Locator } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, dragTo, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

const PHONE = { width: 390, height: 844 };

/** A sheet once it has slid in (`sheet-in`), so its box is where it stays. */
async function settled(sheet: Locator) {
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return sheet;
}

/** The box of an element, which must lie wholly within the phone's screen. */
async function onScreen(l: Locator) {
  const box = (await l.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  return box;
}

test('on a phone the presentation is one column before and while presenting; Lägg till previews a song over the dialog; presenting adds the picture and ‹ Rensa ›', async () => {
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

  // Before presenting: the running order with every part's text, ▶ in the bar, and no picture yet.
  const live = page.getByTestId('phone-live');
  const picture = page.getByTestId('phone-live-picture');
  const liveOrder = page.getByTestId('live-order');
  const start = live.getByRole('button', { name: 'Starta presentation' });
  await expect(liveOrder.getByText('A två')).toBeVisible();
  await expect(picture).toHaveCount(0);
  await onScreen(start);

  // Lägg till: the songs' preview is not beside the list; a tapped song opens it over the dialog.
  await live.getByRole('button', { name: 'Lägg till', exact: true }).click();
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
  await expect(liveOrder.locator('section')).toHaveCount(2);

  // Presenting: one column, the picture with ‹ Rensa › under it, and every part of every item with its text.
  await start.click();
  await expect(live).toBeVisible();
  // The title sits in the middle of the room between the back button and the buttons at the right, never under them.
  const title = (await live.getByRole('button', { name: 'Om presentationen' }).boundingBox())!;
  const back = (await live.getByRole('link', { name: 'Tillbaka till presentationerna' }).boundingBox())!;
  const right = (await live.getByRole('button', { name: 'Mer', exact: true }).boundingBox())!;
  expect(title.x).toBeGreaterThanOrEqual(back.x + back.width);
  expect(title.x + title.width).toBeLessThanOrEqual(right.x);
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

  // Rensa blacks the outputs and then rests until a part is shown again: nothing is marked as shown meanwhile, not
  // VISAS, nor the item's dot; NÄSTA still says what → shows. The bar still says LIVE, as the presentation runs until Avsluta.
  await page.getByRole('button', { name: 'Rensa' }).click();
  await expect(page.getByRole('button', { name: 'Rensa', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Visa igen' })).toHaveCount(0);
  await expect(live.getByRole('button', { name: 'Om presentationen' })).toContainText('LIVE');
  await expect(liveOrder).not.toContainText('VISAS');
  await expect(liveOrder.getByRole('button', { name: /B ett/ })).toContainText('NÄSTA');
  await expect(liveOrder.getByLabel('LIVE')).toHaveCount(0);
  // Only a grey border says where → goes on from.
  await expect(liveOrder.getByRole('button', { name: /A två/ })).toHaveAttribute('data-rested', 'true');
  await liveOrder.getByRole('button', { name: /A två/ }).click();
  await expect(liveOrder.getByRole('button', { name: /A två/ })).toContainText('VISAS');
  await expect(page.getByRole('button', { name: 'Rensa', exact: true })).toBeEnabled();

  // Lägg till while presenting adds right after the item shown, not at the end; nothing changes on the outputs.
  await live.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await picker.getByRole('list', { name: 'Sånger' }).getByRole('button', { name: /Sång C/ }).click();
  await page.getByRole('dialog', { name: 'Sång C' }).getByRole('button', { name: 'Lägg till Sång C' }).click();
  await expect(page.getByRole('dialog', { name: 'Sång C' })).toBeHidden();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(liveOrder.locator('section')).toHaveCount(3);
  expect(await liveOrder.locator('section').evaluateAll((all) => all.map((x) => x.getAttribute('aria-label')))).toEqual(['Sång A', 'Sång C', 'Sång B']);
  await expect(picture).toContainText('A två');

  // Flytta in an item's … folds the list to one row per item, moved by ≡; the shown item cannot be removed.
  await expect(live.getByRole('button', { name: 'Redigera', exact: true })).toHaveCount(0); // no Edit button, as iOS 27
  await liveOrder.getByRole('button', { name: 'Mer om Sång C' }).click();
  await page.getByRole('button', { name: 'Flytta', exact: true }).click();
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
  const more = await settled(page.getByRole('dialog', { name: 'Söndag' }));
  const bar = (await more.getByRole('heading', { name: 'Söndag' }).boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 400, { steps: 8 });
  await page.mouse.up();
  await expect(more).toBeHidden();

  // On an iPad held upright the same sheet is centred, as iPadOS's form sheet.
  await page.setViewportSize({ width: 820, height: 1180 });
  await live.getByRole('button', { name: 'Mer', exact: true }).click();
  const centred = (await (await settled(page.getByRole('dialog', { name: 'Söndag' }))).boundingBox())!;
  expect(Math.abs(centred.y + centred.height / 2 - 590)).toBeLessThan(10);
  await page.getByRole('dialog', { name: 'Söndag' }).getByRole('button', { name: 'Stäng' }).click();
  await page.setViewportSize(PHONE);

  // Utgångar is first in …; ending is ■ at the far right of the bar, and asks first.
  await live.getByRole('button', { name: 'Mer', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Söndag' }).getByRole('button').nth(1)).toHaveText('Utgångar');
  await page.getByRole('dialog', { name: 'Söndag' }).getByRole('button', { name: 'Stäng' }).click();
  await live.getByRole('button', { name: 'Avsluta presentation' }).click();
  await page.getByRole('dialog', { name: 'Avsluta presentation' }).getByRole('button', { name: 'Avsluta presentation' }).click();
  // The same view stays, without the picture, ▶ back in the bar.
  await expect(picture).toHaveCount(0);
  await expect(start).toBeVisible();
});
