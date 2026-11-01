// Keeping presentations offline (TODO.md "Video, and which files a device fetches"): a device keeps every
// file of a presentation it was told to, its videos whole too, whatever its date, and fetches what is
// added to it later without the presentation being opened. Its icon in the list says how far it has come; in
// a presentation, a quiet line at the foot of the left column, which opens Spara offline's dialog. "Spara kommande presentationer offline" under Mina inställningar does the same for
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

/** The offline icon of a presentation in the start page's list. */
const listIcon = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name }).getByTestId('keep-offline');

/** Adds to the open presentation, through Lägg till, a picture or a video already in the library. */
async function addFromLibrary(page: Page, key: string, name: string) {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.keyboard.press(key);
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name, exact: true }).click();
  await picker.getByRole('button', { name: `Lägg till ${name}` }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
}

test('a presentation kept offline by its icon has its pictures and its video whole on a computer when the host is gone', async () => {
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
  // The host's own window keeps nothing (its server has it all): it shows no offline icon.
  await expect(host.page.getByTestId('keep-offline')).toHaveCount(0);

  // On the second computer the list shows it not kept; the icon keeps it, and fills until all is there.
  await openPresentations(second.page);
  const icon = listIcon(second.page, 'Konsert');
  await expect(icon).toHaveAttribute('data-state', 'none', { timeout: 5_000 });
  await expect(icon).toHaveAccessibleName('Spara Konsert offline på den här enheten');
  await icon.click();
  await expect(icon).toHaveAttribute('data-state', 'kept', { timeout: 15_000 });
  await expect(icon).toHaveAccessibleName('Konsert är sparad offline på den här enheten. Klicka för att sluta spara den.');

  // The host adds a picture to it while the second computer is elsewhere in the app.
  await openAdmin(host.page, 'Bilder');
  await host.page.getByTestId('image-file').setInputFiles({ name: 'Affisch.png', mimeType: 'image/png', buffer: solidPng(1200, 800, [180, 40, 40]) });
  await expect(host.page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
  await openPresentations(host.page);
  await host.page.getByRole('link', { name: 'Konsert' }).click();
  await addFromLibrary(host.page, 'Control+3', 'Affisch.png');
  // The second computer fetches it without opening the presentation: time to sync and fetch, then all is there.
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/);
  await second.page.waitForTimeout(3000); // the icon says kept before the new picture arrives as after: time for it to arrive
  await expect(icon).toHaveAttribute('data-state', 'kept', { timeout: 15_000 });

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
  await pickItem(second.page, 'Affisch.png');
  const shown = second.page.getByRole('region', { name: 'Affisch.png' }).getByTestId('slide-image').first();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await pickItem(second.page, 'Dop.mp4');
  const preview = second.page.getByTestId('video-preview');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await preview.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);

  // Lagring på den här enheten lists it under Sparat offline, with its size: Mina inställningar, from the start page.
  await openPresentations(second.page);
  await second.page.getByTestId('me').click();
  await second.page.getByRole('menuitem', { name: 'Mina inställningar' }).click();
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

  // Back in the list the icon is a cloud again.
  await openPresentations(second.page);
  await expect(listIcon(second.page, 'Konsert')).toHaveAttribute('data-state', 'none');
});

test('"Spara kommande presentationer offline" keeps the coming seven days on a computer, shown by their icons, not later ones', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE');
  await createPresentation(host.page, 'Söndag', day(2));
  await createPresentation(host.page, 'Om en månad', day(30));
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  await second.page.getByTestId('me').click();
  await second.page.getByRole('menuitem', { name: 'Mina inställningar' }).click();
  const setting = second.page.getByRole('switch', { name: /Spara kommande presentationer offline/ });
  await expect(setting).not.toBeChecked();
  await expect(second.page.getByText('Presentationer de närmaste sju dagarna hämtas till den här enheten, även video.')).toBeVisible();
  await setting.check();
  await openPresentations(second.page);

  const soon = listIcon(second.page, 'Söndag');
  await expect(soon).toHaveAttribute('data-state', 'kept', { timeout: 10_000 });
  await expect(soon).toBeDisabled(); // undone under Mina inställningar, not here
  await expect(listIcon(second.page, 'Om en månad')).toHaveAttribute('data-state', 'none');
});
