// Public output (spec 04 §6, §7): an admin makes one; anyone opens its link
// in a browser, with no sign-in, and follows what the host presents.
import { chromium, expect, test, type Browser } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, setUpHost } from './flows.ts';

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
  await page.getByRole('link', { name: 'Skärmar' }).click();
  await expect(page.getByText('Inga publika utgångar')).toBeVisible();
  await page.getByRole('button', { name: 'Skapa publik utgång' }).click();
  await page.getByRole('dialog', { name: 'Skapa publik utgång' }).getByLabel('Namn').fill('Kyrkkaffet');
  await page.getByRole('dialog', { name: 'Skapa publik utgång' }).getByRole('button', { name: 'Skapa' }).click();
  const linkField = page.getByLabel('Länk Kyrkkaffet');
  await expect(linkField).toHaveValue(/\/watch\/[a-z2-9]{7}$/);
  const url = await linkField.inputValue();

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
  await page.getByRole('link', { name: 'Overlays', exact: true }).click();
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

  // What the host shows, the phone shows; black is the waiting screen (LIVE-R14).
  await page.getByRole('button', { name: 'Sång A 2' }).click();
  await expect(phone.getByTestId('watch-text')).toHaveText('A två', { timeout: 5_000 });
  await expect(phone.getByTestId('watch-slide')).toHaveAttribute('data-theme', 'classic');
  await expect(phone.getByText('Chorus')).toHaveCount(0); // the part label is the operator's
  await page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(phone.getByTestId('watch-waiting')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(phone.getByTestId('watch-text')).toHaveText('A två', { timeout: 5_000 });
  // An overlay's text reaches the phone too, above the slide (spec 04 §6).
  await page.locator('summary', { hasText: 'Overlays' }).click();
  await page.getByRole('list', { name: 'Overlays' }).getByLabel('Kollekt').check();
  await expect(phone.getByTestId('watch-overlay')).toHaveText('Swish 123 45', { timeout: 5_000 });
  await expect(phone.getByTestId('watch-text')).toHaveText('A två');

  // Skärmar says what it sends and to how many.
  await page.getByRole('link', { name: 'Skärmar' }).click();
  await expect(page.getByRole('listitem', { name: 'Kyrkkaffet' })).toContainText('Sänder från Söndag · 1 enhet');

  // A new code: the old link stops working, and the phone is told so.
  await page.getByRole('button', { name: 'Ny kod' }).click();
  await page.getByRole('dialog', { name: 'Ny kod' }).getByRole('button', { name: 'Ny kod' }).click();
  await expect(page.getByRole('status').getByText('Ny kod skapad')).toBeVisible();
  await expect(linkField).not.toHaveValue(url);
  await expect(phone.getByText('Det finns ingen sändning med den här koden.')).toBeVisible({ timeout: 10_000 });
});
