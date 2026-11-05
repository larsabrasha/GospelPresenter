// "Rapportera fel" (docs/bug-reports.md): the picture's menu opens it with the window as it showed and everything that is
// sent shown; the SuperAdmin finds it under Felrapporter with its screenshot and the steps before it, and marks it done.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { adminDialog, closeAdmin, createSong, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a bug report is sent with its screenshot and steps, and the SuperAdmin reads it and marks it done', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Härlig är jorden', [['Verse', 'Ett']]);

  await closeAdmin(page);
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Rapportera fel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rapportera fel' });
  await expect(dialog.getByTestId('report-shot')).toBeVisible(); // the desktop app took the window
  await dialog.getByText('Visa allt som skickas').click();
  const sent = dialog.getByTestId('report-sent');
  await expect(sent).toContainText('"organisation": "Lilla Kyrkan"');
  await expect(sent).toContainText('"kind": "change"');
  await expect(sent).not.toContainText('gpst_'); // no token of any kind
  await dialog.getByLabel('Vad hände?').fill('Sången blev dubbel');
  await dialog.getByRole('button', { name: 'Skicka' }).click();
  await expect(page.getByRole('dialog', { name: 'Tack!' })).toBeVisible();
  await page.getByRole('button', { name: 'Klar' }).click();

  await openAdmin(page, 'Felrapporter');
  await page.getByRole('link', { name: /Sången blev dubbel/ }).click();
  await expect(page.getByTestId('report-detail-shot')).toBeVisible();
  await expect(page.getByText('Lilla Kyrkan', { exact: true })).toBeVisible();
  await expect(page.getByText('Stegen innan')).toBeVisible();
  await expect(page.getByText('Rapportera fel', { exact: true }).first()).toBeVisible(); // the press that opened it
  await page.getByRole('button', { name: 'Markera som klar' }).click();
  await expect(page.getByRole('button', { name: 'Markera som ny' })).toBeVisible();
});

test('the SuperAdmin answers a report, and the one who reported reads the answer under Mina felrapporter and answers back', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  // The SuperAdmin reports themself, so one user is both sides of the thread.
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Rapportera fel' }).click();
  await page.getByRole('dialog', { name: 'Rapportera fel' }).getByLabel('Vad hände?').fill('Bilden hackar');
  await page.getByRole('button', { name: 'Skicka' }).click();
  await page.getByRole('button', { name: 'Klar' }).click();

  await openAdmin(page, 'Felrapporter');
  await page.getByRole('link', { name: /Bilden hackar/ }).click();
  await page.getByLabel('Skriv ett svar').fill('Vilken dator var det?');
  await page.getByRole('button', { name: 'Skicka' }).click();
  const thread = page.getByRole('list', { name: 'Samtal' });
  await expect(thread.getByText('Vilken dator var det?')).toBeVisible();

  // The answer waits unread; the app asks again when it starts.
  await page.reload();
  await expect(adminDialog(page)).toBeVisible(); // the report's page opens again over the start page
  await closeAdmin(page);
  await page.getByTestId('me').click();
  await page.getByRole('menuitem', { name: 'Svar på dina felrapporter (1)' }).click();
  await page.getByRole('link', { name: /Bilden hackar/ }).click();
  await expect(thread.getByText('Vilken dator var det?')).toBeVisible();
  await page.getByLabel('Skriv ett svar').fill('Kyrkans Mac');
  await page.getByRole('button', { name: 'Skicka' }).click();
  await expect(thread.getByText('Kyrkans Mac')).toBeVisible();

  await openAdmin(page, 'Felrapporter');
  await expect(page.getByRole('link', { name: /Bilden hackar/ })).toContainText('1 nya svar');
});
