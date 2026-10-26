// Milestone 2: songs and presentations as spec 02 and 03 describe them, and
// the output window when the operator's database has no shared file.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('without OPFS the output still shows the slide, read through the operator window', async () => {
  host = await launch({ memory: true });
  const page = host.page;
  await setUpHost(host);
  await expect(page.getByTestId('status')).toContainText('Data sparas bara i minnet');
  await createSong(page, 'Blott en dag', [
    ['Verse 1', 'Blott en dag'],
    ['Chorus', 'Ett ögonblick i sänder'],
  ]);
  await createPresentation(page, 'Kväll');
  await addSongs(page, ['Blott en dag']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Blott en dag 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Ett ögonblick i sänder');

  // An edit in the operator's in-memory database reaches the output too (D7).
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByRole('link', { name: 'Blott en dag' }).click();
  await page.getByLabel('Delar 2', { exact: true }).fill('Varje dag och varje stund');
  await page.getByLabel('Delar 2', { exact: true }).blur();
  await expect(output.getByTestId('slide-text')).toHaveText('Varje dag och varje stund');
});

test('arrangements: made in the song, chosen per item, and shown live in their order', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Pilgrimsfärd', [
    ['Verse 1', 'Härlig är jorden'],
    ['Chorus', 'Pilgrimsfärd'],
    ['Verse 2', 'Tidevarv komma'],
  ]);

  // SONG-A9: the first arrangement holds every part once, in order, and has no name field.
  await page.getByRole('button', { name: 'Skapa arrangemang' }).click();
  const first = page.getByRole('group', { name: 'Arrangemang 1' });
  await expect(first.getByRole('list', { name: 'Delar i arrangemanget' }).getByRole('listitem')).toHaveText([/Verse 1/, /Chorus/, /Verse 2/]);
  await expect(first.getByLabel('Namn')).toHaveCount(0);

  // A second one gets names (SONG-A11); edit it to Chorus, Verse 1, Chorus (SONG-A10).
  await page.getByRole('button', { name: 'Skapa arrangemang' }).click();
  const second = page.getByRole('group', { name: 'Arrangemang 2' });
  await second.getByLabel('Namn').fill('Kort');
  await second.getByLabel('Namn').blur();
  const kort = page.getByRole('group', { name: 'Kort' });
  await kort.getByRole('button', { name: 'Ta bort Verse 2 ur arrangemanget' }).click();
  await kort.getByRole('combobox', { name: 'Lägg till del' }).selectOption({ label: '2. Chorus' });
  await kort.getByRole('button', { name: 'Flytta ned Verse 1' }).click();
  const kortChips = kort.getByRole('list', { name: 'Delar i arrangemanget' }).getByRole('listitem');
  await expect(kortChips).toHaveText([/Chorus/, /Verse 1/, /Chorus/]);

  await createSong(page, 'Blott en dag', [['Verse 1', 'Blott en dag']]);

  // A dated presentation; the songs go in through the picker, Kort chosen for the first.
  await createPresentation(page, 'Gudstjänst', '2026-11-01');
  await expect(page.getByTestId('schedule')).toContainText('1 nov');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  const search = picker.getByLabel('Sök på titel, författare eller textrad');
  await search.fill('pilgrim');
  await picker.getByRole('button', { name: 'Kort' }).click();
  await expect(picker.getByRole('list', { name: 'Pilgrimsfärd' }).getByRole('listitem')).toHaveCount(3);
  await search.press('Shift+Enter'); // D15: adds, stays open, starts over
  await expect(page.getByRole('status').getByText('"Pilgrimsfärd" har lagts till')).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('blott');
  await search.press('Control+Enter');
  await expect(page.getByRole('status').getByText('"Blott en dag" har lagts till')).toBeVisible();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  const order = page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem');
  await expect(order).toHaveText([/Pilgrimsfärd/, /Blott en dag/]);

  // Reorder, then look at the first item: Kort, three slides; the default arrangement shows its own order.
  await page.getByRole('button', { name: 'Flytta upp Blott en dag' }).click();
  await expect(order).toHaveText([/Blott en dag/, /Pilgrimsfärd/]);
  await page.getByRole('button', { name: 'Pilgrimsfärd', exact: true }).click();
  const tiles = page.getByRole('list', { name: 'Pilgrimsfärd' }).getByTestId('slide-text');
  await expect(tiles).toHaveText(['Pilgrimsfärd', 'Härlig är jorden', 'Pilgrimsfärd']);
  await page.getByRole('button', { name: 'Arrangemang', exact: true }).click();
  await expect(tiles).toHaveText(['Härlig är jorden', 'Pilgrimsfärd', 'Tidevarv komma']);
  await page.getByRole('button', { name: 'Kort', exact: true }).click();
  await expect(tiles).toHaveText(['Pilgrimsfärd', 'Härlig är jorden', 'Pilgrimsfärd']);

  // PRES-A18: F2 renames the selected item; the song keeps its name.
  await page.keyboard.press('F2');
  await page.getByLabel('Byt namn på programpunkten').fill('Inledning');
  await page.getByLabel('Byt namn på programpunkten').press('Enter');
  await expect(order).toHaveText([/Blott en dag/, /Inledning/]);

  // The event date changes after create.
  await page.getByRole('button', { name: 'Redigera detaljer' }).click();
  await page.getByRole('dialog', { name: 'Redigera detaljer' }).getByLabel('Datum').fill('2026-11-08');
  await page.getByRole('dialog', { name: 'Redigera detaljer' }).getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByTestId('schedule')).toContainText('8 nov');

  // Live, the item shows Kort's order on the output.
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('button', { name: 'Extern skärm' }).click()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Inledning 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Pilgrimsfärd');
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toHaveText('Härlig är jorden');
  await page.keyboard.press('ArrowRight');
  await expect(output.getByTestId('slide-text')).toHaveText('Pilgrimsfärd');
});

