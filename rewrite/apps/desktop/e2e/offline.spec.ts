// Keeping presentations offline (TODO.md "Video, and which files a device fetches"): a device keeps every
// file of a presentation it was told to, its videos whole too, whatever its date, and fetches what is
// added to it later without the presentation being opened. In a presentation a quiet line at the foot of the left
// column says how far it has come, and opens Spara offline's dialog with the switch. "Spara kommande presentationer offline" under Mina inställningar does the same for
// the coming seven days.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, createUser, openAdmin, openPresentations, pair, pickItem, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

const video = () => readFileSync(new URL('../../../packages/core/test/fixtures/h264.mp4', import.meta.url));

/** Opens a presentation from the start page and gives its offline line. */
async function offlineLine(page: Page, name: string) {
  await openPresentations(page);
  await page.getByRole('link', { name }).click();
  return page.getByTestId('offline-status');
}

/** Adds to the open presentation, through Lägg till, a picture or a video already in the library. */
async function addFromLibrary(page: Page, key: string, name: string) {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.keyboard.press(key);
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name, exact: true }).click();
  await picker.getByRole('button', { name: `Lägg till ${name}` }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
}

test('a presentation kept offline by its line has its pictures and its video whole on a computer when the host is gone', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  // A presentation with no date, with a video: nothing fetches it unless it is kept offline.
  await createPresentation(host.page, 'Konsert');
  await host.page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await host.page.keyboard.press('Control+6');
  const picker = host.page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByTestId('video-tab-file').setInputFiles({ name: 'Dop.mp4', mimeType: 'video/mp4', buffer: video() });
  await picker.getByRole('button', { name: 'Dop.mp4', exact: true }).click({ timeout: 15_000 });
  await picker.getByRole('button', { name: 'Lägg till Dop.mp4' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  // The host's own window keeps nothing (its server has it all): it shows no offline line.
  await expect(host.page.getByTestId('offline-status')).toHaveCount(0);

  // On the second computer the line says it is not kept; its dialog keeps it, and the line fills until all is there.
  const line = await offlineLine(second.page, 'Konsert');
  await expect(line).toHaveText('Inte sparad offline', { timeout: 5_000 });
  await line.click();
  await second.page.getByRole('dialog', { name: 'Spara offline' }).getByRole('checkbox', { name: 'Spara på den här enheten' }).check();
  await second.page.getByRole('dialog', { name: 'Spara offline' }).getByRole('button', { name: 'Stäng' }).first().click();
  await expect(line).toHaveAttribute('data-state', 'kept', { timeout: 15_000 });
  await expect(line).toHaveText('Sparad offline');
  await openPresentations(second.page);

  // The host adds a picture to it while the second computer is elsewhere in the app.
  await openAdmin(host.page, 'Bilder');
  await host.page.getByTestId('image-file').setInputFiles({ name: 'Affisch.png', mimeType: 'image/png', buffer: solidPng(1200, 800, [180, 40, 40]) });
  await expect(host.page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
  await openPresentations(host.page);
  await host.page.getByRole('link', { name: 'Konsert' }).click();
  await addFromLibrary(host.page, 'Control+3', 'Affisch.png');
  // The second computer fetches it without opening the presentation: time to sync and fetch, then all is there.
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/);
  await second.page.waitForTimeout(3000); // nothing on the start page says when the new picture has arrived: time for it to arrive

  // The host goes away; the presentation opens with its full picture and plays its video, from this computer alone.
  await host.app.close();
  host = undefined;
  await expect(second.page.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await second.page.getByRole('link', { name: 'Konsert' }).click();
  await expect(second.page.getByTestId('offline-status')).toHaveText('Sparad offline');
  await second.page.getByTestId('offline-status').click();
  const dialog = second.page.getByRole('dialog', { name: 'Spara offline' });
  await expect(dialog.getByRole('checkbox', { name: 'Spara på den här enheten' })).toBeChecked();
  await expect(dialog).toContainText('Allt finns på den här enheten.');
  await dialog.getByRole('button', { name: 'Stäng' }).first().click();
  // On a phone the same line is at the foot of the list. The title opens the computer's menu, with no Spara offline.
  await second.page.setViewportSize({ width: 390, height: 844 });
  const phone = second.page.getByTestId('phone-live');
  await expect(second.page.getByTestId('phone-live').getByTestId('offline-status')).toHaveText('Sparad offline');
  await phone.getByRole('button', { name: 'Alternativ' }).click();
  await expect(phone.getByRole('menuitem')).toHaveText(['Redigera detaljer…', 'Noter och länkar', 'Radera presentation']);
  await second.page.keyboard.press('Escape');
  await second.page.setViewportSize({ width: 1280, height: 800 });
  await pickItem(second.page, 'Affisch.png');
  const shown = second.page.getByRole('region', { name: 'Affisch.png' }).getByTestId('slide-image').first();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await pickItem(second.page, 'Dop.mp4');
  const preview = second.page.getByTestId('video-preview');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await preview.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);

  // Lagring på den här enheten lists it under Sparat offline, with its size: Mina inställningar in Inställningar, from the start page.
  await openPresentations(second.page);
  await openAdmin(second.page, 'Mina inställningar');
  const storage = second.page.getByTestId('storage');
  await expect(storage.getByRole('list', { name: 'Sparat offline' }).getByRole('listitem')).toHaveText([/Konsert.*(kB|MB)/]);
  await expect(storage.getByTestId('storage-cache')).toHaveText('0 B');

  // Kept no more ("Sluta spara"): its files are cache now, and Rensa cache drops them; the thumbnails stay.
  await storage.getByRole('button', { name: 'Sluta spara' }).click();
  await expect(storage.getByText('Ingen presentation är sparad offline på den här enheten.')).toBeVisible();
  await expect(storage.getByTestId('storage-cache')).not.toHaveText('0 B');
  await storage.getByRole('button', { name: 'Rensa cache' }).click();
  await expect(storage.getByTestId('storage-cache')).toHaveText('0 B');
  await expect(storage.getByTestId('storage-total')).not.toContainText(' 0 B');
  await expect(storage.getByTestId('storage-limit').locator('option:checked')).toHaveText('2 GB (standard)');

  // In the presentation the line says it is not kept again.
  await expect(await offlineLine(second.page, 'Konsert')).toHaveAttribute('data-state', 'none');
});

test('"Spara kommande presentationer offline" keeps the coming seven days on a computer, shown by their lines, not later ones', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE');
  await createPresentation(host.page, 'Söndag', day(2));
  await createPresentation(host.page, 'Om en månad', day(30));
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  await openAdmin(second.page, 'Mina inställningar');
  const setting = second.page.getByRole('switch', { name: /Spara kommande presentationer offline/ });
  await expect(setting).not.toBeChecked();
  await expect(second.page.getByText('Presentationer de närmaste sju dagarna hämtas till den här enheten, även video.')).toBeVisible();
  await setting.check();

  const soon = await offlineLine(second.page, 'Söndag');
  await expect(soon).toHaveAttribute('data-state', 'kept', { timeout: 10_000 });
  await soon.click();
  // Undone under Mina inställningar, not here.
  await expect(second.page.getByRole('dialog', { name: 'Spara offline' }).getByRole('checkbox', { name: 'Spara på den här enheten' })).toBeDisabled();
  await second.page.getByRole('dialog', { name: 'Spara offline' }).getByRole('button', { name: 'Stäng' }).first().click();
  await expect(await offlineLine(second.page, 'Om en månad')).toHaveAttribute('data-state', 'none');
});
