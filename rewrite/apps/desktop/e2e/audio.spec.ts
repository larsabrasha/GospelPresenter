// Audio (spec 05 Media, spec 03): an audio file is imported as it is, kept on
// the device, and added to a presentation as an item with a player.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, setUpHost } from './flows.ts';
import { toneWav } from './wav.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('an audio file is imported, added to a presentation and plays in the editor; trashed, it goes to the trash', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await page.getByRole('link', { name: 'Ljud' }).click();
  await expect(page.getByText('Inga ljudfiler än')).toBeVisible();
  await page.getByTestId('audio-file').setInputFiles([
    { name: 'Preludium.wav', mimeType: 'audio/wav', buffer: toneWav(2) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a sound') },
    { name: 'fake.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is text, not a sound') },
  ]);
  await expect(page.getByTestId('audio-failures')).toContainText('2 fil(er) kunde inte importeras');
  await expect(page.getByRole('heading', { name: 'Alla ljudfiler (1)' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ljud' }).getByRole('listitem')).toHaveText([/Preludium\.wav/]);

  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+4');
  await picker.getByRole('button', { name: 'Lägg till Preludium.wav' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Preludium.wav', exact: true }).click();
  const player = page.getByTestId('audio-preview');
  await expect(player).toBeVisible();
  // The file is this device's own copy, and it is a real, playable sound of two seconds.
  await expect.poll(() => player.evaluate((a: HTMLAudioElement) => (Number.isFinite(a.duration) ? Math.round(a.duration) : 0)), { timeout: 5_000 }).toBe(2);

  await page.getByRole('link', { name: 'Ljud' }).click();
  await page.getByRole('button', { name: 'Ta bort Preludium.wav' }).click();
  await expect(page.getByText('Inga ljudfiler än')).toBeVisible();
  await page.getByRole('link', { name: 'Papperskorg' }).click();
  await expect(page.getByRole('list', { name: 'Papperskorg' }).getByRole('listitem')).toHaveText([/Preludium\.wav.*Ljudfil/]);
});
