// Milestone 3: sign-in, membership and pairing (spec 01, ADR 0007 decision 6).
// The host listens on the LAN (GP_LAN=1) and is reached at 127.0.0.1; it
// refuses everything but pairing from a device it has not paired, so a
// second desktop on the same machine is a stranger until it pairs.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { acceptInvite, createSong, inviteUser, pair, PASSWORD, setUpHost, signIn } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = second = undefined;
});

test('sign-in: sign out, a wrong password, sign in again; the library and the session survive a restart', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(page);
  // The host window's poke socket is open: its requests carry the host token, the socket's too.
  await expect(page.getByTestId('status')).toHaveText(/^Ansluten$/);
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);

  await page.getByRole('button', { name: 'Logga ut' }).click();
  await signIn(page, 'anna@kyrkan.se', 'fel lösenord igen');
  await expect(page.getByRole('alert')).toHaveText('Fel e-post eller lösenord.');
  await page.getByLabel('Lösenord').fill(PASSWORD);
  await page.getByRole('button', { name: 'Logga in' }).click();
  await expect(page.getByTestId('me')).toHaveText('Anna · Lilla Kyrkan');

  // DESK-A7: the local library is still there after signing in again.
  await page.getByRole('link', { name: 'Sånger' }).click();
  await expect(page.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible();

  // A restart opens straight into the app (spec 06: no sign-in flash).
  const { dataDir, port } = host;
  await host.app.close();
  host = await launch({ dataDir, port });
  await expect(host.page.getByTestId('me')).toHaveText('Anna · Lilla Kyrkan');
  await expect(host.page.getByRole('heading', { name: 'Logga in' })).toHaveCount(0);
});

test('pairing: a second desktop is refused until it pairs, syncs once paired and signed in, and stops when disconnected', async () => {
  host = await launch({ lan: true });
  await setUpHost(host.page);

  // A stranger gets the app's files but nothing from the API, not even the sign-in.
  const stranger = await fetch(`${host.base}/auth/state`);
  expect(stranger.status).toBe(403);
  expect(await stranger.json()).toEqual({ error: 'device-not-paired' });
  expect((await fetch(`${host.base}/auth/signin`, { method: 'POST', body: '{}' })).status).toBe(403);
  expect((await fetch(`${host.base}/sync/pull`, { method: 'POST', body: '{}' })).status).toBe(403);
  const index = await fetch(`${host.base}/`);
  expect(index.status).toBe(200);
  expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");

  second = await launch({ server: host.base });
  const device = second.page;
  await expect(device.getByRole('heading', { name: 'Anslut till värddatorn' })).toBeVisible();
  // A wrong code is refused (and counts towards killing the real one).
  await device.getByLabel('Kod').fill('000000');
  await device.getByRole('button', { name: 'Anslut' }).click();
  await expect(device.getByRole('alert')).toHaveText('Ogiltig eller utgången kod');

  await pair(host.page, device, 'Andra datorn');
  await expect(device.getByRole('heading', { name: 'Logga in' })).toBeVisible();

  // An Admin is invited on the host and joins on the paired desktop.
  const invite = await inviteUser(host.page, 'Cia', 'cia@kyrkan.se', 'Admin');
  await acceptInvite(device, host.base, invite, 'Cia');
  await createSong(device, 'Blott en dag', [['Verse 1', 'Blott en dag']]);
  await host.page.getByRole('link', { name: 'Sånger' }).click();
  await expect(host.page.getByRole('link', { name: 'Blott en dag' })).toBeVisible({ timeout: 5_000 });
  // Only the host pairs devices: the paired desktop has no Enheter.
  await expect(device.getByRole('link', { name: 'Användare' })).toBeVisible();
  await expect(device.getByRole('link', { name: 'Enheter' })).toHaveCount(0);

  // The host disconnects it; its next change is kept but not synced, and it says why.
  await host.page.getByRole('link', { name: 'Enheter' }).click();
  await expect(host.page.getByRole('list', { name: 'Enheter' }).getByText('Andra datorn')).toBeVisible();
  await host.page.getByRole('button', { name: 'Koppla från' }).click();
  await host.page.getByRole('dialog', { name: 'Koppla från' }).getByRole('button', { name: 'Koppla från' }).click();
  await expect(host.page.getByText('Frånkopplad')).toBeVisible();
  await device.getByRole('button', { name: 'Lägg till del' }).click();
  await device.getByLabel('Delar 2', { exact: true }).fill('Ett ögonblick i sänder');
  await device.getByLabel('Delar 2', { exact: true }).blur();
  await expect(device.getByTestId('status')).toContainText('Enheten är inte längre ansluten till värddatorn', { timeout: 10_000 });
  await expect(device.getByTestId('status')).toContainText('ändringar väntar');

  // Paired again, it is still signed in, and the waiting change lands.
  await device.getByRole('button', { name: 'Anslut igen' }).click();
  await pair(host.page, device, 'Andra datorn igen');
  await expect(device.getByTestId('me')).toContainText('Cia');
  await expect(device.getByTestId('status')).toHaveText(/^Ansluten$/, { timeout: 10_000 });
  await host.page.getByRole('link', { name: 'Sånger' }).click();
  await host.page.getByRole('link', { name: 'Blott en dag' }).click();
  await expect(host.page.getByLabel('Delar 2', { exact: true })).toHaveValue('Ett ögonblick i sänder');

  expect([...host.events, ...second.events].filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('membership: a removed user is signed out on their device; a demoted Admin loses Användare', async () => {
  host = await launch();
  await setUpHost(host.page);
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn');
  const invite = await inviteUser(host.page, 'Dan', 'dan@kyrkan.se', 'Admin');
  await acceptInvite(second.page, host.base, invite, 'Dan');
  await expect(second.page.getByRole('link', { name: 'Användare' })).toBeVisible();

  // ORG-A8: the role changes at once; Dan's device sees it at its next start (or /auth/me refresh).
  await host.page.getByRole('link', { name: 'Användare' }).click();
  await host.page.getByRole('combobox', { name: 'Roll för Dan' }).selectOption({ label: 'Användare' });
  await expect(host.page.getByRole('status').getByText('Rollen sparad')).toBeVisible();
  await expect(host.page.getByRole('combobox', { name: 'Roll för Anna' })).toBeDisabled(); // ORG-A4
  await second.page.reload();
  await expect(second.page.getByTestId('me')).toContainText('Dan');
  await expect(second.page.getByRole('link', { name: 'Användare' })).toHaveCount(0);

  // Removed: the device keeps working on its own data, and asks to sign in again (SYNC-A15).
  await host.page.getByRole('button', { name: 'Radera användare' }).click();
  await host.page.getByRole('dialog', { name: 'Radera användare' }).getByRole('button', { name: 'Radera' }).click();
  await expect(host.page.getByRole('list', { name: 'Användare' }).getByText('Dan')).toHaveCount(0);
  await createSong(second.page, 'Efter borttagningen', [['Verse 1', 'Text']]);
  await expect(second.page.getByTestId('status')).toContainText('Logga in igen för att synka', { timeout: 10_000 });
  await second.page.getByRole('button', { name: 'Logga in igen' }).click();
  await signIn(second.page, 'dan@kyrkan.se');
  await expect(second.page.getByRole('alert')).toHaveText('Fel e-post eller lösenord.');
});
