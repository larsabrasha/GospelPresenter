// The user detail page (spec 01 `/admin/users/{id}`, UserDetail.razor): name and e-mail saved as
// they are typed, the role, the linked logins, the invite while there are none, and removal.
import { expect, test } from '@playwright/test';
import { browserSignIn, launch, type Desktop } from './apps.ts';
import { ANNA, openAdmin, setUpHost, signInWithGoogle, signOut } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a user\'s page: rename, change the e-mail and the role, remove a login, make an invite, delete the user', async () => {
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
  await page.getByRole('dialog', { name: 'Inbjudningslänk' }).getByRole('button', { name: 'Logga in som Eva här' }).click();
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
