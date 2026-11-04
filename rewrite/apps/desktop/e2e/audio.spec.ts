// Audio (spec 05 Media, spec 03): an audio file is imported as it is, kept on
// the device, and added to a presentation as an item with a player.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, allowRemote, createPresentation, createSong, createUser, openAdmin, openPresentations, pair, pickItem, setUpHost } from './flows.ts';
import { toneWav } from './wav.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

test('an audio file is imported, added to a presentation and plays in the editor; trashed, it goes to the trash', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Ljud');
  await expect(page.getByText('Inga ljudfiler än')).toBeVisible();
  await page.getByTestId('audio-file').setInputFiles([
    { name: 'Preludium.wav', mimeType: 'audio/wav', buffer: toneWav(2) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a sound') },
    { name: 'fake.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is text, not a sound') },
  ]);
  await expect(page.getByTestId('audio-failures')).toContainText('2 fil(er) kunde inte importeras');
  await expect(page.getByText('1 ljudfil', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ljud' }).getByRole('listitem')).toHaveText([/Preludium\.wav/]);
  // A tap looks at it, as Quick Look: it plays there, and Escape closes the look and nothing else.
  await page.getByRole('list', { name: 'Ljud' }).getByRole('button', { name: 'Preludium.wav', exact: true }).click();
  await expect(page.getByTestId('quick-look-audio')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-look')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Ljud' })).toBeVisible();
  // Ladda ner, in its ⋯ menu: the file as it is, under its name. Electron's own saving is not Playwright's
  // download event, so the link the page clicks is caught instead.
  await page.evaluate(() => {
    const w = window as unknown as { saved: string[] };
    w.saved = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.href.startsWith('blob:')) w.saved.push(this.download);
    };
  });
  await page.getByRole('button', { name: 'Fler val för Preludium.wav' }).click();
  await page.getByRole('menuitem', { name: 'Ladda ner' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { saved: string[] }).saved)).toEqual(['Preludium.wav']);

  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+4');
  await picker.getByRole('button', { name: 'Preludium.wav', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Preludium.wav' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Preludium.wav', exact: true }).click();
  const player = page.getByTestId('audio-preview');
  await expect(player).toBeVisible();
  // The file is this device's own copy, and it is a real, playable sound of two seconds, in the live page's player.
  await player.getByRole('button', { name: 'Spela' }).click();
  await expect(player.getByTestId('audio-duration')).toHaveText('0:02', { timeout: 5_000 });
  await player.getByRole('button', { name: 'Pausa' }).click();

  await openAdmin(page, 'Ljud');
  // Radera is in the row's menu, opened by a right click or a finger held on it.
  await page.getByRole('list', { name: 'Ljud' }).getByText('Preludium.wav').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Inga ljudfiler än')).toBeVisible();
  await page.getByRole('link', { name: 'Papperskorg' }).click();
  await expect(page.getByRole('list', { name: 'Papperskorg' }).getByRole('listitem')).toHaveText([/Preludium\.wav.*Ljudfil/]);
});

test('live: audio plays on the presenting computer, keeps playing while slides change, fades out, and a controller drives it (LIVE-A29, A31, A32)', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createUser(page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(page, second.page, 'Andra datorn', 'Bo');
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  await openAdmin(page, 'Ljud');
  await page.getByTestId('audio-file').setInputFiles({ name: 'Preludium.wav', mimeType: 'audio/wav', buffer: toneWav(20) });
  await expect(page.getByText('1 ljudfil', { exact: true })).toBeVisible();
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+4');
  await picker.getByRole('button', { name: 'Preludium.wav', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Preludium.wav' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await addSongs(page, ['Sång A']);

  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect(page.getByTestId('media-ready')).toHaveText('Alla bilder och ljud finns på den här enheten.');

  // A controller starts the sound first, before anyone played it on the presenting computer (LIVE-A32).
  await allowRemote(page);
  await openPresentations(second.page);
  await second.page.getByRole('list', { name: 'Visas just nu' }).getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 5_000 });
  const mirror = second.page.getByTestId('audio-player');
  const player = page.getByTestId('audio-player');
  // The controller fetches no audio: it never plays (docs/media-and-files.md, "Which files a device keeps").
  await expect(second.page.getByTestId('media-ready')).toHaveCount(0);
  // The player is the audio item's, there when it is selected, on either computer.
  await pickItem(second.page, 'Preludium.wav');
  await mirror.getByRole('button', { name: 'Spela' }).click();
  await pickItem(page, 'Preludium.wav');
  await expect(player).toHaveAttribute('data-playing', 'true', { timeout: 5_000 });
  await expect(mirror).toHaveAttribute('data-playing', 'true', { timeout: 5_000 });
  // It plays here, and what is shown stays (LIVE-R6).
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await expect.poll(async () => (await player.getByTestId('audio-time').textContent()) === '0:00', { timeout: 5_000 }).toBe(false);
  // What is shown changes; the sound plays on (LIVE-A31).
  await page.getByRole('button', { name: 'Rensa' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await pickItem(page, 'Sång A');
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  await pickItem(page, 'Preludium.wav');
  await expect(player).toHaveAttribute('data-playing', 'true');

  // The controller pauses it, and the presenting computer stops; then the operator plays it on here.
  await mirror.getByRole('button', { name: 'Pausa' }).click();
  await expect(player).toHaveAttribute('data-playing', 'false', { timeout: 5_000 });
  await expect(mirror).toHaveAttribute('data-playing', 'false', { timeout: 5_000 });
  await player.getByRole('button', { name: 'Spela' }).click();
  await expect(player).toHaveAttribute('data-playing', 'true');
  await expect(mirror).toHaveAttribute('data-playing', 'true', { timeout: 5_000 });

  // Tona ut: five seconds, then it stops and rewinds (LIVE-A31).
  await player.getByRole('button', { name: 'Tona ut' }).click();
  await expect(player).toHaveAttribute('data-playing', 'false', { timeout: 8_000 });
  await expect(player.getByTestId('audio-time')).toHaveText('0:00');
});
