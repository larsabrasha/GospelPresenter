// The sync icon in the bar (Components/SyncStatusIndicator.razor): a click
// syncs now, a sync that runs long shows a spinner, and a change the server
// refused is told in a toast.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a click on the sync icon syncs now, and a sync that runs over 1.5 s shows the spinner', async () => {
  host = await launch();
  await setUpHost(host);
  const page = host.page;
  const status = page.getByTestId('status');
  await expect(status).toHaveText(/^Synkad$/, { timeout: 5_000 });
  await expect(status).toHaveAttribute('title', 'Synkad · Synka nu');
  // Every pull from here on takes 2.5 s.
  let pulls = 0;
  await page.route('**/api/sync/pull', async (route) => {
    pulls++;
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });

  await status.click();

  await expect(status).toHaveText(/^Synkar…$/);
  await expect(status.locator('.animate-spin')).toBeVisible();
  expect(pulls).toBeGreaterThan(0);
  await expect(status).toHaveText(/^Synkad$/, { timeout: 10_000 });
  await expect(status.locator('.animate-spin')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa presentation' });
  await dialog.getByLabel('Namn').fill('Gudstjänst');
  await dialog.getByLabel('Namn').press('Enter');

  await expect(page.getByRole('alert').getByText('En ändring kunde inte synkas.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('sync-warnings')).toHaveCount(0);
  await openPresentations(page);
  await expect(page.getByRole('link', { name: 'Gudstjänst' })).toHaveCount(0);
});
