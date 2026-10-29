// Milestone 3: sign-in, membership and pairing (spec 01, ADR 0007 decisions
// 6 and 12). The host signs in with Google in the system browser, which this
// test plays, against a fake Google. The host listens on the LAN (GP_LAN=1)
// and is reached at 127.0.0.1; it refuses everything but pairing from a
// device it has not paired, so a second desktop on the same machine is a
// stranger until it pairs, and pairing is how it signs in.
import { expect, test } from '@playwright/test';
import { browserSignIn, fakeGoogle, launch, type Desktop } from './apps.ts';
import { adminMenu, ANNA, createSong, createUser, openAdmin, pair, setUpHost, signInWithGoogle, signOut } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = second = undefined;
});

test('sign-in: Google in the system browser; signing out and in again; a stranger\'s account is refused; offline after the first time', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  // The host window's poke socket is open: its requests carry the host token, the socket's too.
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/);
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);

  await signOut(page);
  // A Google account no one invited gets the error page in the browser, and the app no token.
  const refused = await signInWithGoogle(host, { sub: 'google-stranger', email: 'stranger@gmail.com' });
  expect(refused.link).toBeNull();
  expect(refused.html).toContain('Inloggningsfel');
  await page.getByRole('button', { name: 'Avbryt' }).click();
  // Anna, by her linked Google account.
  await signInWithGoogle(host, ANNA);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');

  // DESK-A7: the local library is still there after signing in again.
  await openAdmin(page, 'Sånger');
  await expect(page.getByRole('link', { name: 'Härlig är jorden' })).toBeVisible();

  // A callback nobody waits for, or for another installation's scheme, is ignored (spec 06).
  await host.app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'gospelpresenter-local://auth#token=gpdt_' + 'x'.repeat(43)));
  await host.app.evaluate(({ app }) => app.emit('open-url', { preventDefault() {} }, 'gospelpresenter://auth#token=gpdt_' + 'y'.repeat(43)));
  expect(host.events.filter((e) => e.event === 'sign-in-callback').map((e) => e.accepted)).toEqual([true, true, false]);

  // A restart opens straight into the app (spec 06: no sign-in flash) without asking Google: the internet is needed only to sign in.
  const { dataDir, port } = host;
  await host.app.close();
  const google = await fakeGoogle();
  const before = google.tokens.ok;
  host = await launch({ dataDir, port });
  await expect(host.page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');
  await expect(host.page.getByRole('heading', { name: 'Logga in' })).toHaveCount(0);
  await expect(host.page.getByTestId('status')).toHaveText(/^Synkad$/);
  expect(google.tokens.ok).toBe(before);
  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]); // the window itself never left for Google
});

test('pairing: a second desktop is refused until it pairs, syncs once paired and signed in, and stops when disconnected', async () => {
  host = await launch({ lan: true });
  await setUpHost(host);

  // A stranger gets the app's files but nothing from the API, not even a Google sign-in.
  const stranger = await fetch(`${host.base}/api/auth/state`);
  expect(stranger.status).toBe(403);
  expect(await stranger.json()).toEqual({ error: 'device-not-paired' });
  expect((await fetch(`${host.base}/api/auth/google/begin`, { method: 'POST', body: '{}' })).status).toBe(403);
  expect((await fetch(`${host.base}/api/sync/pull`, { method: 'POST', body: '{}' })).status).toBe(403);
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

  // An Admin is made on the host, and the code signs the paired desktop in as her.
  await createUser(host.page, 'Cia', 'cia@kyrkan.se', 'Admin');
  await pair(host.page, device, 'Andra datorn', 'Cia');
  await expect(device.getByTestId('me')).toHaveAccessibleName(/Cia/);
  await createSong(device, 'Blott en dag', [['Verse 1', 'Blott en dag']]);
  await openAdmin(host.page, 'Sånger');
  await expect(host.page.getByRole('link', { name: 'Blott en dag' })).toBeVisible({ timeout: 5_000 });
  // Only the host pairs devices: the paired desktop has no Enheter.
  const deviceMenu = await adminMenu(device);
  await expect(deviceMenu.getByRole('link', { name: 'Användare' })).toBeVisible();
  await expect(deviceMenu.getByRole('link', { name: 'Enheter' })).toHaveCount(0);

  // The host disconnects it; its next change is kept but not synced, and it says why.
  await openAdmin(host.page, 'Enheter');
  await expect(host.page.getByRole('list', { name: 'Enheter' }).getByText('Andra datorn')).toBeVisible();
  await host.page.getByRole('button', { name: 'Koppla från' }).click();
  await host.page.getByRole('dialog', { name: 'Koppla från' }).getByRole('button', { name: 'Koppla från' }).click();
  await expect(host.page.getByText('Frånkopplad')).toBeVisible();
  await device.getByRole('button', { name: 'Lägg till del' }).click();
  await device.getByLabel('Delar 2', { exact: true }).fill('Ett ögonblick i sänder');
  await device.getByLabel('Delar 2', { exact: true }).blur();
  await expect(device.getByTestId('sync-warnings')).toContainText('Enheten är inte längre ansluten till värddatorn', { timeout: 10_000 });
  await expect(device.getByTestId('status')).toContainText('ändringar väntar');

  // Paired again as Cia, it is signed in again, and the waiting change lands.
  await device.getByRole('button', { name: 'Anslut igen' }).click();
  await pair(host.page, device, 'Andra datorn igen', 'Cia');
  await expect(device.getByTestId('me')).toHaveAccessibleName(/Cia/);
  await expect(device.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await openAdmin(host.page, 'Sånger');
  await host.page.getByRole('link', { name: 'Blott en dag' }).click();
  await expect(host.page.getByLabel('Delar 2', { exact: true })).toHaveValue('Ett ögonblick i sänder');

  expect([...host.events, ...second.events].filter((e) => e.event === 'blocked-request')).toEqual([]);
});

test('membership: a removed user is signed out on their device; a demoted Admin loses Användare', async () => {
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Dan', 'dan@kyrkan.se', 'Admin');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Dan');
  await expect((await adminMenu(second.page)).getByRole('link', { name: 'Användare' })).toBeVisible();

  // ORG-A8: the role changes at once; Dan's device sees it at its next start (or /auth/me refresh).
  await openAdmin(host.page, 'Användare');
  await host.page.getByRole('link', { name: /Anna/ }).click();
  await expect(host.page.getByLabel('Roll')).toBeDisabled(); // ORG-A4
  await expect(host.page.getByText('Du kan inte ändra din egen roll')).toBeVisible();
  await host.page.getByRole('link', { name: 'Tillbaka' }).click();
  await host.page.getByRole('link', { name: /Dan/ }).click();
  await host.page.getByLabel('Roll').selectOption({ label: 'Användare' });
  await expect(host.page.getByTestId('saved')).toBeVisible();
  await second.page.reload();
  await expect(second.page.getByTestId('me')).toHaveAccessibleName(/Dan/);
  await expect((await adminMenu(second.page)).getByRole('link', { name: 'Användare' })).toHaveCount(0);

  // Removed: the device keeps working on its own data, and asks to sign in again (SYNC-A15), which on a host is pairing.
  await host.page.getByRole('button', { name: 'Radera användare' }).click();
  await host.page.getByRole('dialog', { name: 'Radera användare' }).getByRole('button', { name: 'Radera' }).click();
  await expect(host.page.getByRole('list', { name: 'Användare' }).getByText('Dan')).toHaveCount(0);
  await createSong(second.page, 'Efter borttagningen', [['Verse 1', 'Text']]);
  await expect(second.page.getByTestId('sync-warnings')).toContainText('Logga in igen för att synka', { timeout: 10_000 });
  await second.page.getByTestId('sync-warnings').getByRole('button', { name: 'Logga in igen' }).click();
  await expect(second.page.getByRole('heading', { name: 'Anslut till värddatorn' })).toBeVisible();
  await expect(second.page.getByText('Be någon vid värddatorn om en ny kod')).toBeVisible();
  // Dan cannot be chosen any more.
  await openAdmin(host.page, 'Enheter');
  await host.page.getByRole('button', { name: 'Anslut enhet' }).click();
  await expect(host.page.getByLabel('Logga in som').locator('option')).toHaveText(['Anna']);
});

