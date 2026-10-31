// Historik (spec 02 `/admin/songs/{id}/history`, SONG-R20–R23, D9): a change keeps the song as it was; the
// version shows as slides and is restored, which keeps the song as it was before that too.
import { expect, test } from '@playwright/test';
import { pro } from '../../../packages/core/test/pro-fixture.ts';
import { launch, type Desktop } from './apps.ts';
import { openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('a changed part is kept in the history, shown as slides, and restored', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');
  const song = pro({ name: 'Hos Dig', groups: [{ id: 'v', name: 'Verse', slides: ['Ett'] }, { id: 'c', name: 'Chorus', slides: ['Två'] }] });
  await page.getByTestId('pro-file').setInputFiles([{ name: 'Hos Dig.pro', mimeType: 'application/octet-stream', buffer: Buffer.from(song) }]);
  await expect(page.getByRole('status').filter({ hasText: '1 ny' })).toBeVisible();
  await page.getByRole('link', { name: 'Hos Dig' }).click();

  await page.getByRole('link', { name: 'Historik' }).click();
  await expect(page.getByText('Ingen historik finns för den här sången.')).toBeVisible();
  await page.goBack();
  await page.getByLabel('Delar 1', { exact: true }).fill('Ändrad');
  await page.getByLabel('Delar 1', { exact: true }).blur();
  await expect(page.getByText('Sparad')).toBeVisible();
  await page.getByRole('link', { name: 'Historik' }).click();

  const versions = page.getByRole('list', { name: 'Versioner' });
  const preview = page.getByRole('region', { name: 'Förhandsvisning' });
  await expect(versions.getByRole('listitem')).toHaveCount(1);
  await expect(versions.getByRole('button')).toContainText('Idag');
  await expect(preview).toContainText('Ett');
  await expect(preview).toContainText('Två');
  await expect(preview).toContainText('Verse');
  await preview.getByRole('button', { name: 'Återställ version' }).click();
  await page.getByRole('dialog', { name: 'Återställ version' }).getByRole('button', { name: 'Återställ' }).click();

  await expect(page.getByLabel('Delar 1', { exact: true })).toHaveValue('Ett');
  await page.getByRole('link', { name: 'Historik' }).click();
  await expect(versions.getByRole('listitem')).toHaveCount(2);
  await versions.getByRole('button').first().click();
  await expect(preview).toContainText('Ändrad');
});
