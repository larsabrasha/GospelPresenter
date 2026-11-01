// The sync in the bar (docs/layout-2-0.md): a cloud only while something is wrong, which syncs now; the picture's
// menu says how it stands; a change the server refused is told in a toast.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('the cloud shows in the bar only while changes wait past a moment, and the menu behind the picture says how the sync stands', async () => {
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  const status = page.getByTestId('status');
  await expect(status).toHaveText(/^Synkad$/, { timeout: 5_000 });
  const cloud = page.getByRole('button', { name: /Synka nu/ });
  await expect(cloud).toHaveCount(0);
  // Every push from here on takes 4 s.
  await page.route('**/api/sync/push', async (route) => {
    await new Promise((r) => setTimeout(r, 4000)); // a slow network, not a wait in the test
    await route.continue();
  });

  await page.getByRole('button', { name: 'Ny presentation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Skapa presentation' }).getByLabel('Namn').press('Enter');

  await expect(cloud).toBeVisible();
  await expect(status).toContainText(/ändringa?r? väntar/);
  await page.getByTestId('me').click();
  await expect(page.getByTestId('sync-state')).toContainText(/ändringa?r? väntar/);
  await expect(page.getByRole('menuitem', { name: 'Synka nu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(status).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await expect(cloud).toHaveCount(0);
});

test('a change the server refuses is told in a toast, and the bar shows no warning for it', async () => {
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  await expect(page.getByTestId('status')).toHaveText(/^Synkad$/, { timeout: 5_000 });
  // The next push reaches the server with a name over 200 characters, which the server refuses.
  await page.route('**/api/sync/push', async (route) => {
    const body = route.request().postDataJSON() as { mutations: { name: string; args: Record<string, unknown> }[] };
    for (const m of body.mutations) if (m.name === 'createPresentation') m.args.name = 'x'.repeat(201);
    await route.continue({ postData: JSON.stringify(body) });
  });

  await openPresentations(page);
  await page.getByRole('button', { name: 'Ny presentation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa presentation' });
  await dialog.getByLabel('Namn').fill('Gudstjänst');
  await dialog.getByLabel('Namn').press('Enter');

  await expect(page.getByRole('alert').getByText('En ändring kunde inte synkas.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('sync-warnings')).toHaveCount(0);
  await openPresentations(page);
  await expect(page.getByRole('link', { name: 'Gudstjänst' })).toHaveCount(0);
});
