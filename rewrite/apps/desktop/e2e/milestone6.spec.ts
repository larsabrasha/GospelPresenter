// Milestone 6: the rest of live, in slices. Stage view (spec 04 section 3).
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

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
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
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

  // The keys of a pedal or clicker (spec 04 §10): `b` blanks as Rensa does, and again does not show it back;
  // `.` and `B` blank too; Enter is next.
  await page.keyboard.press('b');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(stage.getByRole('button', { name: 'Rensa' })).toBeHidden();
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await page.keyboard.press('B');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await page.keyboard.press('.');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);

  // Esc closes an open sheet first, and only then the stage view.
  await stage.getByRole('button', { name: 'Sång A', exact: true }).click();
  await expect(stage.getByRole('dialog', { name: 'Välj programpunkt' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stage.getByRole('dialog', { name: 'Välj programpunkt' })).toHaveCount(0);
  await expect(stage).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stage).toHaveCount(0);
  await page.getByRole('button', { name: 'Scenläge' }).click();

  await stage.getByRole('button', { name: 'Lämna scenläge' }).click();
  await expect(stage).toHaveCount(0);

  // The tests take no focus and no screen: the operator window and the output exist but were never shown.
  const windows = await host.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), fullScreen: w.isFullScreen() })));
  if (process.env.GP_E2E_VISIBLE !== '1') expect(windows).toEqual([{ visible: false, fullScreen: false }, { visible: false, fullScreen: false }]);
});

test('Extern skärm is a switch: on opens the output, off closes it, and closing the window turns it off', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Söndag');
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const external = page.getByRole('checkbox', { name: 'Extern skärm' });
  const windowCount = () => host!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await expect(external).not.toBeChecked();

  // On opens the output window.
  const [output] = await Promise.all([host.app.waitForEvent('window'), external.check()]);
  await output.getByTestId('output').waitFor();
  await expect(external).toBeChecked();
  expect(await windowCount()).toBe(2);

  // Off closes it.
  await Promise.all([output.waitForEvent('close'), external.uncheck()]);
  await expect(external).not.toBeChecked();
  await expect.poll(windowCount).toBe(1);

  // Closed another way (its own close button, the OS): the switch follows.
  const [again] = await Promise.all([host.app.waitForEvent('window'), external.check()]);
  await again.getByTestId('output').waitFor();
  await expect(external).toBeChecked();
  await host.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => new URL(w.webContents.getURL()).pathname === '/output')?.close());
  await expect(external).not.toBeChecked();
  await expect.poll(windowCount).toBe(1);

  // A reloaded page adopts an output that is still open.
  const [third] = await Promise.all([host.app.waitForEvent('window'), external.check()]);
  await third.getByTestId('output').waitFor();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Extern skärm' })).toBeChecked();
});

test('addresses are plain paths: links navigate without a reload, a reload or a pasted link lands on the same page', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await expect(page).toHaveURL(`${host.base}/admin/images`);
  await expect(page.getByRole('heading', { name: 'Bilder', exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(`${host.base}/admin/images`);
  await expect(page.getByRole('heading', { name: 'Bilder', exact: true })).toBeVisible();

  await createPresentation(page, 'Söndag');
  const editor = page.url();
  expect(editor).toMatch(/\/presentations\/[\w-]+$/);
  await page.goto(editor);
  await expect(page.getByRole('heading', { name: 'Söndag', exact: true })).toBeVisible();
  await page.goBack(); // the History API keeps the steps between pages
  await expect(page).toHaveURL(`${host.base}/`); // the start page, the presentations

  // A path with a file extension is a file, so a missing one is a 404 and not the app; an API path stays the API.
  expect((await page.request.get(`${host.base}/assets/nope.js`)).status()).toBe(404);
  const api = await page.request.get(`${host.base}/api/users`);
  expect(api.headers()['content-type']).toContain('application/json');
  expect(page.url()).not.toContain('#');
});
