// "Tillgänglig offline" (README, "Which files a device keeps"): a device
// keeps every file of a presentation it was told to, whatever its date, and
// fetches what is added to it later without the presentation being opened.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, createUser, openAdmin, openPresentations, pair, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

test('a presentation kept offline on a computer has its pictures there, fetched ahead, when the host is gone', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  await expect(second.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 5_000 });

  // A presentation with no date: nothing would fetch its files ahead.
  await createPresentation(host.page, 'Konsert');
  await openPresentations(second.page);
  await second.page.getByRole('link', { name: 'Konsert' }).click({ timeout: 5_000 });
  await second.page.getByLabel('Tillgänglig offline på den här enheten').check();
  await openPresentations(second.page);
  await expect(second.page.getByRole('listitem').filter({ hasText: 'Konsert' })).toContainText('Offline');

  // The host adds a picture to it while the second computer is elsewhere in the app.
  await openAdmin(host.page, 'Bilder');
  await host.page.getByTestId('image-file').setInputFiles({ name: 'Affisch.png', mimeType: 'image/png', buffer: solidPng(1200, 800, [180, 40, 40]) });
  await expect(host.page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
  await openPresentations(host.page);
  await host.page.getByRole('link', { name: 'Konsert' }).click();
  await host.page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await host.page.keyboard.press('Control+3');
  const picker = host.page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: /Affisch\.png/ }).click();
  await picker.getByRole('button', { name: 'Lägg till Affisch.png' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  // Give the second computer time to sync and fetch, without opening the presentation.
  await expect(second.page.getByTestId('status')).toHaveText(/^Ansluten$/);
  await second.page.waitForTimeout(3000);

  // The host goes away; the presentation opens with its picture, from this computer alone.
  await host.app.close();
  host = undefined;
  await expect(second.page.getByTestId('status')).toContainText('Offline', { timeout: 10_000 });
  await second.page.getByRole('link', { name: 'Konsert' }).click();
  await expect(second.page.getByTestId('media-ready')).toHaveText('Alla bilder och ljud finns på den här enheten.');
  await second.page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Affisch.png', exact: true }).click();
  const shown = second.page.getByTestId('slide-image').first();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
