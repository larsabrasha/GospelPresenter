// Whole journeys through the app, as a church uses it (docs/scenarios.md): each feature has its own spec, and
// these check that the steps work together, in the order a Sunday takes them. No detail is checked twice here.
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { sampleDblZip } from '../../../packages/core/test/bible-fixtures.ts';
import { launch, testPort, type Desktop } from './apps.ts';
import { addSongs, closeAdmin, createPresentation, createSong, createUser, openAdmin, openPresentations, pair, pickItem, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await second?.app.close();
  await host?.app.close();
  host = second = browser = undefined;
});

/** A TV or a phone: a browser page of its own, in Swedish. */
async function viewer(url: string): Promise<Page> {
  browser ??= await chromium.launch();
  const page = await browser.newPage({ locale: 'sv-SE' });
  await page.goto(url);
  return page;
}

/** Makes a saved screen or a public output under Skärmar and returns its link. */
async function newOutput(page: Page, kind: 'screen' | 'public', name: string): Promise<string> {
  const title = kind === 'screen' ? 'Lägg till skärm' : 'Skapa publik utgång';
  await page.getByRole('button', kind === 'screen' ? { name: 'Lägg till', exact: true } : { name: title }).click();
  await page.getByRole('dialog', { name: title }).getByLabel('Namn').fill(name);
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: kind === 'screen' ? 'Lägg till' : 'Skapa' }).click();
  const shown = page.getByRole('dialog', { name });
  const url = await shown.getByLabel('Länk').inputValue();
  await shown.getByRole('button', { name: 'Stäng' }).click();
  return url;
}

/** Adds a reading by reference and a picture from the library to the open presentation. */
async function addReadingAndPicture(page: Page, reference: string, picture: string) {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+2');
  const search = picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)');
  await search.fill(reference);
  await search.press('Control+Enter');
  await expect(page.getByRole('status').getByText('har lagts till')).toBeVisible();
  await page.keyboard.press('Control+3');
  await picker.getByRole('button', { name: picture, exact: true }).click();
  await picker.getByRole('button', { name: `Lägg till ${picture}` }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
}

