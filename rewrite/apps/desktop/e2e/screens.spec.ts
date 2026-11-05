// Paired screens (spec 04 §5, §7, §8): a TV on the LAN opens /display at the
// host, with no sign-in and no pairing as a device, and shows the session.
// Played by Playwright's Chromium beside the desktop app.
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { type Desktop, launch, MUTED } from './apps.ts';
import { addSongs, createPresentation, createSong, endPresentation, openAdmin, pickItem, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

/** A host presenting "Sång A" on its live page. */
async function presenting(): Promise<Page> {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  return page;
}

async function tv(url: string): Promise<Page> {
  browser ??= await chromium.launch({ args: MUTED });
  const page = await browser.newPage({ locale: 'sv-SE' });
  await page.goto(url);
  return page;
}

async function typeCode(page: Page, code: string) {
  const dialog = page.getByRole('dialog', { name: 'Anslut tillfällig utgång' });
  for (const [i, d] of [...code].entries()) await dialog.getByLabel(`Siffra ${i + 1}`).fill(d);
}

test('a saved screen is online while its page is open, shows the slide when switched on, and goes off when the page closes (LIVE-A20, A21)', async () => {
  const page = await presenting();
  const origin = new URL(page.url()).origin;
  await openAdmin(page, 'Utgångar');
  await expect(page.getByText('Inga fasta utgångar')).toBeVisible();
  // An empty list shows its picture and heading only; the intro card at the top says what fixed outputs are.
  await expect(page.getByText(/^Projektorer, TV-apparater och datorer som kyrkan har satt upp/)).toBeVisible();
  await page.getByRole('button', { name: 'Lägg till utgång', exact: true }).click();
  await page.getByRole('dialog', { name: 'Lägg till utgång' }).getByLabel('Namn').fill('Kyrksal');
  await page.getByRole('dialog', { name: 'Lägg till utgång' }).getByRole('button', { name: 'Lägg till' }).click();
  const shown = page.getByRole('dialog', { name: 'Kyrksal' });
  const url = await shown.getByLabel('Länk').inputValue();
  expect(url).toMatch(new RegExp(`^${origin}/display\\?id=[a-z2-9]{7}&name=Kyrksal$`));
  await expect(shown.getByRole('img', { name: 'QR-kod' })).toHaveAttribute('data-value', url);
  await shown.getByRole('button', { name: 'Stäng' }).click();
  const row = page.getByRole('list', { name: 'Fasta utgångar' }).getByRole('listitem', { name: 'Kyrksal' });
  await expect(row).toContainText('Offline');
  await expect(page.getByText(/^En skärm är en extern enhet/)).toHaveCount(0);

  // The TV opens its link: its name, no code; the admin page shows it online.
  const screen = await tv(url);
  await expect(screen.getByTestId('display-idle')).toContainText('Kyrksal');
  await expect(screen.getByTestId('display-pin')).toHaveCount(0);
  await expect(row).toContainText('Online', { timeout: 5_000 });

  // Switched on under Utgångar, it shows what the host shows. Back past Fasta utgångar and the admin menu's first page, Sånger.
  await page.goBack();
  await page.goBack();
  const outputs = page.getByRole('list', { name: 'Utgångar' });
  await outputs.getByLabel('Kyrksal').check();
  await expect(screen.getByTestId('output').getByTestId('slide-text')).toHaveText('A ett', { timeout: 5_000 });
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(screen.getByTestId('slide-text')).toHaveText('A två', { timeout: 5_000 });
  // Black (B): the screen draws a black stage, as the output window, rather than its name.
  await page.keyboard.press('b');
  await expect(screen.getByTestId('slide-text')).toHaveCount(0, { timeout: 5_000 });
  await expect(screen.getByTestId('display-idle')).toHaveCount(0);

  // The TV's page closes: after the 15 s a Wi-Fi blink is given, the toggle goes off and cannot be switched on.
  await screen.close();
  await expect(outputs.getByLabel('Kyrksal')).not.toBeChecked({ timeout: 20_000 });
  await expect(outputs.getByLabel('Kyrksal')).toBeDisabled();
});

test('a saved screen whose session ended draws black, and its name again once its page is opened anew (Display.razor)', async () => {
  const page = await presenting();
  await openAdmin(page, 'Utgångar');
  await page.getByRole('button', { name: 'Lägg till utgång', exact: true }).click();
  await page.getByRole('dialog', { name: 'Lägg till utgång' }).getByLabel('Namn').fill('Kyrksal');
  await page.getByRole('dialog', { name: 'Lägg till utgång' }).getByRole('button', { name: 'Lägg till' }).click();
  const url = await page.getByRole('dialog', { name: 'Kyrksal' }).getByLabel('Länk').inputValue();
  await page.getByRole('dialog', { name: 'Kyrksal' }).getByRole('button', { name: 'Stäng' }).click();
  const screen = await tv(url);
  await expect(page.getByRole('list', { name: 'Fasta utgångar' }).getByRole('listitem', { name: 'Kyrksal' })).toContainText('Online', { timeout: 5_000 });
  await page.goBack();
  await page.goBack();
  await page.getByRole('list', { name: 'Utgångar' }).getByLabel('Kyrksal').check();
  await expect(screen.getByTestId('slide-text')).toHaveText('A ett', { timeout: 5_000 });

  await endPresentation(page);

  await expect(screen.getByTestId('display-black')).toBeVisible({ timeout: 5_000 });
  await expect(screen.getByTestId('display-idle')).toHaveCount(0);
  await screen.reload();
  await expect(screen.getByTestId('display-idle')).toContainText('Kyrksal');
});

test('a TV shows a code; typed in "Anslut tillfällig utgång" it shows the session; ✕ gives it a new code (LIVE-A17, A19)', async () => {
  const page = await presenting();
  const origin = new URL(page.url()).origin;
  const screen = await tv(`${origin}/display`);
  const pin = screen.getByTestId('display-pin');
  await expect(pin).toHaveText(/^\d{4}$/);
  const code = (await pin.textContent())!;
  await expect(screen.getByText('Ange denna kod i Gospel Presenter för att ansluta denna skärm')).toBeVisible();

  await page.getByRole('button', { name: 'Anslut tillfällig utgång' }).click();
  const dialog = page.getByRole('dialog', { name: 'Anslut tillfällig utgång' });
  await expect(dialog.getByLabel('Adress för skärmen')).toHaveText(`${origin}/display`);
  // A wrong code: the message, and empty boxes.
  await typeCode(page, code === '1000' ? '1001' : '1000');
  await expect(dialog.getByText('Ogiltig eller utgången kod')).toBeVisible();
  await expect(dialog.getByLabel('Siffra 1')).toHaveValue('');
  await typeCode(page, code);
  await expect(dialog.getByText('Skärmen är ansluten')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();

  await expect(screen.getByTestId('output').getByTestId('slide-text')).toHaveText('A ett', { timeout: 5_000 });
  const outputs = page.getByRole('list', { name: 'Utgångar' });
  await expect(outputs.getByText('Tillfällig utgång (1)')).toBeVisible();

  // ✕: the screen is let go and shows a new code.
  await outputs.getByRole('button', { name: 'Koppla bort tillfällig utgång (1)' }).click();
  await expect(pin).toHaveText(/^\d{4}$/, { timeout: 10_000 });
  await expect(outputs.getByText('Tillfällig utgång (1)')).toHaveCount(0);
});

test('a temporary screen opened with ?name= shows its name above the code (Display.razor)', async () => {
  host = await launch();
  await setUpHost(host);
  const origin = new URL(host.page.url()).origin;

  const screen = await tv(`${origin}/display?name=Foajé`);

  const pairing = screen.getByTestId('display-pairing');
  await expect(screen.getByTestId('display-pin')).toHaveText(/^\d{4}$/);
  await expect(pairing.getByText('Foajé')).toBeVisible();
  const nameBox = (await pairing.getByText('Foajé').boundingBox())!;
  const pinBox = (await screen.getByTestId('display-pin').boundingBox())!;
  expect(nameBox.y).toBeLessThan(pinBox.y);
});

test('a TV that opens the QR link pairs at once, and its address becomes /display (LIVE-A18)', async () => {
  const page = await presenting();
  await page.getByRole('button', { name: 'Anslut tillfällig utgång' }).click();
  const dialog = page.getByRole('dialog', { name: 'Anslut tillfällig utgång' });
  const qr = dialog.getByRole('img', { name: 'QR-kod för att ansluta en skärm' });
  await expect(qr).toHaveAttribute('data-value', /\/display\?token=[A-Za-z0-9_-]{43}$/);
  const link = (await qr.getAttribute('data-value'))!;

  const screen = await tv(link);
  await expect(screen.getByTestId('output').getByTestId('slide-text')).toHaveText('A ett', { timeout: 10_000 });
  expect(new URL(screen.url()).pathname + new URL(screen.url()).search).toBe('/display');
  await expect(dialog.getByText('Skärmen är ansluten')).toBeVisible({ timeout: 5_000 });

  // The same link again pairs nothing: a second TV gets a code.
  const second = await tv(link);
  await expect(second.getByTestId('display-pin')).toHaveText(/^\d{4}$/, { timeout: 10_000 });
});

test("a paired screen draws the projector's canvas, as the output window: the 1920×1080 stage with the theme, and a picture item's picture (spec 04 §5)", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([{ name: 'Logotyp.png', mimeType: 'image/png', buffer: solidPng(2400, 1350, [200, 30, 30]) }]);
  await expect(page.getByText('1 bild', { exact: true })).toBeVisible();
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click(); // + is a menu (spec 03 2f)
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: 'Logotyp.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Logotyp.png' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await pickItem(page, 'Sång A');
  await page.getByRole('button', { name: 'Sång A 1' }).click();

  await page.getByRole('button', { name: 'Anslut tillfällig utgång' }).click();
  const qr = page.getByRole('dialog', { name: 'Anslut tillfällig utgång' }).getByRole('img', { name: 'QR-kod för att ansluta en skärm' });
  const screen = await tv((await qr.getAttribute('data-value'))!);
  await expect(page.getByText('Skärmen är ansluten')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('dialog', { name: 'Anslut tillfällig utgång' }).getByRole('button', { name: 'Stäng' }).click();

  // The song on the stage, with the presentation's theme; not the public output's reflowing view.
  const stage = screen.getByTestId('output').getByTestId('slide-stage');
  await expect(stage.getByTestId('slide-text')).toHaveText('A ett', { timeout: 10_000 });
  await expect(stage).toHaveAttribute('data-theme', 'classic');
  await expect(stage).toHaveAttribute('data-kind', 'song');
  await expect(stage).toHaveCSS('width', '1920px');
  await expect(screen.getByTestId('watch-text')).toHaveCount(0);

  // The picture item: its picture, fetched through the screen's own path, at 1920 px.
  await pickItem(page, 'Logotyp.png');
  await page.getByRole('button', { name: 'Logotyp.png 1' }).click();
  const shown = screen.getByTestId('slide-image');
  await expect(stage).toHaveAttribute('data-kind', 'media', { timeout: 5_000 });
  await expect(shown).toHaveAttribute('src', /^\/api\/screen\/[A-Za-z0-9_-]{43}\/image\/[0-9a-f]{64}$/);
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1920, 1080]);
});
