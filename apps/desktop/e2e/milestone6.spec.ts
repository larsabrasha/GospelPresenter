// Milestone 6: the rest of live, in slices: a clicker's keys, the output window, and where a presentation is presented.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, endPresentation, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test("a clicker's keys drive the live page: next and previous across items, and B or . black the output", async () => {
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
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  // The live column slides in from the right (liveMotion.ts): an animation runs on it at once.
  await expect.poll(() => page.getByTestId('live-panel').evaluate((el) => el.getAnimations().length), { intervals: [0, 20, 40] }).toBeGreaterThan(0);
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  // → PageDown and Space step on, into the next item; ← PageUp step back (the stage view is gone, Lars 2026-11-01).
  await page.keyboard.press('PageDown');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');
  await page.keyboard.press(' ');
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await page.keyboard.press('PageUp');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');

  // B and . (a clicker's blank key) black the output, as Släck; PageDown goes on from the part last shown.
  await page.keyboard.press('B');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await page.keyboard.press('PageDown');
  await expect(output.getByTestId('slide-text')).toHaveText('B ett');
  await page.keyboard.press('.');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await page.keyboard.press('PageUp');
  await expect(output.getByTestId('slide-text')).toHaveText('A två');

  // The tests take no focus and no screen: the operator window and the output exist but were never shown.
  const windows = await host.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), fullScreen: w.isFullScreen() })));
  if (process.env.GP_E2E_VISIBLE !== '1') expect(windows).toEqual([{ visible: false, fullScreen: false }, { visible: false, fullScreen: false }]);
});

test('the output window is a switch: on opens the output, off closes it, closing the window turns it off, and Avsluta closes it', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const external = page.getByRole('checkbox', { name: 'Utgångsfönster' });
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
  await expect(page.getByRole('checkbox', { name: 'Utgångsfönster' })).toBeChecked();

  // Avsluta presentation closes it, as the current app does (Live.razor).
  await Promise.all([third.waitForEvent('close'), endPresentation(page)]);
  await expect.poll(windowCount).toBe(1);
});

test('a presentation is presented on its own page, as the current app: the address stays, and the list opens it presenting', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createPresentation(page, 'Lördag');
  await createPresentation(page, 'Söndag');
  const liveUrl = page.url();
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await expect(page.getByTestId('live-panel')).toBeVisible();
  await expect(page).toHaveURL(liveUrl);
  // In a presentation the bar has the way back to the presentations in place of the logo.
  await expect(page.getByRole('link', { name: 'Gospel Presenter' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Tillbaka till presentationerna' }).click();
  // Both the row, marked Live, and Visas just nu at the top open it.
  await expect(page.getByRole('link', { name: /^Söndag/ }).getByRole('img', { name: 'Live' })).toBeVisible();
  await page.getByRole('link', { name: 'Visas just nu: Söndag' }).click();
  await expect(page).toHaveURL(liveUrl);
  await expect(page.getByRole('button', { name: 'Avsluta' })).toBeVisible();

  await page.getByRole('link', { name: 'Tillbaka till presentationerna' }).click();
  await page.getByRole('link', { name: /Lördag/ }).click();
  await expect(page).toHaveURL(/\/presentations\//);
  await expect(page.getByTestId('live-panel')).toHaveCount(0);

  // Avsluta stays on the page, which is the editor again.
  await page.getByRole('link', { name: 'Tillbaka till presentationerna' }).click();
  await page.getByRole('link', { name: /^Söndag/ }).click();
  await endPresentation(page);
  await expect(page).toHaveURL(liveUrl);
  await expect(page.getByTestId('live-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible();
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
