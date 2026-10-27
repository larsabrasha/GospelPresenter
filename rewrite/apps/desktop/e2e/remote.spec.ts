// Remote control (spec 04 §2, ADR 0004): a second computer drives what the
// host presents. The host's outputs follow its own state; commands travel
// through the server, and losing the presenter freezes the session.
import { chromium, expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, createUser, pair, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

async function hostWithSecond(): Promise<{ owner: Desktop; other: Desktop }> {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  await expect(second.page.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 5_000 });
  return { owner: host, other: second };
}

test('a second computer takes control of what the host presents (LIVE-A22, A23, A27, A37)', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  const page = hostApp.page;
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([hostApp.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  // Remote control is off: Bo's computer offers nothing to take.
  await secondApp.page.getByRole('link', { name: 'Presentationer' }).click();
  await expect(secondApp.page.getByRole('link', { name: 'Söndag' })).toBeVisible({ timeout: 5_000 });
  await expect(secondApp.page.getByText('Visas just nu')).toHaveCount(0);

  // Anna allows it; the card appears on Bo's computer without a reload.
  await page.getByLabel('Tillåt fjärrstyrning').check();
  await expect(page.getByLabel('Länk för fjärrstyrning')).toHaveValue(/\/live\/[\w-]+\?remote=1&session=[\w-]+$/);
  await expect(page.getByRole('img', { name: 'QR-kod för fjärrstyrning' })).toHaveAttribute('data-value', await page.getByLabel('Länk för fjärrstyrning').inputValue());
  const card = secondApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await expect(card).toContainText('Visas just nu · Söndag', { timeout: 5_000 });
  await card.getByRole('link', { name: 'Ta kontroll' }).click();
  await expect(secondApp.page.getByText('Fjärrstyrningsläge – du styr en aktiv presentation')).toBeVisible();
  await expect(secondApp.page.getByText('Bara datorn som presenterar kan stoppa presentationen.')).toBeVisible();
  await expect(secondApp.page.getByRole('button', { name: 'Extern skärm' })).toHaveCount(0);
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 1' })).toHaveAttribute('aria-pressed', 'true');

  // Bo picks the chorus: Anna's output and her tile follow.
  await secondApp.page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två', { timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true');
  // And the black screen.
  await secondApp.page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0, { timeout: 5_000 });
  await secondApp.page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två', { timeout: 5_000 });

  // Anna switches it off: Bo's page says so, and his clicks go nowhere.
  await page.getByLabel('Tillåt fjärrstyrning').uncheck();
  await expect(secondApp.page.getByTestId('remote-state')).toHaveText('Fjärrstyrning är inte aktiverad av presentatören', { timeout: 5_000 });

  // Anna ends the presentation: nothing left to control.
  await page.getByLabel('Tillåt fjärrstyrning').check();
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 1' })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Avsluta' }).click();
  await expect(secondApp.page.getByTestId('remote-state')).toHaveText('Ingen aktiv presentation just nu', { timeout: 5_000 });
});

test('when the presenting computer drops out, the session freezes and someone else may end it (LIVE-R50)', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  await createSong(hostApp.page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(hostApp.page, 'Söndag');
  await addSongs(hostApp.page, ['Sång A']);

  // Bo's computer presents, with remote control on.
  await secondApp.page.getByRole('link', { name: 'Presentationer' }).click();
  await secondApp.page.getByRole('link', { name: 'Söndag' }).click({ timeout: 5_000 });
  await secondApp.page.getByRole('link', { name: 'Starta presentation' }).click();
  await secondApp.page.getByLabel('Tillåt fjärrstyrning').check();
  await secondApp.page.getByRole('button', { name: 'Sång A 1' }).click();

  await hostApp.page.getByRole('link', { name: 'Presentationer' }).click();
  const card = hostApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await card.getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 5_000 });
  await expect(hostApp.page.getByRole('button', { name: 'Sång A 1' })).toHaveAttribute('aria-pressed', 'true');

  await secondApp.app.close();
  second = undefined; // closed already
  await expect(hostApp.page.getByTestId('remote-state')).toContainText('Datorn som presenterar har tappat kontakten', { timeout: 5_000 });
  await hostApp.page.getByRole('button', { name: 'Avsluta presentationen' }).click();
  await expect(hostApp.page.getByTestId('remote-state')).toHaveText('Ingen aktiv presentation just nu', { timeout: 5_000 });
});

test('a phone on the LAN, over plain http (no secure context), pairs and takes control', async () => {
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  test.skip(!lan, 'this machine has no LAN address');
  host = await launch({ lan: true });
  await setUpHost(host);
  const browser = await chromium.launch();
  try {
    const phone = await browser.newPage();
    const errors: string[] = [];
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`http://${lan}:${host.port}/`);
    expect(await phone.evaluate(() => isSecureContext)).toBe(false); // as on a real phone over the LAN
    await pair(host.page, phone, 'Telefonen');
    await expect(phone.getByTestId('status')).toContainText('Ansluten', { timeout: 10_000 });

    // A picture imported on the host reaches the phone: fetched and checked without Web Crypto.
    await host.page.getByRole('link', { name: 'Bilder' }).click();
    await host.page.getByTestId('image-file').setInputFiles({ name: 'Kors.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 60, 200]) });
    await expect(host.page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
    await phone.getByRole('link', { name: 'Bilder' }).click();
    const thumb = phone.getByTestId('image-card').getByRole('img', { name: 'Kors.png' });
    await expect(thumb).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await createSong(host.page, 'Sång A', [
      ['Verse 1', 'A ett'],
      ['Chorus', 'A två'],
    ]);
    await createPresentation(host.page, 'Söndag');
    await addSongs(host.page, ['Sång A']);
    await host.page.getByRole('link', { name: 'Starta presentation' }).click();
    await host.page.getByLabel('Tillåt fjärrstyrning').check();

    await phone.getByRole('link', { name: 'Presentationer' }).click();
    await phone.getByRole('list', { name: 'Visas just nu' }).getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 10_000 });
    await phone.getByRole('button', { name: 'Sång A 2' }).click();
    await expect(host.page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
