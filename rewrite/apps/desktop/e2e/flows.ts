// Steps the e2e tests share, written as a user would do them.
import { expect, type Page } from '@playwright/test';

/** Creates a song with labelled parts and stays in its editor. */
export async function createSong(page: Page, name: string, parts: [string, string][]) {
  await page.getByRole('link', { name: 'Sånger' }).click();
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
    await page.getByRole('combobox', { name: 'Delar' }).nth(i).selectOption({ label });
  }
}

/** Creates a presentation and stays in its editor. */
export async function createPresentation(page: Page, name: string, date?: string) {
  await page.getByRole('link', { name: 'Presentationer' }).click();
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

export const PASSWORD = 'korrekt hästbatteri';

/** First run on the host (D19): the host's own window gets the setup token, so the person only fills in who they are. */
export async function setUpHost(page: Page, who = { name: 'Anna', org: 'Lilla Kyrkan', email: 'anna@kyrkan.se' }) {
  await expect(page.getByRole('heading', { name: 'Välkommen!' })).toBeVisible();
  await expect(page.getByLabel('Installationskod')).toHaveCount(0); // the host hands it over
  await page.getByLabel('Ditt namn').fill(who.name);
  await page.getByLabel('Församlingens eller organisationens namn').fill(who.org);
  await page.getByLabel('E-post').fill(who.email);
  await page.getByLabel('Lösenord', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Upprepa lösenordet').fill(PASSWORD);
  await page.getByRole('button', { name: 'Kom igång' }).click();
  await expect(page.getByTestId('me')).toHaveText(`${who.name} · ${who.org}`);
  await page.getByTestId('status').waitFor();
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await expect(page.getByRole('heading', { name: 'Logga in' })).toBeVisible();
  await page.getByLabel('E-post').fill(email);
  await page.getByLabel('Lösenord').fill(password);
  await page.getByRole('button', { name: 'Logga in' }).click();
}

/** On the host: a new user, and the invite link it shows once. Returns the link's `#/invite/…` part. */
export async function inviteUser(page: Page, name: string, email: string, role: 'Användare' | 'Admin' = 'Användare'): Promise<string> {
  await page.getByRole('link', { name: 'Användare' }).click();
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa användare' });
  await dialog.getByLabel('Namn').fill(name);
  await dialog.getByLabel('E-post').fill(email);
  await dialog.getByLabel('Roll').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Skapa', exact: true }).click();
  const link = await page.getByRole('dialog', { name: 'Inbjudningslänk' }).getByLabel('Länk').inputValue();
  await page.getByRole('dialog', { name: 'Inbjudningslänk' }).getByRole('button', { name: 'Stäng' }).click();
  return link.slice(link.indexOf('#'));
}

/** Opens an invite link on a device, chooses a password, and lands in the app. */
export async function acceptInvite(page: Page, base: string, invite: string, name: string) {
  await page.goto(`${base}/${invite}`);
  await page.reload(); // a link opened in a new tab loads the page; a hash change alone does not
  await expect(page.getByRole('heading', { name: `Välkommen ${name}!` })).toBeVisible();
  await page.getByLabel('Lösenord', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Upprepa lösenordet').fill(PASSWORD);
  await page.getByRole('button', { name: 'Spara lösenord och logga in' }).click();
  await expect(page.getByTestId('me')).toContainText(name);
  await page.getByTestId('status').waitFor();
}

/** Pairs a device with the host: a code made on the host, typed on the device (ADR 0007, decision 6). */
export async function pair(host: Page, device: Page, name: string) {
  await expect(device.getByRole('heading', { name: 'Anslut till värddatorn' })).toBeVisible();
  await host.getByRole('link', { name: 'Enheter' }).click();
  await host.getByRole('button', { name: 'Anslut enhet' }).click();
  const code = (await host.getByTestId('pair-code').textContent())!.trim();
  await host.getByRole('dialog', { name: 'Anslut enhet' }).getByRole('button', { name: 'Stäng' }).click();
  await device.getByLabel('Kod').fill(code);
  await device.getByLabel('Enhetens namn').fill(name);
  await device.getByRole('button', { name: 'Anslut' }).click();
}
