// Etiketter (spec 02 `/admin/labels`, SONG-R45–R47, SONG-A27–A31): the default labels are there from the
// start; a label is created, renamed in its sheet, moved under Välj, deleted together there, and the song editor follows.
import { expect, test } from '@playwright/test';
import { pro } from '../../../packages/core/test/pro-fixture.ts';
import { launch, type Desktop } from './apps.ts';
import { openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('the default labels are listed in order; a label is created with Shift+Enter and Ctrl+Enter, and a taken text is refused', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Etiketter');
  const list = page.getByRole('list', { name: 'Etiketter' });
  await expect(list.getByRole('listitem')).toHaveCount(25);
  await expect(list.getByRole('listitem').first()).toHaveAccessibleName('Verse');
  await expect(list.getByRole('listitem').last()).toHaveAccessibleName('Blank');

  await page.getByRole('button', { name: 'Skapa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ny etikett' });
  await dialog.getByLabel('Etiketttext').fill('Coda');
  await dialog.getByLabel('Etiketttext').press('Shift+Enter');
  await expect(dialog.getByLabel('Etiketttext')).toHaveValue('');
  await expect(dialog.getByLabel('Etiketttext')).toBeFocused();
  await dialog.getByLabel('Etiketttext').fill(' chorus ');
  await expect(dialog).toContainText('Det finns redan en etikett med den texten.');
  await expect(dialog.getByRole('button', { name: 'Skapa' })).toBeDisabled();
  await dialog.getByLabel('Etiketttext').fill('Slut');
  await dialog.getByRole('radio', { name: '#16a34a' }).click();
  await dialog.getByLabel('Etiketttext').press('Control+Enter');

  await expect(dialog).toBeHidden();
  await expect(list.getByRole('listitem').nth(25)).toHaveAccessibleName('Coda');
  await expect(list.getByRole('listitem').last()).toHaveAccessibleName('Slut');
  await page.getByRole('button', { name: 'Redigera Slut', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Redigera etikett' }).getByRole('radio', { name: '#16a34a' })).toHaveAttribute('aria-checked', 'true');
});

test('a renamed label shows in the song, a moved one comes first, and the ones deleted together under Välj leave the part unlabelled', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');
  const song = pro({ name: 'Hos Dig', groups: [{ id: 'v', name: 'Verse', slides: ['Ett'] }, { id: 'b', name: 'Bridge', slides: ['Två'] }] });
  await page.getByTestId('pro-file').setInputFiles([{ name: 'Hos Dig.pro', mimeType: 'application/octet-stream', buffer: Buffer.from(song) }]);
  await expect(page.getByRole('status').filter({ hasText: '1 ny' })).toBeVisible();

  await openAdmin(page, 'Etiketter');
  const list = page.getByRole('list', { name: 'Etiketter' });
  await page.getByRole('button', { name: 'Redigera Verse', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Redigera etikett' });
  await dialog.getByLabel('Etiketttext').fill('Vers');
  await dialog.getByRole('button', { name: 'Spara' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Välj', exact: true }).click();
  await list.getByRole('listitem', { name: 'Chorus', exact: true }).getByRole('checkbox').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem').nth(6)).toHaveAccessibleName('Chorus');
  await list.getByRole('listitem', { name: 'Bridge', exact: true }).getByRole('checkbox').click();
  await list.getByRole('listitem', { name: 'Blank', exact: true }).getByRole('checkbox').click();
  const bar = page.getByRole('toolbar', { name: 'Markerade' });
  await expect(bar).toContainText('2 markerade');
  await bar.getByRole('button', { name: 'Radera' }).click();
  const confirm = page.getByRole('dialog', { name: 'Radera' });
  await expect(confirm).toContainText('Vill du ta bort 2 etiketter?');
  await confirm.getByRole('button', { name: 'Radera' }).click();
  await expect(list.getByRole('listitem', { name: 'Bridge', exact: true })).toHaveCount(0);
  await expect(list.getByRole('listitem', { name: 'Blank', exact: true })).toHaveCount(0);
  await expect(bar).toHaveCount(0);

  await openAdmin(page, 'Sånger');
  await page.getByRole('link', { name: 'Hos Dig' }).click();
  await expect(page.getByRole('combobox', { name: 'Etikett' })).toHaveText(['Vers', 'Välj...']);
});
