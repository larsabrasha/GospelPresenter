// Milestone 4: Bibles and themes (spec 05). A Bible translation is imported
// from a zip, a reading goes into a presentation, and it is shown on the
// output in a chosen theme, all on the host with no internet: the fonts and
// the theme's picture come with the app.
import { expect, test, type Page } from '@playwright/test';
import { sampleDblZip } from '../../../packages/core/test/bible-fixtures.ts';
import { launch, testPort, type Desktop } from './apps.ts';
import { createPresentation, createUser, openAdmin, openPresentations, pair, pickItem, setUpHost } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = undefined;
  second = undefined;
});

/** Opens "Redigera detaljer" and picks a theme by its label. */
async function chooseTheme(page: Page, label: string) {
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Redigera detaljer' }).click();
  const details = page.getByRole('dialog', { name: 'Redigera detaljer' });
  await details.getByLabel('Tema').selectOption({ label });
  await details.getByRole('button', { name: 'Spara' }).click();
}

test('a Bible reading, imported from a zip, is shown on the output in the chosen theme, offline', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  // Import: a tiny public-domain sample (World English Bible), as a DBL zip.
  await openAdmin(page, 'Biblar');
  await expect(page.getByText('Inga biblar installerade ännu.')).toBeVisible();
  await page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(page.getByTestId('bible-import-message')).toHaveText('Importerade World English Bible (exempel) med 15 verser.');
  await expect(page.locator('[data-library-item]')).toHaveCount(1);
  await expect(page.getByText('WEB · 15 verser')).toBeVisible();
  await expect(page.getByText('Tillgänglig offline')).toBeVisible();

  // The organisation's default theme: Ljust.
  await openAdmin(page, 'Teman');
  await expect(page.getByTestId('theme-classic').getByText('Standard', { exact: true })).toBeVisible();
  await page.getByTestId('theme-light').getByRole('button', { name: 'Fler val för Ljust' }).click();
  await page.getByRole('menuitem', { name: 'Använd som standard' }).click();
  await expect(page.getByRole('status').getByText('Standardtemat sparat')).toBeVisible();
  await expect(page.getByTestId('theme-light').getByText('Standard', { exact: true })).toBeVisible();

  // A presentation with its own theme, Mörkt.
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await chooseTheme(page, 'Mörkt');

  // Bibeltexter: a reference search, added with Ctrl+Enter (D15: stays open, starts over) ...
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bibeltext', exact: true }).click(); // + is a menu (spec 03 2f)
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  const search = picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)');
  await search.fill('Joh 3:16-17');
  await expect(picker.getByRole('list', { name: 'Verser' }).getByRole('listitem')).toHaveText([/^Johannes 3:16 For God so loved/, /^Johannes 3:17 /]);
  await expect(picker.getByRole('button', { name: 'Lägg till Johannes 3:16-17' })).toBeVisible();
  await search.press('Control+Enter');
  await expect(page.getByRole('status').getByText('"Johannes 3:16-17" har lagts till')).toBeVisible();
  await expect(search).toHaveValue('');

  // ... and by browsing: Psaltaren, chapter 23, verses 1 to 3.
  await picker.getByRole('button', { name: 'Psaltaren' }).click();
  await picker.getByRole('group', { name: 'Välj startkapitel' }).getByRole('button', { name: '23' }).click();
  await picker.getByRole('group', { name: 'Välj startvers' }).getByRole('button', { name: /^1 / }).click();
  await picker.getByRole('group', { name: 'Välj slutvers' }).getByRole('button', { name: /^3 / }).click();
  await picker.getByRole('button', { name: 'Lägg till Psaltaren 23:1-3' }).click();
  await expect(page.getByRole('status').getByText('"Psaltaren 23:1-3" har lagts till')).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveText([/Johannes 3:16-17/, /Psaltaren 23:1-3/]);

  // Live, on the output.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await pickItem(page, 'Johannes 3:16-17');
  await page.getByRole('button', { name: 'Johannes 3:16-17 1' }).click();
  const stage = output.getByTestId('slide-stage');
  await expect(output.getByTestId('slide-text')).toContainText('16 For God so loved the world');
  await expect(output.getByTestId('slide-credits')).toHaveText('Johannes 3:16-17 · WEB');
  // Bible text flows, with no kept line breaks (BibleTextSlide.razor).
  await expect(output.getByTestId('slide-text')).toHaveCSS('white-space', 'normal');
  await expect(stage).toHaveAttribute('data-theme', 'classic');
  await expect(stage).toHaveAttribute('data-kind', 'bible');
  await expect(stage).toHaveCSS('background-color', 'rgb(0, 0, 0)');

  // Next goes on through the reading into the psalm.
  await page.keyboard.press('PageDown');
  await expect(output.getByTestId('slide-text')).toContainText('1\u00a0Yahweh is my shepherd');

  // Back to the default theme: the output follows at once (THEME-R6), and black stays black.
  await chooseTheme(page, 'Följer organisationens standard');
  await expect(stage).toHaveAttribute('data-theme', 'light');
  await expect(stage).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Släck' }).click();
  await expect(output.getByTestId('slide-text')).toHaveCount(0);
  await expect(stage).toHaveCSS('background-color', 'rgb(0, 0, 0)');

  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('a Bible imported while the host is down is kept, and reaches the host when it is back', async () => {
  const port = testPort();
  host = await launch({ port });
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const page = second.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  // The host goes away; Bo imports a translation on the second computer all the same.
  const hostData = host.dataDir;
  await host.app.close();
  host = undefined;
  await expect(page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await openAdmin(page, 'Biblar');
  await page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(page.getByTestId('bible-import-message')).toHaveText(
    'Importerade World English Bible (exempel) med 15 verser. Servern går inte att nå just nu. Bibeln finns på den här enheten och skickas till servern när du är ansluten igen.',
  );
  await expect(page.getByText('WEB · 15 verser')).toBeVisible();
  await expect(page.getByText('Tillgänglig offline')).toBeVisible();
  await expect(page.getByTestId('status')).toContainText('1 ändring väntar');

  // The host comes back on the same port: the text is uploaded, then the import pushed.
  host = await launch({ port, dataDir: hostData });
  await host.page.getByTestId('status').waitFor();
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await openAdmin(host.page, 'Biblar');
  await expect(host.page.getByText('WEB · 15 verser')).toBeVisible({ timeout: 10_000 });
  await expect(host.page.getByText('Tillgänglig offline')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('En ändring kunde inte synkas.')).toHaveCount(0);
});

test('a second computer keeps a Bible offline only when asked, and can remove the copy (BIBLE-A16)', async () => {
  const port = testPort();
  host = await launch({ port });
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  await openAdmin(host.page, 'Biblar');
  await host.page.getByTestId('bible-file').setInputFiles({ name: 'web.zip', mimeType: 'application/zip', buffer: Buffer.from(sampleDblZip()) });
  await expect(host.page.getByText('WEB · 15 verser')).toBeVisible();
  await createPresentation(host.page, 'Gudstjänst', '2026-11-01');

  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const page = second.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  // The host keeps every Bible and offers no choice: its row says so, and its page has no switch.
  await openAdmin(host.page, 'Biblar');
  await expect(host.page.getByText('Tillgänglig offline')).toBeVisible();
  await host.page.getByRole('link', { name: /World English Bible/ }).click();
  await expect(host.page.getByRole('heading', { name: 'World English Bible (exempel)' })).toBeVisible();
  await expect(host.page.getByRole('switch')).toHaveCount(0);

  // The second computer keeps none until asked: the switch on the translation's page (Lars, 2026-11-04) is off.
  const offline = page.getByRole('switch', { name: /^Tillgänglig offline/ });
  const openBible = async () => {
    await openAdmin(page, 'Biblar');
    await page.getByRole('link', { name: /World English Bible/ }).click();
  };
  await openBible();
  await expect(offline).not.toBeChecked();

  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  const search = picker.getByLabel('Sök bok, kapitel och vers (t.ex. Joh 3:16 eller Psaltaren 23)');
  const searchJohn = async () => {
    await openPresentations(page);
    await page.getByRole('link', { name: /Gudstjänst/ }).click();
    await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Bibeltext', exact: true }).click(); // + is a menu (spec 03 2f)
    await search.fill('Joh 3:16');
    await expect(picker.getByRole('list', { name: 'Verser' }).getByRole('listitem')).toHaveText([/^Johannes 3:16 For God so loved/]);
    await picker.getByRole('button', { name: 'Stäng' }).click();
  };

  // With the host away, a Bible not kept cannot be had, and cannot be made available.
  const hostData = host.dataDir;
  await host.app.close();
  host = undefined;
  await expect(page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await openPresentations(page);
  await page.getByRole('link', { name: /Gudstjänst/ }).click();
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bibeltext', exact: true }).click(); // + is a menu (spec 03 2f)
  await expect(picker.getByText('Bibeltexten finns inte på den här enheten och kan inte hämtas utan anslutning.', { exact: false })).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await openBible();
  await offline.click();
  await expect(page.getByRole('status').getByText('Nedladdningen misslyckades. Kontrollera uppkopplingen och försök igen.')).toBeVisible();
  await expect(offline).not.toBeChecked();

  // The host is back: the text is fetched when a page needs it, without keeping it.
  host = await launch({ port, dataDir: hostData });
  await host.page.getByTestId('status').waitFor();
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await searchJohn();
  await openBible();
  await expect(offline).not.toBeChecked();

  // Switched on: downloaded at once, and the row says it is offline.
  await offline.click();
  await expect(page.getByRole('status').getByText('Översättningen är tillgänglig offline')).toBeVisible();
  await expect(offline).toBeChecked();
  await openAdmin(page, 'Biblar');
  await expect(page.getByText('Tillgänglig offline', { exact: true })).toBeVisible();

  // A fresh window, then the host goes away again: the kept Bible is searched from this computer.
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await host.app.close();
  host = undefined;
  await expect(page.getByTestId('status')).toContainText('Offline', { timeout: 5_000 });
  await searchJohn();

  // Switched off: the copy is removed.
  await openBible();
  await offline.click();
  await expect(page.getByRole('status').getByText('Den nedladdade kopian togs bort')).toBeVisible();
  await expect(offline).not.toBeChecked();
});
