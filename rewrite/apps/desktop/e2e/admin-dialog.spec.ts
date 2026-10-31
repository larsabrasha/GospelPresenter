// The admin pages open in a dialog over the page the user is on, so a running presentation goes on
// under them; only Stäng closes it, back to that page. A link straight to one opens it over the start page.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, adminDialog, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('Inställningar opens over a running presentation, which goes on presenting and shows the edits made there', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  const presenting = page.url();

  await openAdmin(page, 'Sånger');
  const settings = adminDialog(page);
  await expect(page).toHaveURL(/\/admin\/songs$/);
  await settings.getByRole('link', { name: 'Sång A' }).click();
  const part = settings.getByLabel('Delar 1', { exact: true });
  await part.fill('A nytt');
  await part.blur();
  await settings.getByRole('button', { name: 'Stäng', exact: true }).first().click();

  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(presenting);
  await expect(page.getByRole('button', { name: 'Avsluta presentation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sång A 1' })).toContainText('A nytt');
});

test('neither Escape nor a press outside closes the admin dialog', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');
  const settings = adminDialog(page);

  await settings.getByRole('heading', { name: 'Sånger', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);

  await expect(settings).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/songs$/);
});

test('a link straight to an admin page opens it over the start page, which Stäng then shows', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await page.goto(`${host.base}/admin/themes`);
  const settings = adminDialog(page);
  await expect(settings.getByRole('heading', { name: 'Teman', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Stäng', exact: true }).first().click();

  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(`${host.base}/`);
  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
});

test('Om Gospel Presenter, at the foot of the menu for everyone, tells the version and links out in new tabs', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Om Gospel Presenter');

  const settings = adminDialog(page);
  await expect(page).toHaveURL(/\/admin\/about$/);
  await expect(settings.getByTestId('about-version')).toHaveText('okänd'); // the e2e build is given no commit
  const links = settings.getByRole('navigation', { name: 'Länkar' });
  await expect(links.getByRole('link', { name: 'Webbplats' })).toHaveAttribute('href', 'https://www.gospelpresenter.com');
  await expect(links.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/larsabrasha/GospelPresenter');
  await expect(links.getByRole('link', { name: 'GitHub' })).toHaveAttribute('target', '_blank');
});
