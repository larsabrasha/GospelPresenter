// The left column while presenting on a computer (docs/layout-2-0.md): the shown item has a red dot, a mouse drags a
// whole row (a click still selects), and a right click or the row's … gives Lägg till efter, Flytta upp, Flytta ned
// and Ta bort, which the shown item does not allow; Delete removes the selected item after asking.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, dragTo, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('presenting on a computer, the running order marks the shown item, drags whole rows and has a menu per row', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  for (const name of ['Sång A', 'Sång B', 'Sång C']) await createSong(page, name, [['Verse 1', `${name} ett`]]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B', 'Sång C']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  const list = page.getByRole('list', { name: 'Programpunkter' });
  const rows = list.getByRole('listitem');
  await expect(rows.nth(0).getByTestId('live-dot')).toBeVisible();
  await expect(list.getByTestId('drag-handle').first()).toBeHidden(); // a mouse drags the row, not a handle

  // A click selects without dragging; dragging the row itself moves it.
  await list.getByRole('button', { name: 'Sång C', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Sång C', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveText([/Sång A/, /Sång B/, /Sång C/]);
  await dragTo(page, rows.nth(2).getByText('Sång C'), rows.nth(0), 'above');
  await expect(rows).toHaveText([/Sång C/, /Sång A/, /Sång B/]);

  // A right click on the shown item: it moves, but cannot be removed.
  await rows.nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Fler val för Sång A' });
  await expect(menu.getByRole('menuitem', { name: 'Visas nu, kan inte tas bort' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Flytta ned' }).click();
  await expect(rows).toHaveText([/Sång C/, /Sång B/, /Sång A/]);
  await expect(menu).toHaveCount(0);

  // The row's … opens the same menu; Escape closes only it.
  await list.getByRole('button', { name: 'Fler val för Sång C' }).click();
  await expect(page.getByRole('menu', { name: 'Fler val för Sång C' }).getByRole('menuitem', { name: 'Flytta upp' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('presentation-bar')).toBeVisible();

  // Delete removes the selected item after asking; the shown item it leaves.
  await list.getByRole('button', { name: 'Sång B', exact: true }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(rows).toHaveText([/Sång C/, /Sång A/]);
  await list.getByRole('button', { name: 'Sång A', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Radera' })).toHaveCount(0);

  // Lägg till efter puts the addition after the item named rather than after the shown one.
  await rows.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Lägg till efter' }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByLabel('Sök på titel, författare eller textrad').fill('Sång B');
  await picker.getByRole('button', { name: 'Lägg till Sång B' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(rows).toHaveText([/Sång C/, /Sång B/, /Sång A/]);
});

test('on an iPad lying down, the live layout has touch sizes and a finger drags an item by its ≡', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  for (const name of ['Sång A', 'Sång B']) await createSong(page, name, [['Verse 1', `${name} ett`]]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  // A finger rather than a mouse: `(pointer: coarse)` matches, as on an iPad.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  const list = page.getByRole('list', { name: 'Programpunkter' });
  const rows = list.getByRole('listitem');
  for (const target of [
    list.getByRole('button', { name: 'Sång A', exact: true }),
    list.getByRole('button', { name: 'Fler val för Sång A' }),
    list.getByTestId('drag-handle').first(),
    page.getByTestId('presentation-bar').getByRole('button', { name: 'Avsluta presentation' }),
    page.getByTestId('presentation-bar').getByRole('button', { name: 'Alternativ', exact: true }),
    page.getByRole('button', { name: 'Rensa' }),
  ]) {
    const box = (await target.boundingBox())!;
    expect(Math.min(box.width, box.height), String(target)).toBeGreaterThanOrEqual(44);
  }

  // Held a moment, ≡ moves the item, as the editor's handle does on a tablet.
  const handle = (await rows.nth(0).getByTestId('drag-handle').boundingBox())!;
  const below = (await rows.nth(1).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y0 = handle.y + handle.height / 2;
  const y1 = below.y + below.height - 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  await page.waitForTimeout(300); // a long press is time held
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rows).toHaveText([/Sång B/, /Sång A/]);
});
