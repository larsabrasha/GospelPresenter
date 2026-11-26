// The desktop app's first start (D8; Lars, 2026-11-26): an account on our cloud first, or this computer used without
// an account; another server by its address where one signs in, or when the cloud does not answer; the choice kept
// for the next start. GP_CLOUD stands in for our cloud: nothing answers at it unless a test says otherwise.
import { expect, test } from '@playwright/test';
import { type Desktop, launch } from './apps.ts';
import { openAdmin, setUpHost, signOut } from './flows.ts';

let apps: Desktop[] = [];
test.afterEach(async () => {
  for (const d of apps) await d.app.close();
  apps = [];
});

const BO = { name: 'Bo', org: 'Stora Kyrkan', google: { sub: 'google-bo', email: 'bo@kyrkan.se', name: 'Bo' } };

test('the first start offers two choices; when the cloud does not answer, another server by its address, refused until one answers', async () => {
  const other = await launch();
  apps.push(other);
  await setUpHost(other, BO);
  const mine = await launch();
  apps.push(mine);
  const page = mine.page;
  await expect(page.getByRole('heading', { name: 'Välkommen!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Använd utan konto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Annan server…' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Ingen Gospel Presenter-server svarar på den adressen.');
  await page.getByRole('button', { name: 'Annan server…' }).click();
  await expect(page.getByRole('heading', { name: 'Annan server' })).toBeVisible();
  await page.getByLabel('Serverns adress').fill('http://127.0.0.1:9');
  await page.getByRole('button', { name: 'Använd', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Ingen Gospel Presenter-server svarar på den adressen.');
  await page.getByLabel('Serverns adress').fill(other.base);
  await page.getByRole('button', { name: 'Använd', exact: true }).click();

  // The other computer is used without an account: this app pairs with it, as a phone does.
  await expect(page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  expect(page.url().startsWith(other.base)).toBe(true);
});

test('the cloud chosen is kept for the next start, and Annan server… on its page opens the address on this computer', async () => {
  const cloud = await launch();
  apps.push(cloud);
  await setUpHost(cloud, BO);
  const first = await launch({ env: { GP_CLOUD: cloud.base } });
  await first.page.getByRole('button', { name: 'Logga in', exact: true }).click();
  await expect(first.page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  await first.app.close();

  const again = await launch({ dataDir: first.dataDir, env: { GP_CLOUD: cloud.base } });
  apps.push(again);
  await expect(again.page.getByRole('heading', { name: 'Anslut till kyrkans dator' })).toBeVisible();
  await again.page.getByRole('button', { name: 'Annan server…' }).click();

  await expect(again.page.getByRole('heading', { name: 'Annan server' })).toBeVisible();
  expect(again.page.url().startsWith(cloud.base)).toBe(false);
  await again.page.getByRole('button', { name: 'Avbryt' }).click();
  await expect(again.page.getByRole('button', { name: 'Använd utan konto' })).toBeVisible();
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
