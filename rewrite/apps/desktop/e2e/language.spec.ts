// The language switch (GAPS.md "Engelska", decided on 2026-10-31): Swedish until a device chooses English under
// Mina inställningar; the choice belongs to the device, so it outlasts a reload and a sign-out.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('English chosen under Mina inställningar shows the app in English, after a reload and on the sign-in page', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Mina inställningar');

  await page.getByRole('radio', { name: 'English' }).click();

  await expect(page.getByRole('heading', { name: 'My settings' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My settings' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: /Sign in with/ }).first()).toBeVisible();
});
