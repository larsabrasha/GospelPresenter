// Remote control (spec 04 §2, ADR 0004): a second computer drives what the
// host presents. The host's outputs follow its own state; commands travel
// through the server, and losing the presenter freezes the session.
import { chromium, expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, allowRemote, createPresentation, createSong, createUser, openAdmin, openPresentations, pair, remoteSwitch, setUpHost } from './flows.ts';
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
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([hostApp.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');

  // Remote control is off: Bo's computer offers nothing to take.
  await openPresentations(secondApp.page);
  await expect(secondApp.page.getByRole('link', { name: 'Söndag' })).toBeVisible({ timeout: 5_000 });
  await expect(secondApp.page.getByText('Visas just nu')).toHaveCount(0);

  // Anna allows it; the card appears on Bo's computer without a reload.
  // The QR code button waits for the switch; switching on the first time opens its dialog (LivePanel.razor).
  const showInfo = page.getByRole('button', { name: 'Visa info om fjärrstyrning' });
  await (await remoteSwitch(page)).scrollIntoViewIfNeeded();
  await expect(showInfo).toBeDisabled();
  await (await remoteSwitch(page)).check();
  const info = page.getByRole('dialog', { name: 'Fjärrstyr presentationen' });
  await expect(info.getByText('Skanna med kameran på enheten du vill fjärrstyra från.')).toBeVisible();
  // The link to copy is folded away under the QR code, and is the code's link.
  await info.getByRole('button', { name: 'Kopiera länken' }).click();
  const remoteLink = info.getByLabel('Länk för fjärrstyrning');
  await expect(remoteLink).toBeVisible();
  await expect(remoteLink).toHaveValue(/\/live\/[\w-]+\?remote=1&session=[\w-]+$/);
  await expect(info.getByRole('img', { name: 'QR-kod för fjärrstyrning' })).toHaveAttribute('data-value', await remoteLink.inputValue());
  await info.getByRole('button', { name: 'Stäng' }).click();
  await expect(info).toHaveCount(0);
  // Not inline in the panel any more; the button opens it again.
  await expect(page.getByRole('img', { name: 'QR-kod för fjärrstyrning' })).toHaveCount(0);
  await showInfo.click();
  await expect(info.getByRole('img', { name: 'QR-kod för fjärrstyrning' })).toBeVisible();
  await info.getByRole('button', { name: 'Stäng' }).click();
  const card = secondApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await expect(card).toContainText('Söndag', { timeout: 5_000 });
  await card.getByRole('link', { name: 'Ta kontroll' }).click();
  await expect(secondApp.page.getByText('Fjärrstyrningsläge – du styr en aktiv presentation')).toBeVisible();
  await expect(secondApp.page.getByText('Bara datorn som presenterar kan stoppa presentationen.')).toBeVisible();
  await expect(secondApp.page.getByRole('checkbox', { name: 'Extern skärm' })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Avsluta' }).click();
  await expect(secondApp.page.getByTestId('remote-state')).toHaveText('Ingen aktiv presentation just nu', { timeout: 5_000 });
});

test('a remote link with ?stage=true opens straight in the stage view, and the address follows the stage view (Presentation.razor)', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  const page = hostApp.page;
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await (await remoteSwitch(page)).check();
  const info = page.getByRole('dialog', { name: 'Fjärrstyr presentationen' });
  await info.getByRole('button', { name: 'Kopiera länken' }).click();
  const link = new URL(await info.getByLabel('Länk för fjärrstyrning').inputValue());
  await info.getByRole('button', { name: 'Stäng' }).click();
  const remote = secondApp.page;
  await openPresentations(remote);
  await expect(remote.getByRole('link', { name: 'Söndag' })).toBeVisible({ timeout: 5_000 });

  await remote.goto(new URL(`${link.pathname}${link.search}&stage=true`, remote.url()).href);

  const stage = remote.getByTestId('stage-view');
  await expect(stage).toBeVisible({ timeout: 5_000 });
  await expect(remote.getByText('Fjärrstyrningsläge – du styr en aktiv presentation')).toBeAttached();
  await stage.getByRole('button', { name: 'Lämna scenläge' }).click();
  await expect(stage).toHaveCount(0);
  expect(new URL(remote.url()).searchParams.get('stage')).toBeNull();
  await remote.getByRole('button', { name: 'Scenläge' }).click();
  await expect(stage).toBeVisible();
  expect(new URL(remote.url()).searchParams.get('stage')).toBe('true');
});

test('when the presenting computer drops out, the session freezes and someone else may end it (LIVE-R50)', async () => {
  const { owner: hostApp, other: secondApp } = await hostWithSecond();
  await createSong(hostApp.page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(hostApp.page, 'Söndag');
  await addSongs(hostApp.page, ['Sång A']);

  // Bo's computer presents, with remote control on.
  await openPresentations(secondApp.page);
  await secondApp.page.getByRole('link', { name: 'Söndag' }).click({ timeout: 5_000 });
  await secondApp.page.getByRole('link', { name: 'Starta presentation' }).click();
  await allowRemote(secondApp.page);
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
  await expect(hostApp.page.getByText('Om datorn inte kommer tillbaka kan du avsluta presentationen härifrån.', { exact: false })).toBeVisible();
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
    await expect(phone.getByTestId('status')).toContainText('Synkad', { timeout: 10_000 });

    // A picture imported on the host reaches the phone: fetched and checked without Web Crypto.
    await openAdmin(host.page, 'Bilder');
    await host.page.getByTestId('image-file').setInputFiles({ name: 'Kors.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 60, 200]) });
    await expect(host.page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
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
    await host.page.getByRole('link', { name: 'Starta presentation' }).click();
    await allowRemote(host.page);

    await openPresentations(phone);
    await phone.getByRole('list', { name: 'Visas just nu' }).getByRole('link', { name: 'Ta kontroll' }).click({ timeout: 10_000 });
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
  await openAdmin(page, 'Församlingen');
  await expect(page.getByRole('heading', { name: 'Församlingens inställningar' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Presentatören väljer/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /^Alltid/ }).click();
  await expect(page.getByRole('radio', { name: /^Alltid/ })).toHaveAttribute('aria-checked', 'true');

  // She presents without switching anything on; Bo may take control.
  await openPresentations(page);
  await page.getByRole('link', { name: 'Söndag' }).click();
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Fjärrstyrning', exact: true }).click();
  await expect(page.getByText('Alla i församlingen kan fjärrstyra presentationen.')).toBeVisible();
  await expect(page.getByLabel('Tillåt fjärrstyrning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Visa info om fjärrstyrning' })).toBeEnabled();
  await openPresentations(secondApp.page);
  const card = secondApp.page.getByRole('list', { name: 'Visas just nu' }).getByRole('listitem');
  await expect(card.getByRole('link', { name: 'Ta kontroll' })).toBeVisible({ timeout: 5_000 });

  // "Aldrig", set while she presents: the card goes on Bo's computer without a reload.
  await openAdmin(page, 'Församlingen');
  await page.getByRole('radio', { name: /^Aldrig/ }).click();
  await expect(secondApp.page.getByText('Visas just nu')).toHaveCount(0, { timeout: 5_000 });
});
