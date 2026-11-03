// Remote control (spec 04 §2, ADR 0004): a second computer drives what the
// host presents. The host's outputs follow its own state; commands travel
// through the server, and losing the presenter freezes the session.
import { chromium, expect, test } from '@playwright/test';
import { type Desktop, launch, MUTED } from './apps.ts';
import { addSongs, allowRemote, createPresentation, createSong, createUser, endPresentation, openAdmin, openPresentations, pair, pickItem, remoteSwitch, setUpHost } from './flows.ts';
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
  await expect(second.page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
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
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([hostApp.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  // Remote control is off: Bo's computer offers nothing to take.
  await openPresentations(secondApp.page);
  await expect(secondApp.page.getByRole('link', { name: 'Söndag' })).toBeVisible({ timeout: 5_000 });
  await expect(secondApp.page.getByText('Visas just nu')).toHaveCount(0);

  // Anna allows it; the card appears on Bo's computer without a reload.
  // Switched on, the QR code shows in its place under the switch, in the same sheet, which keeps its size.
  const info = page.getByRole('region', { name: 'Fjärrstyr presentationen' });
  await (await remoteSwitch(page)).scrollIntoViewIfNeeded();
  const qr = info.getByRole('img', { name: 'QR-kod för fjärrstyrning' });
  await expect(qr).toHaveCount(0);
  await (await remoteSwitch(page)).check();
  await expect(info.getByText('Skanna med kameran.')).toBeVisible();
  // The code is the link, which Kopiera länk puts on the clipboard.
  await expect(qr).toHaveAttribute('data-value', /\/presentations\/[\w-]+\?remote=true&session=[\w-]+$/);
  const sheet = page.getByRole('dialog', { name: 'Fjärrstyrning', exact: true });
  await sheet.getByRole('button', { name: 'Kopiera länk' }).click();
  await expect(sheet.getByRole('button', { name: 'Länk kopierad' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Fjärrstyrning', exact: true }).getByRole('button', { name: 'Stäng', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Fjärrstyrning', exact: true })).toHaveCount(0);
  const card = secondApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await expect(card).toContainText('Söndag', { timeout: 5_000 });
  await card.getByRole('link', { name: 'Ta kontroll' }).click();
  await expect(secondApp.page.getByText('Fjärrstyrningsläge – du styr en aktiv presentation')).toBeVisible();
  await expect(secondApp.page.getByText('Bara datorn som presenterar kan stoppa presentationen.')).toBeVisible();
  await expect(secondApp.page.getByRole('checkbox', { name: 'Utgångsfönster' })).toHaveCount(0);
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 1' })).toHaveAttribute('aria-pressed', 'true');

  // Bo picks the chorus: Anna's output and her tile follow.
  await secondApp.page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två', { timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true');
  // And the black screen.
  await secondApp.page.getByRole('button', { name: 'Rensa' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0, { timeout: 5_000 });
  await secondApp.page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A två', { timeout: 5_000 });

  // Anna switches it off: Bo's page says so, and his clicks go nowhere.
  await (await remoteSwitch(page)).uncheck();
  await expect(secondApp.page.getByTestId('remote-state')).toHaveText('Fjärrstyrning är inte aktiverad av presentatören', { timeout: 5_000 });

  // Anna ends the presentation: nothing left to control.
  await (await remoteSwitch(page)).check();
  await expect(secondApp.page.getByRole('button', { name: 'Sång A 1' })).toBeVisible({ timeout: 5_000 });
  await endPresentation(page);
  await expect(secondApp.page.getByTestId('remote-state')).toHaveText('Ingen aktiv presentation just nu', { timeout: 5_000 });
});

test('a controller with nothing to control can go back to the presentations', async () => {
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  await page.goto(new URL('/presentations/none?remote=true', page.url()).href);
  await expect(page.getByTestId('remote-state')).toHaveText('Ingen aktiv presentation just nu', { timeout: 5_000 });

  await page.getByRole('link', { name: 'Tillbaka till presentationerna' }).click();

  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
});

test('when the presenting computer drops out, the session freezes and someone else may end it (LIVE-R50)', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  await createSong(hostApp.page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(hostApp.page, 'Söndag');
  await addSongs(hostApp.page, ['Sång A']);

  // Bo's computer presents, with remote control on.
  await openPresentations(secondApp.page);
  await secondApp.page.getByRole('link', { name: 'Söndag' }).click({ timeout: 5_000 });
  await secondApp.page.getByRole('button', { name: 'Starta presentation' }).click();
  await allowRemote(secondApp.page);
  await pickItem(secondApp.page, 'Sång A');
  await secondApp.page.getByRole('button', { name: 'Sång A 1' }).click();

  await openPresentations(hostApp.page);
  const card = hostApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await card.getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 5_000 });
  await expect(hostApp.page.getByRole('button', { name: 'Sång A 1' })).toHaveAttribute('aria-pressed', 'true');
  // Bo switches remote control off before his computer drops out.
  await (await remoteSwitch(secondApp.page)).uncheck();
  await expect(hostApp.page.getByTestId('remote-state')).toHaveText('Fjärrstyrning är inte aktiverad av presentatören', { timeout: 5_000 });

  // Gone wins over "inte aktiverad" (Presentation.razor), with the hint above the button.
  await secondApp.app.close();
  second = undefined; // closed already
  await expect(hostApp.page.getByTestId('remote-state')).toContainText('Datorn som presenterar har tappat kontakten', { timeout: 5_000 });
  await expect(hostApp.page.getByText('Kommer datorn inte tillbaka kan du avsluta här.', { exact: false })).toBeVisible();
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
  const browser = await chromium.launch({ args: MUTED });
  try {
    const phone = await browser.newPage();
    const errors: string[] = [];
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`http://${lan}:${host.port}/`);
    expect(await phone.evaluate(() => isSecureContext)).toBe(false); // as on a real phone over the LAN
    await pair(host.page, phone, 'Telefonen');
    await expect(phone.getByTestId('status')).toContainText('Synkad', { timeout: 10_000 });

    // A picture imported on the host reaches the phone: fetched and checked without Web Crypto.
    await openAdmin(host.page, 'Bilder');
    await host.page.getByTestId('image-file').setInputFiles({ name: 'Kors.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 60, 200]) });
    await expect(host.page.getByText('1 bild', { exact: true })).toBeVisible();
    await openAdmin(phone, 'Bilder');
    const thumb = phone.getByTestId('image-card').getByRole('img', { name: 'Kors.png' });
    await expect(thumb).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await createSong(host.page, 'Sång A', [
      ['Verse 1', 'A ett'],
      ['Chorus', 'A två'],
    ]);
    await createPresentation(host.page, 'Söndag');
    await addSongs(host.page, ['Sång A']);
    await host.page.getByRole('button', { name: 'Starta presentation' }).click();
    await allowRemote(host.page);

    await openPresentations(phone);
    await phone.getByRole('list', { name: 'Visas just nu' }).getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 10_000 });
    await pickItem(phone, 'Sång A');
    await phone.getByRole('button', { name: 'Sång A 2' }).click();
    await expect(host.page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test('the organisation\'s remote control policy: "Alltid" needs no switch, "Aldrig" takes control away at once', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  const page = hostApp.page;
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);

  // Anna, an admin, lets everyone take control.
  await openAdmin(page, 'Organisationen');
  await expect(page.getByRole('heading', { name: 'Organisationens inställningar' })).toBeVisible();
  const policy = page.getByRole('combobox', { name: 'Fjärrstyrning av presentationer' });
  await expect(policy).toHaveValue('presenter');
  await policy.selectOption({ label: 'Alltid' });
  await expect(page.getByText('Alla i organisationen kan ta kontroll över en pågående presentation.')).toBeVisible();

  // She presents without switching anything on; Bo may take control.
  await openPresentations(page);
  await page.getByRole('link', { name: 'Söndag' }).click();
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await remoteSwitch(page);
  await expect(page.getByText('Alla i organisationen kan fjärrstyra presentationen.')).toBeVisible();
  await expect(page.getByLabel('Tillåt fjärrstyrning')).toHaveCount(0);
  // Always on, so the QR code shows in the sheet at once.
  await expect(page.getByRole('img', { name: 'QR-kod för fjärrstyrning' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Fjärrstyrning', exact: true }).getByRole('button', { name: 'Stäng', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Fjärrstyrning', exact: true })).toHaveCount(0); // it fades out first
  await openPresentations(secondApp.page);
  const card = secondApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await expect(card.getByRole('link', { name: 'Ta kontroll' })).toBeVisible({ timeout: 5_000 });

  // "Aldrig", set while she presents: the card goes on Bo's computer without a reload.
  await openAdmin(page, 'Organisationen');
  await page.getByRole('combobox', { name: 'Fjärrstyrning av presentationer' }).selectOption({ label: 'Aldrig' });
  await expect(secondApp.page.getByText('Visas just nu')).toHaveCount(0, { timeout: 5_000 });
});
