// Milestone 1 (ADR 0007, decision 13): one song, one presentation, output on a
// second screen, and sync between two clients, working in Electron with no
// internet. Two desktop apps run on this machine: the host with the embedded
// server, and a second client that syncs through it.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, createUser, openAdmin, pair, setUpHost } from './flows.ts';

let host: Desktop;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  second = undefined;
});

/** The host set up, and a second desktop paired with it, which signs it in as Bo. */
async function hostAndSecond(port?: number): Promise<[Desktop, Desktop]> {
  const h = await launch({ port });
  host = h;
  await setUpHost(h);
  await createUser(h.page, 'Bo', 'bo@kyrkan.se');
  const s = await launch({ server: h.base });
  second = s;
  await pair(h.page, s.page, 'Andra datorn', 'Bo');
  await expect(s.page.getByTestId('me')).toHaveAccessibleName(/Bo/);
  await s.page.getByTestId('status').waitFor();
  return [h, s];
}

test('a song made on one client is presented on the other client\'s second screen, and edits reach it live', async () => {
  const [one, other] = await hostAndSecond();

  // The second client writes the song.
  await createSong(other.page, 'Härlig är jorden', [
    ['Verse 1', 'Härlig är jorden'],
    ['Chorus', 'Pilgrimsfärd'],
  ]);

  // It reaches the host through the embedded server.
  await openAdmin(one.page, 'Sånger');
  await expect(one.page.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible({ timeout: 5_000 });

  // The host builds a presentation. The picker stays open after an add (D15).
  await createPresentation(one.page, 'Söndag');
  await addSongs(one.page, ['Härlig är jorden']);
  await expect(one.page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Härlig är jorden/]);

  // Start, open the output, and show the chorus.
  await one.page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([one.app.waitForEvent('window'), one.page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await expect(output.getByTestId('slide-text')).toHaveCount(0); // nothing selected yet
  await one.page.getByRole('button', { name: 'Härlig är jorden 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Pilgrimsfärd');
  await expect(output.getByText('Chorus')).toHaveCount(0); // LIVE-R20: the part label is the operator's, never the output's
  await expect(one.page.getByRole('button', { name: 'Härlig är jorden 2' }).getByText('Chorus')).toBeVisible();

  // Arrow keys step through the slides.
  await one.page.keyboard.press('ArrowLeft');
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden');

  // An edit on the other client reaches the screen without the operator doing anything (D7).
  await other.page.getByLabel('Delar 1', { exact: true }).fill('Härlig är jorden, härlig är Guds himmel');
  await other.page.getByLabel('Delar 1', { exact: true }).blur();
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden, härlig är Guds himmel', { timeout: 5_000 });

  // Rensa blacks the screen, keeps the selection, and is gone while it is black. B only blanks too;
  // the slide shows again when it is picked.
  await one.page.getByRole('button', { name: 'Rensa' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(one.page.getByRole('button', { name: 'Rensa' })).toBeHidden();
  await expect(one.page.getByRole('button', { name: 'Härlig är jorden 1' })).toHaveAttribute('aria-pressed', 'true');
  await one.page.keyboard.press('b');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await one.page.getByRole('button', { name: 'Härlig är jorden 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden, härlig är Guds himmel');
  await expect(one.page.getByRole('button', { name: 'Rensa' })).toBeVisible();
  await one.page.keyboard.press('b');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await one.page.keyboard.press('b');
  await expect(output.getByTestId('slide-text')).toHaveCount(0);

  // Nothing tried to reach the internet.
  expect([...one.events, ...other.events].filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('the second client keeps working while the host is down, and its edits land when the host is back', async () => {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const [first, other] = await hostAndSecond(port);
  await createSong(other.page, 'Blott en dag', [['Verse 1', 'Blott en dag']]);
  await expect(other.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 5_000 });

  // The host goes away. The second client keeps editing, and says what is waiting.
  const hostData = first.dataDir;
  await first.app.close();
  await expect(other.page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await other.page.getByRole('button', { name: 'Lägg till del' }).click();
  const part = other.page.getByLabel('Delar 2', { exact: true });
  await part.fill('Ett ögonblick i sänder');
  await part.blur();
  await expect(other.page.getByTestId('status')).toContainText('ändringar väntar');

  // The host comes back on the same port with the same data; the second client reconnects and catches up.
  // Its pairing and its session survive the restart; the host's own window is still signed in.
  host = await launch({ port, dataDir: hostData });
  await host.page.getByTestId('status').waitFor();
  await expect(other.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  await host.page.getByRole('link', { name: 'Blott en dag' }).click();
  await expect(host.page.getByLabel('Delar 2', { exact: true })).toHaveValue('Ett ögonblick i sänder');
});
