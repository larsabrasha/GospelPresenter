// The desktop app's first start (D8; Lars, 2026-11-26): an account on our cloud first, another server by its address,
// or this computer alone as the host; the choice kept for the next start, and "Byt server" back.
import { expect, test } from '@playwright/test';
import { type Desktop, launch } from './apps.ts';
import { openAdmin, setUpHost, signOut } from './flows.ts';

let apps: Desktop[] = [];
test.afterEach(async () => {
  for (const d of apps) await d.app.close();
  apps = [];
});

test('the first start offers the cloud first, refuses a server that does not answer, and goes to one that does', async () => {
  const other = await launch();
  apps.push(other);
  await setUpHost(other, { name: 'Bo', org: 'Stora Kyrkan', google: { sub: 'google-bo', email: 'bo@kyrkan.se', name: 'Bo' } });
  const mine = await launch();
  apps.push(mine);
  const page = mine.page;

  await expect(page.getByRole('heading', { name: 'Välkommen!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Logga in', exact: true })).toBeVisible();
  await expect(page.getByText('app.gospelpresenter.com')).toBeVisible();
  await page.getByRole('button', { name: 'Annan server…' }).click();
  await page.getByLabel('Serverns adress').fill('http://127.0.0.1:9');
  await page.getByRole('button', { name: 'Använd', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Ingen Gospel Presenter-server svarar på den adressen.');

  await page.getByLabel('Serverns adress').fill(other.base);
  await page.getByRole('button', { name: 'Använd', exact: true }).click();

  // The other computer is a host: this app pairs with it, as a phone does.
  await expect(page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  expect(page.url().startsWith(other.base)).toBe(true);
});

test('the server chosen is kept for the next start, and Byt server goes back to this computer', async () => {
  const other = await launch();
  apps.push(other);
  await setUpHost(other, { name: 'Bo', org: 'Stora Kyrkan', google: { sub: 'google-bo', email: 'bo@kyrkan.se', name: 'Bo' } });
  const first = await launch();
  await first.page.getByRole('button', { name: 'Annan server…' }).click();
  await first.page.getByLabel('Serverns adress').fill(other.base);
  await first.page.getByRole('button', { name: 'Använd', exact: true }).click();
  await expect(first.page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  await first.app.close();

  const again = await launch({ dataDir: first.dataDir });
  apps.push(again);
  await expect(again.page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  await again.page.getByRole('button', { name: 'Byt server' }).click();

  await expect(again.page.getByRole('button', { name: 'Använd utan konto' })).toBeVisible();
  expect(again.page.url().startsWith(other.base)).toBe(false);
});

test('the computer used without an account is set up with two names, and comes back in after signing out without signing in', async () => {
  const host = await launch();
  apps.push(host);
  await setUpHost(host, { name: 'Anna', org: 'Lilla Kyrkan', google: null });

  await signOut(host.page, { toSignIn: false });
  await expect(host.page.getByRole('heading', { name: 'Välkommen tillbaka!' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Fortsätt på den här datorn' }).click();

  await expect(host.page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');
});

test('Enheter i nätverket lets the church\'s phones and screens in, and connecting a device turns it on', async () => {
  const host = await launch();
  apps.push(host);
  await setUpHost(host, { name: 'Anna', org: 'Lilla Kyrkan', google: null });
  await openAdmin(host.page, 'Enheter i nätverket');
  const lan = host.page.getByRole('switch', { name: 'Låt mobiler och skärmar ansluta' });
  await expect(lan).not.toBeChecked();

  await host.page.getByRole('button', { name: 'Anslut enhet' }).first().click();
  await host.page.getByRole('dialog', { name: 'Anslut enhet' }).getByRole('button', { name: 'Visa kod' }).click();

  await expect(host.page.getByRole('img', { name: 'QR-kod för att ansluta enheten' })).toBeVisible();
  await expect(lan).toBeChecked();
});
