// Milestone 4: Bibles and themes (spec 05). A Bible translation is imported
// from a zip, a reading goes into a presentation, and it is shown on the
// output in a chosen theme, all on the host with no internet: the fonts and
// the theme's picture come with the app.
import { expect, test, type Page } from '@playwright/test';
import { sampleDblZip } from '../../../packages/core/test/bible-fixtures.ts';
import { launch, type Desktop } from './apps.ts';
import { createPresentation, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

/** Opens "Redigera detaljer" and picks a theme by its label. */
async function chooseTheme(page: Page, label: string) {
  await page.getByRole('button', { name: 'Redigera detaljer' }).click();
  const details = page.getByRole('dialog', { name: 'Redigera detaljer' });
  await details.getByLabel('Tema').selectOption({ label });
  await details.getByRole('button', { name: 'Spara' }).click();
}

test('a Bible reading, imported from a zip, is shown on the output in the chosen theme, offline', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  // Import: a tiny public-domain sample (World English Bible), as a DBL zip.
  await page.getByRole('link', { name: 'Biblar' }).click();
  await expect(page.getByText('Inga biblar installerade ännu.')).toBeVisible();
  await page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(page.getByTestId('bible-import-message')).toHaveText('Importerade World English Bible (exempel) med 15 verser.');
  await expect(page.getByRole('heading', { name: 'Installerade biblar (1)' })).toBeVisible();
  await expect(page.getByText('WEB · 15 verser')).toBeVisible();
  await expect(page.getByText('Tillgänglig offline')).toBeVisible();

  // The organisation's default theme: Midnatt.
  await page.getByRole('link', { name: 'Teman' }).click();
  await expect(page.getByTestId('theme-classic').getByText('Standard', { exact: true })).toBeVisible();
  await page.getByTestId('theme-midnight').getByRole('button', { name: 'Använd som standard' }).click();
  await expect(page.getByRole('status').getByText('Standardtemat sparat')).toBeVisible();
  await expect(page.getByTestId('theme-midnight').getByText('Standard', { exact: true })).toBeVisible();

  // A presentation with its own theme, Norrsken.
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await chooseTheme(page, 'Norrsken');

  // Bibeltexter: a reference search, added with Shift+Enter (D15: stays open, starts over) ...
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await page.keyboard.press('Control+2');
  const search = picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)');
  await search.fill('Joh 3:16-17');
  await expect(picker.getByRole('list', { name: 'Verser' }).getByRole('listitem')).toHaveText([/^Johannes 3:16 For God so loved/, /^Johannes 3:17 /]);
  await expect(picker.getByRole('button', { name: 'Lägg till Johannes 3:16-17' })).toBeVisible();
  await search.press('Shift+Enter');
  await expect(page.getByRole('status').getByText('"Johannes 3:16-17" har lagts till')).toBeVisible();
  await expect(search).toHaveValue('');

  // ... and by browsing: Psaltaren, chapter 23, verses 1 to 3.
  await picker.getByRole('button', { name: 'Psaltaren' }).click();
  await picker.getByRole('group', { name: 'Välj startkapitel' }).getByRole('button', { name: '23' }).click();
  await picker.getByRole('group', { name: 'Välj startvers' }).getByRole('button', { name: '1', exact: true }).click();
  await picker.getByRole('group', { name: 'Välj slutvers' }).getByRole('button', { name: '3', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till Psaltaren 23:1-3' }).click();
  await expect(page.getByRole('status').getByText('"Psaltaren 23:1-3" har lagts till')).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Johannes 3:16-17/, /Psaltaren 23:1-3/]);

  // Live, on the output.
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Johannes 3:16-17 1' }).click();
  const stage = output.getByTestId('slide-stage');
  await expect(output.getByTestId('slide-text')).toContainText('16 For God so loved the world');
  await expect(output.getByTestId('slide-credits')).toHaveText('Johannes 3:16-17 · WEB');
  await expect(stage).toHaveAttribute('data-theme', 'aurora');
  await expect(stage).toHaveAttribute('data-kind', 'bible');

  // Norrsken's typeface and picture came from the app, not the internet.
  await expect(output.getByTestId('slide-text')).toHaveCSS('font-family', "Montserrat, sans-serif");
  const look = await output.evaluate(async () => {
    await document.fonts.ready;
    const stageEl = document.querySelector<HTMLElement>('[data-testid="slide-stage"]')!;
    const url = /url\("?([^")]+)"?\)/.exec(getComputedStyle(stageEl).backgroundImage)?.[1] ?? '';
    const image = await fetch(url);
    return { font: document.fonts.check('400 75px Montserrat'), url, image: image.status, type: image.headers.get('content-type') };
  });
  expect(look).toMatchObject({ font: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/assets\/background-[\w-]+\.webp$/), image: 200, type: 'image/webp' });

  // Next goes on through the reading into the psalm.
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toContainText('1\u00a0Yahweh is my shepherd');

  // Back to the default theme: the output follows at once (THEME-R6), and black stays black.
  await page.goBack();
  await chooseTheme(page, 'Följer församlingens standard');
  await expect(stage).toHaveAttribute('data-theme', 'midnight');
  await expect(stage).toHaveCSS('background-color', 'rgb(11, 27, 58)');
  await page.goForward();
  await page.getByRole('button', { name: 'Svart skärm' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(stage).toHaveCSS('background-color', 'rgb(0, 0, 0)');

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});
