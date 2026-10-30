// The user detail page (spec 01 `/admin/users/{id}`, UserDetail.razor): name and e-mail saved as
// they are typed, the role, the linked logins, the invite while there are none, and removal.
import { expect, test } from '@playwright/test';
import { browserSignIn, launch, type Desktop } from './apps.ts';
import { ANNA, createUser, openAdmin, pair, setUpHost, signInWithGoogle, signOut } from './flows.ts';

let host: Desktop | undefined;
let second: Desktop | undefined;

test.afterEach(async () => {
  await second?.app.close();
  await host?.app.close();
  host = second = undefined;
});

test("a user's page: rename, change the e-mail and the role, remove a login, make an invite, delete the user", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  // Eva accepts her invite here with Google, so she has a login; then Anna signs in again.
  await openAdmin(page, 'Användare');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Skapa användare' });
  await create.getByLabel('Namn').fill('Eva');
  await create.getByLabel('E-post').fill('eva@kyrkan.se');
  await create.getByRole('button', { name: 'Skapa', exact: true }).click();
  await page.getByTestId('invite').getByRole('button', { name: 'Logga in som Eva här' }).click();
  await page.getByRole('button', { name: 'Logga in med Google' }).click();
  await browserSignIn(host, { sub: 'google-eva', email: 'eva.private@gmail.com' });
  await expect(page.getByTestId('me')).toHaveAccessibleName('Eva · Lilla Kyrkan');
  await signOut(page);
  await signInWithGoogle(host, ANNA);
  await expect(page.getByTestId('me')).toHaveAccessibleName('Anna · Lilla Kyrkan');

  // The row links to the page.
  await openAdmin(page, 'Användare');
  await page.getByRole('list', { name: 'Användare' }).getByRole('link', { name: /Eva/ }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Eva', exact: true })).toBeVisible();

  // Name and e-mail save while typing; a bad or taken address is said under the field.
  await page.getByLabel('Namn').fill('Eva Berg');
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eva Berg', exact: true })).toBeVisible();
  const email = page.getByLabel('E-post');
  const emailError = page.getByRole('alert').filter({ hasText: /./ });
  await email.fill('inte-en-adress');
  await expect(emailError).toHaveText('Ogiltig e-postadress');
  await email.fill(ANNA.email!);
  await expect(emailError).toHaveText('E-postadressen används redan av en annan användare');
  await email.fill('eva.berg@kyrkan.se');
  await expect(emailError).toHaveCount(0);
  await expect(page.getByTestId('saved')).toBeVisible();

  // The role saves at once.
  await page.getByLabel('Roll').selectOption({ label: 'Admin' });
  await expect(page.getByTestId('saved')).toBeVisible();

  // Saved on the server: the list shows it after a reload.
  await page.reload();
  await expect(page.getByLabel('Namn')).toHaveValue('Eva Berg');
  await expect(page.getByLabel('E-post')).toHaveValue('eva.berg@kyrkan.se');
  await expect(page.getByLabel('Roll')).toHaveValue('admin');

  // Her Google login, removed: then the page offers an invite.
  const logins = page.getByRole('list', { name: 'Inloggning' });
  await expect(logins.getByRole('listitem')).toHaveCount(1);
  await expect(logins).toContainText('Google');
  await expect(logins).toContainText('google-eva');
  await logins.getByRole('button', { name: 'Radera Google' }).click();
  await page.getByRole('dialog', { name: 'Ta bort kopplat konto' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Inga inloggningsmetoder tillagda.')).toBeVisible();

  // A new invite: active for 7 days, accepted here on the host; deleting it brings the empty state back.
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const invite = page.getByTestId('invite');
  await expect(invite).toContainText('Aktiv');
  await expect(invite).toContainText('Går ut om 7 dagar');
  await expect(invite.getByRole('button', { name: 'Logga in som Eva Berg här' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skapa', exact: true })).toHaveCount(0);
  await invite.getByRole('button', { name: 'Radera' }).click();
  await page.getByRole('dialog', { name: 'Ta bort inbjudan' }).getByRole('button', { name: 'Radera' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.getByText('Inga inloggningsmetoder tillagda.')).toBeVisible();

  // Deleted: back on the list, without her.
  await page.getByRole('button', { name: 'Radera användare' }).click();
  await page.getByRole('dialog', { name: 'Radera användare' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('list', { name: 'Användare' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Användare' })).not.toContainText('Eva');
});

test("Skapa användare lands on the new user's page, which shows the invite link once; Skapa ny länk replaces it", async () => {
  // On a computer paired to the host, which is not the host: the link is for sending.
  host = await launch();
  await setUpHost(host);
  await createUser(host.page, 'Bo', 'bo@kyrkan.se', 'Admin');
  second = await launch({ server: host.base });
  await pair(host.page, second.page, 'Andra datorn', 'Bo');
  const page = second.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });

  await openAdmin(page, 'Användare');
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Skapa användare' });
  await create.getByLabel('Namn').fill('Cia');
  await create.getByLabel('E-post').fill('cia@kyrkan.se');
  await create.getByRole('button', { name: 'Skapa', exact: true }).click();

  // Her page, no dialog: the card has the link, Kopiera, Dela where the system can share, and that it is shown only now.
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Cia', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const invite = page.getByTestId('invite');
  await expect(invite).toContainText('Aktiv');
  await expect(invite).toContainText('Den visas inte igen.');
  const field = invite.getByLabel('Inbjudningslänk');
  const firstLink = await field.inputValue();
  expect(firstLink).toMatch(/\/invite#gpin_/);
  await invite.getByRole('button', { name: 'Kopiera' }).click();
  await expect(page.getByText('Länk kopierad')).toBeVisible();
  await expect(invite.getByRole('button', { name: 'Dela' })).toHaveCount((await page.evaluate(() => 'share' in navigator)) ? 1 : 0);
  await expect(invite.getByRole('button', { name: 'Skapa ny länk' })).toHaveCount(0);

  // Left and opened again: the link is gone; the invite is active, with when it expires and Skapa ny länk.
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  await page.getByRole('list', { name: 'Användare' }).getByRole('link', { name: /Cia/ }).click();
  await expect(invite).toContainText('Går ut om 7 dagar');
  await expect(invite.getByLabel('Inbjudningslänk')).toHaveCount(0);
  await invite.getByRole('button', { name: 'Skapa ny länk' }).click();
  const newLink = await invite.getByLabel('Inbjudningslänk').inputValue();
  expect(newLink).toMatch(/\/invite#gpin_/);
  expect(newLink).not.toBe(firstLink);

  // The new link works; the one it replaced does not. Opened at the host, where an invite is accepted.
  const open = async (link: string) => {
    await host!.page.goto(`${host!.base}/invite${new URL(link).hash}`);
    await host!.page.reload();
  };
  await open(firstLink);
  await expect(host.page.getByRole('heading', { name: 'Ogiltig eller redan använd inbjudan.' })).toBeVisible();
  await open(newLink);
  await expect(host.page.getByRole('heading', { name: 'Välkommen Cia!' })).toBeVisible();
});
