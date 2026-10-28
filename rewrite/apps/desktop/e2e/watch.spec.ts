// Public output (spec 04 §6, §7): an admin makes one; anyone opens its link
// in a browser, with no sign-in, and follows what the host presents.
import { chromium, expect, test, type Browser } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let browser: Browser | undefined;
test.afterEach(async () => {
  await browser?.close();
  await host?.app.close();
  host = undefined;
  browser = undefined;
});

test('a public output follows the presentation in a browser without signing in; a new code cuts it off', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  // Skärmar: make a public output and take its link.
  await openAdmin(page, 'Skärmar');
  await expect(page.getByText('Inga publika utgångar')).toBeVisible();
  await page.getByRole('button', { name: 'Skapa publik utgång' }).click();
  await page.getByRole('dialog', { name: 'Skapa publik utgång' }).getByLabel('Namn').fill('Kyrkkaffet');
  await page.getByRole('dialog', { name: 'Skapa publik utgång' }).getByRole('button', { name: 'Skapa' }).click();
  // The new output's QR code and link open at once (spec 04 §7).
  const shown = page.getByRole('dialog', { name: 'Kyrkkaffet' });
  await expect(shown.getByRole('img', { name: 'QR-kod' })).toHaveAttribute('data-value', /\/watch\/[a-z2-9]{7}$/);
  await expect(shown.getByRole('button', { name: 'Ladda ner som bild' })).toBeVisible();
  // The link is in the dialog, with the QR code; the row has only the count and its buttons (Displays.razor).
  const linkField = shown.getByLabel('Länk');
  await expect(linkField).toHaveValue(/\/watch\/[a-z2-9]{7}$/);
  const url = await linkField.inputValue();
  await expect(shown.getByRole('img', { name: 'QR-kod' })).toHaveAttribute('data-value', url);
  await shown.getByRole('button', { name: 'Stäng' }).click();
  const row = page.getByRole('listitem', { name: 'Kyrkkaffet' });
  await expect(row).toContainText('0 enheter');
  await expect(row.getByRole('textbox')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Ny kod' })).toHaveCount(0);

  // A phone opens it: the waiting screen, with the output's name.
  browser = await chromium.launch();
  const phone = await browser.newPage();
  await phone.goto(url);
  await expect(phone.getByTestId('watch-waiting')).toContainText('Kyrkkaffet');
  await expect(phone.getByTestId('watch-waiting')).toContainText('Väntar på att sändningen ska börja');

  // The host presents and switches the output on: the phone is counted.
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Chorus', 'A två'],
  ]);
  await openAdmin(page, 'Overlays');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Titel').fill('Kollekt');
  await page.getByRole('dialog', { name: 'Skapa overlay' }).getByLabel('Titel').press('Enter');
  await page.getByLabel('Textinnehåll').fill('Swish 123 45');
  await page.getByLabel('Textinnehåll').blur();
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const outputs = page.getByRole('list', { name: 'Utgångar' });
  await outputs.getByLabel('Kyrkkaffet').check();
  await expect(outputs.getByText('1 enhet')).toBeVisible({ timeout: 5_000 });
  // An overlay with nothing selected reaches the phone on its own, as the projector shows it.
  await page.getByRole('button', { name: 'Overlays', exact: true }).click();
  const overlays = page.getByRole('list', { name: 'Overlays' });
  await overlays.getByLabel('Kollekt').check();
  await expect(phone.getByTestId('watch-overlay')).toHaveText('Swish 123 45', { timeout: 5_000 });
  await overlays.getByLabel('Kollekt').uncheck();
  await expect(phone.getByTestId('watch-waiting')).toBeVisible({ timeout: 5_000 });

  // What the host shows, the phone shows; black is the waiting screen (LIVE-R14).
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(phone.getByTestId('watch-text')).toHaveText('A två', { timeout: 5_000 });
  await expect(phone.getByTestId('watch-slide')).toHaveAttribute('data-theme', 'classic');
  await expect(phone.getByText('Chorus')).toHaveCount(0); // the part label is the operator's
  await page.getByRole('button', { name: 'Rensa' }).click();
  await expect(phone.getByTestId('watch-waiting')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(phone.getByTestId('watch-text')).toHaveText('A två', { timeout: 5_000 });
  // An overlay's text reaches the phone too, above the slide (spec 04 §6).
  await overlays.getByLabel('Kollekt').check();
  await expect(phone.getByTestId('watch-overlay')).toHaveText('Swish 123 45', { timeout: 5_000 });
  await expect(phone.getByTestId('watch-text')).toHaveText('A två');

  // Skärmar says what it sends and to how many.
  await openAdmin(page, 'Skärmar');
  await expect(row).toContainText('Sänder från Söndag');
  await expect(row).toContainText('1 enhet');

  // A new code, from the QR code's dialog: the old link stops working, and the phone is told so.
  await row.getByRole('button', { name: 'Visa QR-kod' }).click();
  await expect(shown.getByText('Om koden har spridits dit den inte hör hemma kan du byta ut den mot en ny.')).toBeVisible();
  await shown.getByRole('button', { name: 'Ny kod' }).click();
  await page.getByRole('dialog', { name: 'Ny kod' }).getByRole('button', { name: 'Ny kod' }).click();
  await expect(page.getByRole('status').getByText('Ny kod skapad')).toBeVisible();
  await expect(shown).toHaveCount(0); // the old code's dialog closes, as Displays.razor's
  await row.getByRole('button', { name: 'Visa QR-kod' }).click();
  await expect(linkField).toHaveValue(/\/watch\/[a-z2-9]{7}$/);
  await expect(linkField).not.toHaveValue(url);
  await expect(phone.getByText('Det finns ingen sändning med den här koden.')).toBeVisible({ timeout: 10_000 });
});