test('a Sunday: a song, a reading and a picture are presented on the projector, a TV and the phones at once, and the song is in the CCLI report', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  // Prepare the library: a Bible, a picture, a song with its CCLI number, and collection on.
  await openAdmin(page, 'Biblar');
  await page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(page.getByTestId('bible-import-message')).toContainText('Importerade');
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles({ name: 'Välkommen.png', mimeType: 'image/png', buffer: solidPng(1200, 800, [180, 40, 40]) });
  await expect(page.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
  await openAdmin(page, 'CCLI-rapport');
  await page.getByRole('checkbox', { name: 'Aktivera CCLI-datainsamling' }).check();
  await createSong(page, 'Amazing Grace', [
    ['Verse 1', 'Amazing grace'],
    ['Verse 2', 'Twas grace'],
  ]);
  await page.getByLabel('CCLI', { exact: true }).fill('22025');
  await page.getByLabel('CCLI', { exact: true }).blur();
  await expect(page.getByText('Sparad')).toBeVisible();

  // The church's outputs: a TV in the hall, and a public output for the phones.
  await openAdmin(page, 'Skärmar');
  const tvUrl = await newOutput(page, 'screen', 'Kyrksal');
  const watchUrl = await newOutput(page, 'public', 'Mobilerna');
  await closeAdmin(page);

  // The running order.
  await createPresentation(page, 'Gudstjänst');
  await addSongs(page, ['Amazing Grace']);
  await addReadingAndPicture(page, 'Joh 3:16', 'Välkommen.png');
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Amazing Grace/, /Johannes 3:16/, /Välkommen\.png/]);

  // The service: the TV and a phone are on before it starts; the projector opens with it.
  const tv = await viewer(tvUrl);
  await expect(tv.getByTestId('display-idle')).toContainText('Kyrksal');
  const phone = await viewer(watchUrl);
  await expect(phone.getByTestId('watch-waiting')).toBeVisible();
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [projector] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await projector.getByTestId('output').waitFor();
  const outputs = page.getByRole('list', { name: 'Utgångar' });
  await outputs.getByLabel('Kyrksal').check();
  await outputs.getByLabel('Mobilerna').check();

  /** What each of the three shows: the projector, the TV and the phone. */
  const showsText = async (text: string) => {
    await expect(projector.getByTestId('slide-text')).toContainText(text);
    await expect(tv.getByTestId('slide-text')).toContainText(text, { timeout: 5_000 });
    await expect(phone.getByTestId('watch-text')).toContainText(text, { timeout: 5_000 });
  };

  // The page's clock jumps the 10 s that count the song for CCLI (CCLI_SHOWN_MS) instead of waiting them.
  await page.clock.install();
  await pickItem(page, 'Amazing Grace');
  await page.getByRole('button', { name: 'Amazing Grace 1' }).click();
  await showsText('Amazing grace');
  await page.clock.fastForward(10_500);
  await page.keyboard.press('ArrowRight');
  await showsText('Twas grace');
  await page.keyboard.press('ArrowRight');
  await showsText('For God so loved the world');
  await page.keyboard.press('ArrowRight');
  await expect(projector.getByTestId('slide-image')).toBeVisible();
  await expect(tv.getByTestId('slide-image')).toBeVisible({ timeout: 5_000 });
  await expect(phone.getByTestId('watch-image')).toBeVisible({ timeout: 5_000 });

  // Black, then Avsluta: the projector closes, the TV draws black, the phone waits again.
  await page.keyboard.press('b');
  await expect(phone.getByTestId('watch-waiting')).toBeVisible({ timeout: 5_000 });
  await Promise.all([projector.waitForEvent('close'), page.getByRole('button', { name: 'Avsluta presentation' }).click()]);
  await expect(tv.getByTestId('display-black')).toBeVisible({ timeout: 5_000 });
  await expect(phone.getByTestId('watch-waiting')).toBeVisible();

  // Afterwards: the song is in the CCLI report under the service.
  await openAdmin(page, 'CCLI-rapport');
  const card = page.getByRole('region', { name: /^Gudstjänst \d{4}-\d{2}-\d{2}$/ });
  await expect(card).toContainText('Amazing Grace');
  await expect(card).toContainText('22025');
  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('prepared on a laptop while the church computer is off, and presented on the church computer when it is back', async () => {
  const port = testPort();
  host = await launch({ port });
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Bos dator', 'Bo');
  const laptop = second.page;
  await expect(laptop.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  // The church computer is off for the week.
  const hostData = host.dataDir;
  await host.app.close();
  host = undefined;
  await expect(laptop.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });

  // At home, Bo writes a song, imports a picture and puts both in Sunday's presentation.
  await createSong(laptop, 'Psalm 1', [['Verse 1', 'Härlig är jorden']]);
  await openAdmin(laptop, 'Bilder');
  await laptop.getByTestId('image-file').setInputFiles({ name: 'Kors.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 60, 200]) });
  await expect(laptop.getByRole('heading', { name: 'Alla bilder (1)' })).toBeVisible();
  await closeAdmin(laptop);
  await createPresentation(laptop, 'Söndag');
  await addSongs(laptop, ['Psalm 1']);
  await laptop.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await laptop.keyboard.press('Control+3');
  const picker = laptop.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: 'Kors.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Kors.png' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(laptop.getByTestId('status')).toContainText('ändringar väntar');

  // Sunday: the church computer starts on the same port, and the laptop's week arrives.
  host = await launch({ port, dataDir: hostData });
  const page = host.page;
  await expect(laptop.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await openPresentations(page);
  await page.getByRole('link', { name: 'Söndag' }).click({ timeout: 10_000 });
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Psalm 1/, /Kors\.png/]);

  // Presented on the projector: the song, then the picture, whose bytes came from the laptop.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [projector] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await projector.getByTestId('output').waitFor();
  await pickItem(page, 'Psalm 1');
  await page.getByRole('button', { name: 'Psalm 1 1' }).click();
  await expect(projector.getByTestId('slide-text')).toHaveText('Härlig är jorden');
  await page.keyboard.press('ArrowRight');
  const shown = projector.getByTestId('slide-image').first();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(laptop.getByText('En ändring kunde inte synkas.')).toHaveCount(0);
});
