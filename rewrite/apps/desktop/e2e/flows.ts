// Steps the e2e tests share, written as a user would do them.
import { expect, type Page } from '@playwright/test';
import type { FakeAccount } from '../../server/test/fake-google.ts';
import { browserSignIn, type Desktop } from './apps.ts';

/** The admin menu at the side, opened with the cog in the bar unless an admin page is open already. */
export async function adminMenu(page: Page) {
  const menu = page.getByRole('navigation', { name: 'Administration' });
  if (!(await menu.isVisible())) await page.getByRole('link', { name: 'Inställningar', exact: true }).click();
  return menu;
}

/** Opens a page of the admin menu: Sånger, Bilder, Användare and the rest. */
export async function openAdmin(page: Page, name: string) {
  await (await adminMenu(page)).getByRole('link', { name, exact: true }).click();
}

/** The start page, the presentations: the logo in the bar. */
export async function openPresentations(page: Page) {
  await page.getByRole('link', { name: 'Gospel Presenter' }).click();
  await expect(page.getByRole('heading', { name: 'Presentationer', exact: true })).toBeVisible();
}

/** Logga ut, in the menu behind the user's picture in the bar. */
export async function signOut(page: Page) {
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Logga ut' }).click();
}

/** Creates a song with labelled parts and stays in its editor. */
export async function createSong(page: Page, name: string, parts: [string, string][]) {
  await openAdmin(page, 'Sånger');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa sång' });
  await dialog.getByLabel('Namn').fill(name);
  await dialog.getByLabel('Namn').press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  for (const [i, [label, text]] of parts.entries()) {
    await page.getByRole('button', { name: 'Lägg till del' }).click();
    const part = page.getByLabel(`Delar ${i + 1}`, { exact: true });
    await part.fill(text);
    await part.blur();
    const labelPicker = page.getByRole('combobox', { name: 'Etikett' }).nth(i);
    await labelPicker.click();
    await page.getByRole('listbox', { name: 'Etikett' }).getByRole('option', { name: label, exact: true }).click();
    await expect(labelPicker).toHaveText(label);
  }
}

/** Creates a presentation and stays in its editor. */
export async function createPresentation(page: Page, name: string, date?: string) {
  await openPresentations(page);
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa presentation' });
  await dialog.getByLabel('Namn').fill(name);
  if (date) await dialog.getByLabel('Datum').fill(date);
  await dialog.getByLabel('Namn').press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Adds songs through the picker, each found by typing its name, and closes it. */
export async function addSongs(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  for (const name of names) {
    await picker.getByLabel('Sök på titel, författare eller textrad').fill(name);
    await picker.getByRole('button', { name: `Lägg till ${name}` }).click();
    await expect(page.getByRole('status').getByText(`"${name}" har lagts till`)).toBeVisible();
  }
  await picker.getByRole('button', { name: 'Stäng' }).click();
}

/** Google accounts for the people in the tests. */
export const ANNA: FakeAccount = { sub: 'google-anna', email: 'anna@kyrkan.se', name: 'Anna' };

/**
 * First run on the host (D19): the host's own window gets the setup token,
 * so the person only fills in who they are, then signs in with Google in
 * the system browser (once, with internet). passkeys.spec.ts sets up with a passkey.
 */
export async function setUpHost(d: Desktop, who = { name: 'Anna', org: 'Lilla Kyrkan', google: ANNA }) {
  const page = d.page;
  await expect(page.getByRole('heading', { name: 'Välkommen!' })).toBeVisible();
  await expect(page.getByLabel('Installationskod')).toHaveCount(0); // the host hands it over
  await page.getByLabel('Ditt namn').fill(who.name);
  await page.getByLabel('Församlingens eller organisationens namn').fill(who.org);
  await page.getByRole('button', { name: 'Kom igång' }).click();
  // The host offers a passkey and Google; this is the Google way.
  await page.getByRole('button', { name: 'Logga in med Google' }).click();
  await expect(page.getByRole('heading', { name: 'Fortsätt i webbläsaren' })).toBeVisible();
  const { link } = await browserSignIn(d, who.google);
  expect(link).toMatch(/^gospelpresenter-local:\/\/auth#token=gpdt_/);
  await expect(page.getByTestId('me')).toHaveAccessibleName(`${who.name} · ${who.org}`);
  await page.getByTestId('status').waitFor();
}

/** "Logga in med Google" in the app, finished in the system browser as `who`. */
export async function signInWithGoogle(d: Desktop, who: FakeAccount) {
  await expect(d.page.getByRole('heading', { name: 'Logga in' })).toBeVisible();
  await d.page.getByRole('button', { name: 'Logga in med Google' }).click();
  return browserSignIn(d, who);
}

/** On the host: a new user. The invite it makes is for accepting at the host; devices are paired instead. */
export async function createUser(page: Page, name: string, email: string, role: 'Användare' | 'Admin' = 'Användare') {
  await openAdmin(page, 'Användare');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa användare' });
  await dialog.getByLabel('Namn').fill(name);
  await dialog.getByLabel('E-post').fill(email);
  await dialog.getByLabel('Roll').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();
  await page.getByRole('dialog', { name: 'Inbjudningslänk' }).getByRole('button', { name: 'Stäng' }).click();
}

/**
 * Pairs a device with the host (ADR 0007, decision 6): a code made on the
 * host for the member it signs the device in as, typed on the device.
 */
export async function pair(host: Page, device: Page, name: string, as?: string) {
  await expect(device.getByRole('heading', { name: 'Anslut till värddatorn' })).toBeVisible();
  await openAdmin(host, 'Enheter');
  await host.getByRole('button', { name: 'Anslut enhet' }).click();
  const choose = host.getByRole('dialog', { name: 'Anslut enhet' });
  if (as) await choose.getByLabel('Logga in som').selectOption({ label: as });
  await choose.getByRole('button', { name: 'Visa kod' }).click();
  const code = (await host.getByTestId('pair-code').textContent())!.trim();
  // On the LAN the dialog has a QR code too: the code rides in the fragment, and the device's form is filled from it.
  const qr = host.getByRole('img', { name: 'QR-kod för att ansluta enheten' });
  const link = (await qr.count()) ? await qr.getAttribute('data-value') : null;
  await host.getByRole('dialog', { name: 'Anslut enhet' }).getByRole('button', { name: 'Stäng' }).click();
  if (link) {
    expect(link).toMatch(new RegExp(`^https?://[^/]+/#pair=${code}$`));
    await device.goto(`${device.url().split('#')[0]}#pair=${code}`);
    await device.reload();
    await expect(device.getByLabel('Kod')).toHaveValue(code);
    await expect.poll(() => new URL(device.url()).hash).toBe(''); // taken out of the address once read
  } else await device.getByLabel('Kod').fill(code);
  await device.getByLabel('Enhetens namn').fill(name);
  await device.getByRole('button', { name: 'Anslut' }).click();
}

/**
 * The live page's "Tillåt fjärrstyrning", its section opened first: Fjärrstyrning starts closed, as
 * LivePanel.razor's.
 */
export async function remoteSwitch(page: Page) {
  const section = page.getByRole('button', { name: 'Fjärrstyrning', exact: true });
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
  return page.getByLabel('Tillåt fjärrstyrning');
}

/**
 * Switches remote control on for the first time on this live page, and closes the
 * "Fjärrstyr presentationen" dialog that then opens by itself, as LivePanel.razor's.
 */
export async function allowRemote(page: Page) {
  await (await remoteSwitch(page)).check();
  await page.getByRole('dialog', { name: 'Fjärrstyr presentationen' }).getByRole('button', { name: 'Stäng' }).click();
}
