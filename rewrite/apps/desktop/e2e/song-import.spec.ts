// The ProPresenter import on Sånger (spec 02 "Import card", SONG-R35–R44): `.pro` files chosen or
// dropped become songs with their parts and labels; a file with no text is counted, a duplicate asked
// about. The files are built here (packages/core/test/pro-fixture.ts), as real songs are under copyright.
import { expect, test } from '@playwright/test';
import { pro } from '../../../packages/core/test/pro-fixture.ts';
import { launch, type Desktop } from './apps.ts';
import { dropFiles, openAdmin, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

const file = (name: string, slides: string[]) => ({
  name: `${name}.pro`,
  mimeType: 'application/octet-stream',
  buffer: Buffer.from(pro({ name, groups: [{ id: 'v', name: 'Verse 1', slides: slides.slice(0, 1) }, { id: 'c', name: 'Chorus', slides: slides.slice(1) }] })),
});

test('chosen .pro files become songs with their parts and labels; a file without text is counted', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');

  await page.getByTestId('pro-file').setInputFiles([file('Hos Dig', ['Ett', 'Två']), file('Bara bild', [''])]);

  await expect(page.getByRole('status').filter({ hasText: 'sångtext' })).toHaveText('1 ny, 1 fil saknade sångtext.');
  await page.getByRole('link', { name: 'Hos Dig' }).click();
  await expect(page.getByLabel('Delar 1', { exact: true })).toHaveValue('Ett');
  await expect(page.getByLabel('Delar 2', { exact: true })).toHaveValue('Två');
  await expect(page.getByRole('combobox', { name: 'Etikett' })).toHaveText(['Verse 1', 'Chorus']);
});

test('a name the library has is asked about, and skipped or replaced as answered', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');
  await page.getByTestId('pro-file').setInputFiles([file('Hos Dig', ['Ett', 'Två'])]);
  await expect(page.getByRole('status').filter({ hasText: '1 ny' })).toBeVisible();

  await page.getByTestId('pro-file').setInputFiles([file('hos dig', ['Nytt', 'Två']), file('Annan', ['A', 'B'])]);
  const asked = page.getByRole('dialog', { name: 'Dubbletter hittades' });
  await expect(asked).toContainText('1 av 2 sånger finns redan:');
  await expect(asked.getByRole('listitem')).toHaveText(['hos dig']);
  await asked.getByRole('button', { name: 'Hoppa över dubbletter' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'överhoppad' })).toHaveText('1 ny, 1 överhoppad (fanns redan).');
  await page.getByTestId('pro-file').setInputFiles([file('HOS DIG', ['Nytt', 'Två'])]);
  await page.getByRole('dialog', { name: 'Dubbletter hittades' }).getByRole('button', { name: 'Ersätt dubbletter' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ersatt' })).toHaveText('1 ersatt.');
  await page.getByRole('link', { name: 'Hos Dig' }).click();
  await expect(page.getByLabel('Delar 1', { exact: true })).toHaveValue('Nytt');
});

test('.pro files dropped on the page are imported', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Sånger');

  await dropFiles(page.locator('[data-dropzone]').first(), [file('Släppt', ['Ett', 'Två'])]);

  await expect(page.getByRole('status').filter({ hasText: '1 ny' })).toHaveText('1 ny.');
  await expect(page.getByRole('link', { name: 'Släppt' })).toBeVisible();
});
