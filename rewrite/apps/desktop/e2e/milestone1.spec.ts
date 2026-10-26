// Milestone 1 (ADR 0007, decision 13): one song, one presentation, output on a
// second screen, and sync between two clients, working in Electron with no
// internet. Two desktop apps run on this machine: the host with the embedded
// server, and a second client that syncs through it.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createSong } from './flows.ts';

let host: Desktop;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  second = undefined;
});

test('a song made on one client is presented on the other client\'s second screen, and edits reach it live', async () => {
  host = await launch();
  second = await launch({ server: host.base });

  // The second client writes the song.
  await createSong(second.page, 'Härlig är jorden', [
    ['Verse 1', 'Härlig är jorden'],
    ['Chorus', 'Pilgrimsfärd'],
  ]);

  // It reaches the host through the embedded server.
  await host.page.getByRole('link', { name: 'Sånger' }).click();
  await expect(host.page.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible({ timeout: 5_000 });

  // The host builds a presentation. The picker stays open after an add (D15).
  await host.page.getByRole('link', { name: 'Presentationer' }).click();
  await host.page.getByPlaceholder('Presentationens namn').fill('Söndag');
  await host.page.getByRole('button', { name: 'Ny presentation' }).click();
  await host.page.getByRole('button', { name: 'Lägg till sång' }).click();
  const picker = host.page.getByRole('dialog', { name: 'Lägg till sång' });
  await picker.getByRole('button', { name: 'Lägg till' }).click();
  await expect(picker.getByText('Tillagd')).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(host.page.getByRole('listitem').filter({ hasText: 'Härlig är jorden' })).toBeVisible();

  // Start, open the output, and show the chorus.
  await host.page.getByRole('link', { name: 'Starta' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), host.page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await expect(output.getByTestId('slide-text')).toHaveCount(0); // nothing selected yet
  await host.page.getByRole('button', { name: 'Härlig är jorden 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Pilgrimsfärd');
  await expect(output.getByText('Chorus')).toBeVisible();

  // Arrow keys step through the slides.
  await host.page.keyboard.press('ArrowLeft');
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden');

  // An edit on the other client reaches the screen without the operator doing anything (D7).
  await second.page.getByLabel('Delar 1', { exact: true }).fill('Härlig är jorden, härlig är Guds himmel');
  await second.page.getByLabel('Delar 1', { exact: true }).blur();
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden, härlig är Guds himmel', { timeout: 5_000 });

  // The black screen hides the slide and keeps the selection.
  await host.page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden, härlig är Guds himmel');

  // Nothing tried to reach the internet.
  expect([...host.events, ...second.events].filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('the second client keeps working while the host is down, and its edits land when the host is back', async () => {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  host = await launch({ port });
  second = await launch({ server: host.base });
  await createSong(second.page, 'Blott en dag', [['Verse 1', 'Blott en dag']]);
  await expect(second.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 5_000 });

  // The host goes away. The second client keeps editing, and says what is waiting.
  const hostData = host.dataDir;
  await host.app.close();
  await expect(second.page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await second.page.getByRole('button', { name: 'Lägg till del' }).click();
  const part = second.page.getByLabel('Delar 2', { exact: true });
  await part.fill('Ett ögonblick i sänder');
  await part.blur();
  await expect(second.page.getByTestId('status')).toContainText('ändringar väntar');

  // The host comes back on the same port with the same data; the second client reconnects and catches up.
  host = await launch({ port, dataDir: hostData });
  await expect(second.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  await host.page.getByRole('link', { name: 'Blott en dag' }).click();
  await expect(host.page.getByLabel('Delar 2', { exact: true })).toHaveValue('Ett ögonblick i sänder');
});
