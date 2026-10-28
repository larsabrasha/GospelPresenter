// Dragging by touch, as on a tablet: the running order's handle and an arrangement's chips
// (Sidebar.razor and SongArrangementEditor.razor, SortableJS with a 150 ms hold on touch).
// The mouse and the keyboard are tested in milestone2.spec.ts.
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** A finger on `from`'s middle, held `hold` ms, then moved in steps to just past `to`'s middle (below it) and lifted. */
async function touchDrag(cdp: CDPSession, page: Page, from: Locator, to: Locator, hold: number) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const x = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  const y1 = b.y + b.height - 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  await page.waitForTimeout(hold);
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('by touch, a held handle or chip drags; a quick swipe does not', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
    ['Verse 2', 'A tre'],
  ]);
  const cdp = await page.context().newCDPSession(page);

  // A chip: held, it moves below the next one; swiped at once, nothing moves.
  await page.getByRole('button', { name: 'Skapa arrangemang' }).click();
  const chips = page.getByRole('group', { name: 'Arrangemang 1' }).getByRole('list', { name: 'Delar i arrangemanget' }).getByRole('listitem');
  await expect(chips).toHaveText([/Verse 1/, /Chorus/, /Verse 2/]);
  await chips.nth(0).evaluate((e) => e.scrollIntoView({ block: 'center' })); // away from the edge that scrolls
  await touchDrag(cdp, page, chips.nth(0), chips.nth(1), 300);
  await expect(chips).toHaveText([/Chorus/, /Verse 1/, /Verse 2/]);
  await touchDrag(cdp, page, chips.nth(0), chips.nth(1), 0);
  await page.waitForTimeout(300);
  await expect(chips).toHaveText([/Chorus/, /Verse 1/, /Verse 2/]);

  // The running order's handle, held, moves the item.
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  const order = page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem');
  await expect(order).toHaveText([/Sång A/, /Sång B/]);
  await touchDrag(cdp, page, order.nth(0).getByTestId('drag-handle'), order.nth(1), 300);
  await expect(order).toHaveText([/Sång B/, /Sång A/]);
});
