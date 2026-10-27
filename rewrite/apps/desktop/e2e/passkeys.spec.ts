// Passkeys (ADR 0007 decision 12): a full alternative to Google. On the
// desktop host the ceremony runs in the system browser at http://localhost,
// which this test plays with Playwright's Chromium and its virtual
// authenticator (CDP WebAuthn) in place of Touch ID. In a plain browser it
// runs in the page, against the Node server started as `serve` does.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TestBrowser } from '../../server/test/fake-google.ts';
import { browserPasskey, fakeGoogle, launch, opened, passkeyBrowser, type Desktop, type PasskeyBrowser } from './apps.ts';
import { ANNA, setUpHost, signInWithGoogle, signOut } from './flows.ts';

let host: Desktop | undefined;
let server: ChildProcess | undefined;
let browser: PasskeyBrowser | undefined;

test.afterEach(async () => {
  server?.kill();
  await browser?.close();
  await host?.app.close();
  host = server = browser = undefined;
});

/** Inloggningsmetoder, in the menu behind the user's picture in the bar. */
async function openLogins(page: Page) {
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Inloggningsmetoder' }).click();
  await expect(page.getByRole('heading', { name: 'Inloggningsmetoder' })).toBeVisible();
  return page.getByRole('list', { name: 'Inloggningsmetoder' }).getByRole('listitem');
}

test('desktop host: set up with a passkey, link Google from the session; either signs in as the same user; the last method stays', async () => {
  host = await launch();
  const page = host.page;
  browser = await passkeyBrowser();

  // D19 with a passkey: the system browser makes it, at localhost (never 127.0.0.1, which cannot be an RP ID).
  await page.getByLabel('Ditt namn').fill('Anna');
  await page.getByLabel('Församlingens eller organisationens namn').fill('Lilla Kyrkan');
  await page.getByRole('button', { name: 'Kom igång' }).click();
  await page.getByRole('button', { name: 'Skapa passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Fortsätt i webbläsaren' })).toBeVisible();
  const made = await browserPasskey(host, browser!);
  expect(made.url).toMatch(new RegExp(`^http://localhost:${host.port}/api/auth/passkey/start\\?flow=`));
  expect(made.result).toBe('ok');
  expect(made.link).toMatch(/^gospelpresenter-local:\/\/auth#token=gpdt_/);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');

  // Only a passkey: it cannot be removed.
  let rows = await openLogins(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Passkey');
  await expect(rows.first().getByRole('button', { name: 'Ta bort' })).toBeDisabled();
  await expect(page.getByText('Det här är ditt enda sätt att logga in')).toBeVisible();
  // Link Google from this session, in the system browser (Google's own sign-in stays on 127.0.0.1).
  await page.getByRole('button', { name: 'Koppla Google-konto' }).click();
  await expect(page.getByRole('status').getByText('Fortsätt i webbläsaren som öppnades')).toBeVisible();
  const google = await opened(host);
  expect(google).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${host.port}/api/auth/google/start\\?flow=`));
  (await fakeGoogle()).next(ANNA);
  const linked = await new TestBrowser().open(google);
  expect(linked.html).toContain('Google-kontot är kopplat');
  await expect(rows).toHaveCount(2, { timeout: 5_000 });
  await expect(rows.nth(1)).toContainText(ANNA.email);

  // Either way in lands on Anna.
  await signOut(page);
  await signInWithGoogle(host, ANNA);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');
  await signOut(page);
  await page.getByRole('button', { name: 'Logga in med passkey' }).click();
  const signedIn = await browserPasskey(host, browser!);
  expect(signedIn.url).toMatch(new RegExp(`^http://localhost:${host.port}/api/app-login\\?`));
  expect(signedIn.link).toMatch(/^gospelpresenter-local:\/\/auth#token=gpdt_/);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');

  // Rename the passkey; remove Google; the passkey is the last and stays.
  rows = await openLogins(page);
  await rows.first().getByRole('button', { name: 'Byt namn' }).click();
  await page.getByRole('dialog', { name: 'Byt namn på passkey' }).getByLabel('Namn').fill('Värddatorn');
  await page.getByRole('dialog', { name: 'Byt namn på passkey' }).getByRole('button', { name: 'Spara' }).click();
  await expect(rows.first()).toContainText('Värddatorn');
  await rows.nth(1).getByRole('button', { name: 'Ta bort' }).click();
  await page.getByRole('dialog', { name: 'Ta bort inloggningsmetod' }).getByRole('button', { name: 'Ta bort' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'Ta bort' })).toBeDisabled();
  await signOut(page);
  // Google no longer gets in.
  const refused = await signInWithGoogle(host, ANNA);
  expect(refused.link).toBeNull();
});

test('desktop host: a Google user adds a passkey in the system browser, then signs in with it', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  browser = await passkeyBrowser();
  const rows = await openLogins(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'Ta bort' })).toBeDisabled();
  await page.getByRole('button', { name: 'Lägg till passkey' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lägg till passkey' });
  await dialog.getByLabel('Namn').fill('Annas Mac');
  await dialog.getByRole('button', { name: 'Spara' }).click();
  const added = await browserPasskey(host, browser!);
  expect(added.result).toBe('ok');
  expect(added.link).toBeNull(); // nothing to hand back: the app sees the new passkey in the list
  await expect(rows).toHaveCount(2, { timeout: 5_000 });
  await expect(rows.nth(1)).toContainText('Annas Mac');
  await expect(page.getByRole('status').getByText('Passkeyn är tillagd')).toBeVisible();

  await signOut(page);
  await page.getByRole('button', { name: 'Logga in med passkey' }).click();
  await browserPasskey(host, browser!);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');
  expect(host.events.filter((e) => e.event === 'blocked-request')).toEqual([]);
});

