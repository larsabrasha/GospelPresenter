// The start page's bar and Inställningar in the 2.0 layout (docs/layout-2-0.md): the bar holds + and the user's
// picture, whose menu has the rest; Inställningar opens in a dialog over the page the user is on, so a running
// presentation goes on under it, and only Stäng closes it. On a computer the list is at the left and the page at the
// right; on a phone the list is alone, and a row opens its page with ‹ Inställningar.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, adminDialog, closeAdmin, createPresentation, createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('the start page bar holds + and the picture, whose menu tells the sync and opens both settings', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  const bar = page.getByRole('navigation').first();
  await expect(bar.getByRole('button', { name: 'Ny presentation' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Inställningar' })).toHaveCount(0); // no cog
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
  await expect(page.getByRole('button', { name: /Synka nu/ })).toHaveCount(0); // the cloud shows only when something is wrong

  await page.getByTestId('me').click();
  await expect(page.getByTestId('sync-state')).toHaveText('Synkad');
  await expect(page.getByRole('menuitem', { name: 'Synka nu' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Mina inställningar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mina inställningar', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Mina inställningar' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Inloggningsmetoder' }).click();
  await expect(page).toHaveURL(/\/logins$/);
});

test('the start page shows what this window presents at the top, and each row its number of items', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();

  await page.getByTestId('presentation-bar').getByRole('link', { name: 'Tillbaka till presentationerna' }).click();

  await expect(page.getByRole('link', { name: 'Visas just nu: Söndag' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Söndag/ }).last()).toContainText('1 inslag');
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
  await expect(page).toHaveURL(/\/admin\/songs$/);
  await page.getByRole('link', { name: 'Sång A' }).click();
  const part = page.getByLabel('Delar 1', { exact: true });
  await part.fill('A nytt');
  await part.blur();
  await closeAdmin(page);

  await expect(page).toHaveURL(presenting);
  await expect(page.getByRole('button', { name: 'Avsluta presentation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sång A 1' })).toContainText('A nytt');
});

test('neither Escape nor a press outside closes Inställningar', async () => {
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

test('a link straight to a page of Inställningar opens it over the start page, which Stäng then shows', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await page.goto(`${host.base}/admin/themes`);
  const settings = adminDialog(page);
  await expect(settings.getByRole('heading', { name: 'Teman', exact: true })).toBeVisible();
  await expect(settings.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Teman' })).toHaveAttribute('aria-current', 'page');
  await closeAdmin(page);

  await expect(page).toHaveURL(`${host.base}/`);
  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
});

test('on a phone Inställningar fills the screen with its list, and a row opens its page alone with ‹ Inställningar back to it', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${host.base}/admin`);

  const list = page.getByRole('navigation', { name: 'Administration' });
  await expect(adminDialog(page)).toBeVisible();
  await expect(list.getByRole('region', { name: 'Bibliotek' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sånger', exact: true })).toBeHidden(); // the list alone
  await list.getByRole('link', { name: 'Teman', exact: true }).click();

  await expect(list).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Teman', exact: true })).toBeVisible();
  await adminDialog(page).getByRole('link', { name: 'Inställningar' }).click();
  await expect(list).toBeVisible();
  await closeAdmin(page);
  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
});

test('Om Gospel Presenter, at the foot of the list for everyone, tells the version and links out in new tabs', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);

  await openAdmin(page, 'Om Gospel Presenter');

  await expect(page).toHaveURL(/\/admin\/about$/);
  await expect(page.getByTestId('about-version')).toHaveText('okänd'); // the e2e build is given no commit
  const links = page.getByRole('navigation', { name: 'Länkar' });
  await expect(links.getByRole('link', { name: 'Webbplats' })).toHaveAttribute('href', 'https://www.gospelpresenter.com');
  await expect(links.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/larsabrasha/GospelPresenter');
  await expect(links.getByRole('link', { name: 'GitHub' })).toHaveAttribute('target', '_blank');
});