test('invites on the host: the invited person signs in with Google here, and the account is theirs from then on', async () => {
  host = await launch();
  await setUpHost(host);
  await openAdmin(host.page, 'Användare');
  await host.page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = host.page.getByRole('dialog', { name: 'Skapa användare' });
  await dialog.getByLabel('Namn').fill('Eva');
  await dialog.getByLabel('E-post').fill('eva@kyrkan.se');
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();
  await host.page.getByRole('dialog', { name: 'Inbjudningslänk' }).getByRole('button', { name: 'Logga in som Eva här' }).click();
  await expect(host.page.getByRole('heading', { name: 'Välkommen Eva!' })).toBeVisible();
  // InvitePage.razor: the organisation, "Välj hur du vill logga in", the first way and the rest behind "Fler alternativ".
  await expect(host.page.getByTestId('invite-org')).toHaveText('Du har bjudits in till Lilla Kyrkan.');
  await expect(host.page.getByText('Välj hur du vill logga in')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Skapa passkey' })).toHaveCount(0);
  await expect(host.page.getByRole('button', { name: 'Fler alternativ' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Logga in med Google' }).click();
  const eva = { sub: 'google-eva', email: 'eva.private@gmail.com' };
  await browserSignIn(host, eva);
  await expect(host.page.getByTestId('me')).toHaveAccessibleName('Eva · Lilla Kyrkan');
  await signOut(host.page);
  await signInWithGoogle(host, eva);
  await expect(host.page.getByTestId('me')).toHaveAccessibleName('Eva · Lilla Kyrkan');
});

test('creating a user: every role is described, and a bad or taken address is said under its field before anyone is created', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createUser(page, 'Eva', 'eva@kyrkan.se');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa användare' });
  // The roles this SuperAdmin may give, each with its bold label (Users.razor).
  await expect(dialog.getByTestId('role-descriptions').locator('div')).toHaveText([
    'Användare: Kan skapa presentationer och hantera sånger och overlays.',
    'Admin: Allt en användare kan göra, plus hantera mallar och användare.',
    'Superadmin: Full åtkomst, inklusive hantering av organisationer.',
  ]);
  await expect(dialog.getByTestId('role-descriptions').locator('.font-medium')).toHaveText(['Användare:', 'Admin:', 'Superadmin:']);
  await dialog.getByLabel('Namn').fill('Eva igen');
  await dialog.getByLabel('E-post').fill('inte-en-adress');
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ogiltig e-postadress');
  await dialog.getByLabel('E-post').fill('eva@kyrkan.se');
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('E-postadressen används redan av en annan användare');
  await dialog.getByRole('button', { name: 'Avbryt' }).click();
  await expect(page.getByRole('list', { name: 'Användare' }).getByRole('listitem')).toHaveCount(2);
});