/** `pnpm --filter @gp/desktop serve` with passkeys on: the server alone, no pairing, on localhost. */
async function serve(): Promise<{ url: string; setupToken: string }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const setupToken = 'gpst_e2e-setup-token';
  server = spawn(process.execPath, ['dist/serve.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      GP_DATA_DIR: mkdtempSync(join(tmpdir(), 'gp-serve-')),
      GP_SETUP_TOKEN: setupToken,
      GP_PASSKEY_RP_ID: 'localhost',
      GP_PASSKEY_ORIGINS: `http://localhost:${port}`,
      GP_LAN: '',
      GP_GOOGLE_CLIENT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    server!.stdout!.on('data', (c: Buffer) => String(c).includes('Gospel Presenter:') && resolve());
    server!.once('exit', (code) => reject(new Error(`serve exited with ${code}`)));
  });
  return { url: `http://localhost:${port}`, setupToken };
}

test('in a browser: setup with a passkey in the page, a second passkey from another device, sign-in with it, and the last one stays', async () => {
  const s = await serve();
  browser = await passkeyBrowser();
  const page = browser.page;
  await page.goto(`${s.url}/songs`);

  await expect(page.getByRole('heading', { name: 'Välkommen!' })).toBeVisible();
  await expect(page.getByText('Sedan skapar du en passkey, som blir superanvändarens sätt att logga in.')).toBeVisible(); // no Google here
  await page.getByLabel('Ditt namn').fill('Bo');
  await page.getByLabel('Församlingens eller organisationens namn').fill('Stora Kyrkan');
  await page.getByLabel('Installationskod').fill(s.setupToken);
  await page.getByRole('button', { name: 'Kom igång' }).click();
  await expect(page.getByRole('button', { name: 'Logga in med Google' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skapa passkey' }).click();
  await expect(page.getByTestId('me')).toHaveAccessibleName('Bo · Stora Kyrkan');

  // Another device (the first one gone): its passkey is added from this session, in the page.
  let rows = await openLogins(page);
  await browser.newDevice();
  await page.getByRole('button', { name: 'Lägg till passkey' }).click();
  await page.getByRole('dialog', { name: 'Lägg till passkey' }).getByLabel('Namn').fill('Telefonen');
  await page.getByRole('dialog', { name: 'Lägg till passkey' }).getByRole('button', { name: 'Spara' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Telefonen');
  // The first device's passkey goes; the second is then the last and stays.
  await rows.first().getByRole('button', { name: 'Ta bort' }).click();
  await page.getByRole('dialog', { name: 'Ta bort inloggningsmetod' }).getByRole('button', { name: 'Ta bort' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: 'Ta bort' })).toBeDisabled();

  await signOut(page);
  await page.getByRole('button', { name: 'Logga in med passkey' }).click();
  await expect(page.getByTestId('me')).toHaveAccessibleName('Bo · Stora Kyrkan');
  rows = await openLogins(page);
  await expect(rows.first()).toContainText('Telefonen');
});