test('trash: a song in use is flagged and restored from the presentation; presentations and songs restore and purge', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Amazing Grace', [['Verse 1', 'Amazing grace, how sweet the sound']]);
  await createPresentation(page, 'Kväll');
  await addSongs(page, ['Amazing Grace']);

  // D17: trashing a song in use says where it is used.
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByRole('link', { name: 'Amazing Grace' }).click();
  await page.getByRole('button', { name: 'Ta bort sång' }).click();
  const confirm = page.getByRole('dialog', { name: 'Ta bort sång' });
  await expect(confirm).toContainText('Sången raderas permanent efter 30 dagar. Sången används i: Kväll.');
  await confirm.getByRole('button', { name: 'Ta bort sång' }).click();
  await expect(page.getByRole('status').getByText('Amazing Grace flyttad till papperskorgen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alla sånger (0)' })).toBeVisible();

  // The presentation flags the item and restores the song (D17).
  await page.getByRole('link', { name: 'Presentationer' }).click();
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: /^Amazing Grace/ }).click();
  await expect(page.getByText('Sången ligger i papperskorgen och visas inte live.')).toBeVisible();
  await page.getByRole('button', { name: 'Återställ' }).click();
  await expect(page.getByText('Sången ligger i papperskorgen och visas inte live.')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Amazing Grace' }).getByTestId('slide-text')).toHaveText(['Amazing grace, how sweet the sound']);

  // Trash the song again, and the presentation (no dialog, a toast: PRES-A22).
  await page.getByRole('link', { name: 'Sånger' }).click();
  await page.getByRole('link', { name: 'Amazing Grace' }).click();
  await page.getByRole('button', { name: 'Ta bort sång' }).click();
  await page.getByRole('dialog', { name: 'Ta bort sång' }).getByRole('button', { name: 'Ta bort sång' }).click();
  await page.getByRole('link', { name: 'Presentationer' }).click();
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: 'Radera presentation' }).click();
  await expect(page.getByRole('status').getByText('Kväll flyttad till papperskorgen')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kväll' })).toHaveCount(0);

  // The trash, opened for presentations: one of two, with 30 days left.
  await page.getByRole('link', { name: 'Papperskorg' }).click();
  const rows = page.getByRole('list', { name: 'Papperskorg' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('trash-count')).toHaveText('1 sak av 2');
  await expect(rows.first()).toContainText('Presentation · 30 dagar kvar');
  await page.getByRole('button', { name: 'Allt' }).click();
  await expect(page.getByTestId('trash-count')).toHaveText('2 saker');

  // Restore the presentation; purge the song for good.
  await page.getByRole('listitem', { name: 'Kväll' }).getByRole('button', { name: 'Återställ' }).click();
  await expect(page.getByRole('status').getByText('Kväll återställd')).toBeVisible();
  await page.getByRole('button', { name: 'Radera permanent Amazing Grace' }).click();
  const purge = page.getByRole('dialog', { name: 'Radera permanent' });
  await expect(purge).toContainText('Vill du ta bort Amazing Grace permanent?');
  await purge.getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByText('Papperskorgen är tom.')).toBeVisible();

  // The presentation is back, and its item says the song is gone.
  await page.getByRole('link', { name: 'Presentationer' }).click();
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: /^Amazing Grace/ }).click();
  await expect(page.getByText('Sången finns inte längre.')).toBeVisible();
});
