// Milestone 2: songs and presentations as spec 02 and 03 describe them, and
// the output window when the operator's database has no shared file.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, dragTo, openAdmin, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;

test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test('without OPFS the output still shows the slide, read through the operator window', async () => {
  host = await launch({ memory: true });
  const page = host.page;
  await setUpHost(host);
  await expect(page.getByTestId('sync-warnings')).toContainText('Data sparas bara i minnet');
  await createSong(page, 'Blott en dag', [
    ['Verse 1', 'Blott en dag'],
    ['Chorus', 'Ett ögonblick i sänder'],
  ]);
  await createPresentation(page, 'Kväll');
  await addSongs(page, ['Blott en dag']);
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Blott en dag 2' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('Ett ögonblick i sänder');

  // An edit in the operator's in-memory database reaches the output too (D7).
  await openAdmin(page, 'Sånger');
  await page.getByRole('link', { name: 'Blott en dag' }).click();
  await page.getByLabel('Delar 2', { exact: true }).fill('Varje dag och varje stund');
  await page.getByLabel('Delar 2', { exact: true }).blur();
  await expect(output.getByTestId('slide-text')).toHaveText('Varje dag och varje stund');
});

test('the label and Lägg till del menus work from the keyboard alone', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Tangenter', [
    ['Verse 1', 'Ett'],
    ['Chorus', 'Två'],
  ]);
  const picker = page.getByRole('combobox', { name: 'Etikett' }).first();
  const list = page.getByRole('listbox', { name: 'Etikett' });

  // ↓ opens on the chosen label, which the button names as active; focus stays on the button.
  await picker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'true');
  const verse = list.getByRole('option', { name: 'Verse 1', exact: true });
  await expect(verse).toHaveAttribute('aria-selected', 'true');
  await expect(picker).toHaveAttribute('aria-activedescendant', (await verse.getAttribute('id'))!);
  await expect(picker).toBeFocused();

  // Escape closes it, changes nothing, and leaves focus on the button.
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await expect(picker).toBeFocused();
  await expect(picker).toHaveText('Verse 1');

  // Enter opens; Home and ↓ move; Enter picks the one moved to.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  const second = list.getByRole('option').nth(1);
  await expect(picker).toHaveAttribute('aria-activedescendant', (await second.getAttribute('id'))!);
  const picked = (await second.getAttribute('aria-label'))!;
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(picker).toHaveText(picked);
  await expect(picker).toBeFocused();

  // Space opens too; Home and Enter take the first, no label.
  await page.keyboard.press(' ');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveText('Välj...');

  // Lägg till del, the same way: End is the last part, appended to the arrangement.
  await page.getByRole('button', { name: 'Skapa arrangemang' }).click();
  const arrangement = page.getByRole('group', { name: 'Arrangemang 1' });
  const add = arrangement.getByRole('combobox', { name: 'Lägg till del' });
  await add.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(arrangement.getByRole('list', { name: 'Delar i arrangemanget' }).getByRole('listitem')).toHaveText([/Ett/, /Chorus/, /Chorus/]);
  await expect(add).toBeFocused();
});

test('the song saves 500 ms after typing, says "Sparad", and keeps what was typed when left at once', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sparas', [['Verse 1', 'Ett']]);
  const saved = page.getByTestId('saved');
  await expect(saved).toHaveCount(0); // gone 2.3 s after the last save of creating the song
  const author = page.getByLabel('Upphovspersoner');

  // Typing, then a pause with focus still in the field: saved, and the header says so before it fades.
  await author.pressSequentially('Lina ');
  await expect(saved).toHaveText('Sparad');
  await expect(author).toBeFocused();
  // The stored value is trimmed ("Lina"), but the field keeps the space and the cursor, so typing goes on.
  await author.pressSequentially('Sandell');
  await expect(author).toHaveValue('Lina Sandell');
  await expect(saved).toHaveCount(0, { timeout: 5000 });
  await page.reload();
  await expect(page.getByLabel('Upphovspersoner')).toHaveValue('Lina Sandell');

  // A part typed in and left at once, by the back button: nothing lost.
  const part = page.getByLabel('Delar 1', { exact: true });
  await part.focus();
  await part.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(e.value.length, e.value.length));
  await page.keyboard.type(', två, tre');
  await page.getByRole('link', { name: 'Tillbaka' }).click();
  await page.getByRole('link', { name: 'Sparas' }).click();
  await expect(page.getByLabel('Delar 1', { exact: true })).toHaveValue('Ett, två, tre');

  // A blank name is not saved, and not called saved.
  const name = page.getByLabel('Namn', { exact: true });
  await expect(saved).toHaveCount(0, { timeout: 5000 });
  await name.fill('');
  await page.waitForTimeout(700);
  await expect(saved).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sparas', exact: true })).toBeVisible();
  await name.fill('Sparad sång');
  await expect(page.getByRole('heading', { name: 'Sparad sång', exact: true })).toBeVisible();

  // A reload at once, before the 500 ms are up and with focus still in the field: written as the page goes.
  await page.getByLabel('CCLI').pressSequentially('12345');
  await page.reload();
  await expect(page.getByLabel('CCLI')).toHaveValue('12345');
});

test('a blank name or a year out of range is not saved, and the field shows the stored value again when left', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Behålls', [['Verse 1', 'Ett']]);
  const name = page.getByLabel('Namn', { exact: true });
  const year = page.getByLabel('År');
  await year.fill('1998');
  await year.blur();

  await name.fill('');
  await name.blur();
  await year.fill('12345');
  await year.blur();

  await expect(name).toHaveValue('Behålls');
  await expect(year).toHaveValue('1998');
});

test('a refused save says "Kunde inte spara", not "Sparad", and the field keeps what was typed', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Avvisas', [['Verse 1', 'Ett']]);
  const saved = page.getByTestId('saved');
  await expect(saved).toHaveCount(0); // gone 2.3 s after the last save of creating the song
  const ccli = page.getByLabel('CCLI');

  // A CCLI number is at most 20 characters; the field takes more, and the write is refused.
  await ccli.fill('1'.repeat(21));
  await ccli.blur();

  const failed = page.getByRole('alert').getByText('Kunde inte spara');
  await expect(failed).toBeVisible();
  // Checked once, not retried: a "Sparad" from the same save would still show (it stays 2.3 s).
  expect(await saved.count()).toBe(0);
  await expect(ccli).toHaveValue('1'.repeat(21));

  // The same text again, after a letter typed and taken back: tried again, and refused again.
  await expect(failed).toHaveCount(0, { timeout: 6000 });
  await ccli.press('End');
  await ccli.press('2');
  await ccli.press('Backspace');
  await ccli.blur();
  await expect(failed).toBeVisible();

  // Refused once more while the warning shows: still one warning, not two.
  await ccli.press('3');
  await ccli.blur();
  await page.waitForTimeout(300);
  expect(await failed.count()).toBe(1);
  await page.reload();
  await expect(page.getByLabel('CCLI')).toHaveValue('');
});

test('a refused rename of an item or of a presentation says "Kunde inte spara"', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  const order = page.getByRole('list', { name: 'Programpunkter' });
  await order.getByRole('button', { name: 'Sång A', exact: true }).click();
  const failed = page.getByRole('alert').getByText('Kunde inte spara');
  const tooLong = 'x'.repeat(201);

  // A name is at most 200 characters; without the field's own limit, the write is refused.
  await page.keyboard.press('F2');
  const title = page.getByLabel('Byt namn på programpunkten');
  await title.evaluate((el) => el.removeAttribute('maxlength'));
  await title.fill(tooLong);
  await title.press('Enter');
  await expect(failed).toBeVisible();
  await expect(order.getByRole('button', { name: 'Sång A', exact: true })).toBeVisible();

  await expect(failed).toHaveCount(0, { timeout: 6000 });
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Redigera detaljer' }).click();
  const details = page.getByRole('dialog', { name: 'Redigera detaljer' });
  const name = details.getByLabel('Namn');
  await name.evaluate((el) => el.removeAttribute('maxlength'));
  await name.fill(tooLong);
  await details.getByRole('button', { name: 'Spara' }).click();
  await expect(failed).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Söndag' })).toBeVisible();
});

test('a refused create says "Kunde inte spara", and the dialog stays to try again', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openPresentations(page);
  await page.getByRole('button', { name: 'Skapa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skapa presentation' });
  const name = dialog.getByLabel('Namn');

  // A name is at most 200 characters; without the field's own limit, the write is refused.
  await name.evaluate((el) => el.removeAttribute('maxlength'));
  await name.fill('x'.repeat(201));
  await name.press('Enter');
  await expect(page.getByRole('alert').getByText('Kunde inte spara')).toBeVisible();
  await expect(dialog).toBeVisible();

  await name.fill('Söndag');
  await name.press('Enter');
  await expect(dialog).toHaveCount(0);
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
  await kort.getByRole('combobox', { name: 'Lägg till del' }).click();
  await kort.getByRole('option', { name: '2. Chorus', exact: true }).click();
  const kortChips = kort.getByRole('list', { name: 'Delar i arrangemanget' }).getByRole('listitem');
  await expect(kortChips).toHaveText([/Verse 1/, /Chorus/, /Chorus/]);
  // The chip is dragged, as in the current app: Verse 1 below the first Chorus.
  await dragTo(page, kortChips.nth(0), kortChips.nth(1), 'below');
  await expect(kortChips).toHaveText([/Chorus/, /Verse 1/, /Chorus/]);
  // From the keyboard, Alt+↑/↓ moves the focused chip, and focus stays on it.
  await kortChips.nth(1).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(kortChips).toHaveText([/Chorus/, /Chorus/, /Verse 1/]);
  await expect(kortChips.nth(2)).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(kortChips).toHaveText([/Chorus/, /Verse 1/, /Chorus/]);
  await expect(kortChips.nth(1)).toBeFocused();

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

  // Reorder by the drag handle, then by Alt+↑/↓ on the selected item; the order is saved either way.
  await dragTo(page, order.nth(1).getByTestId('drag-handle'), order.nth(0), 'above');
  await expect(order).toHaveText([/Blott en dag/, /Pilgrimsfärd/]);
  await page.getByRole('button', { name: 'Pilgrimsfärd', exact: true }).click();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(order).toHaveText([/Pilgrimsfärd/, /Blott en dag/]);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(order).toHaveText([/Blott en dag/, /Pilgrimsfärd/]);
  await page.reload();
  await expect(order).toHaveText([/Blott en dag/, /Pilgrimsfärd/]);

  // Look at the first item: Kort, three slides; the default arrangement shows its own order.
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
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Redigera detaljer' }).click();
  await page.getByRole('dialog', { name: 'Redigera detaljer' }).getByLabel('Datum').fill('2026-11-08');
  await page.getByRole('dialog', { name: 'Redigera detaljer' }).getByRole('button', { name: 'Spara' }).click();
  await expect(page.getByTestId('schedule')).toContainText('8 nov');

  // Live, the item shows Kort's order on the output.
  await page.getByRole('link', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Extern skärm' }).check()]);
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
  await openAdmin(page, 'Sånger');
  await page.getByRole('link', { name: 'Amazing Grace' }).click();
  await page.getByRole('button', { name: 'Ta bort sång' }).click();
  const confirm = page.getByRole('dialog', { name: 'Ta bort sång' });
  await expect(confirm).toContainText('Sången raderas permanent efter 30 dagar. Sången används i: Kväll.');
  await confirm.getByRole('button', { name: 'Ta bort sång' }).click();
  await expect(page.getByRole('status').getByText('Amazing Grace flyttad till papperskorgen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alla sånger (0)' })).toBeVisible();

  // The presentation flags the item and restores the song (D17).
  await openPresentations(page);
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: /^Amazing Grace/ }).click();
  await expect(page.getByText('Sången ligger i papperskorgen och visas inte live.')).toBeVisible();
  await page.getByRole('button', { name: 'Återställ' }).click();
  await expect(page.getByText('Sången ligger i papperskorgen och visas inte live.')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Amazing Grace' }).getByTestId('slide-text')).toHaveText(['Amazing grace, how sweet the sound']);

  // Trash the song again, and the presentation (no dialog, a toast: PRES-A22).
  await openAdmin(page, 'Sånger');
  await page.getByRole('link', { name: 'Amazing Grace' }).click();
  await page.getByRole('button', { name: 'Ta bort sång' }).click();
  await page.getByRole('dialog', { name: 'Ta bort sång' }).getByRole('button', { name: 'Ta bort sång' }).click();
  await openPresentations(page);
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: 'Alternativ' }).click();
  await page.getByRole('menuitem', { name: 'Radera presentation' }).click();
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
  await openPresentations(page);
  await page.getByRole('link', { name: 'Kväll' }).click();
  await page.getByRole('button', { name: /^Amazing Grace/ }).click();
  await expect(page.getByText('Sången finns inte längre.')).toBeVisible();

  // The selected item's ⋯ menu removes it, after asking (Sidebar.razor).
  await page.getByRole('button', { name: 'Fler val för Amazing Grace' }).click();
  await page.getByRole('menuitem', { name: 'Ta bort' }).click();
  await page.getByRole('dialog', { name: 'Radera' }).getByRole('button', { name: 'Radera' }).click();
  await expect(page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem')).toHaveCount(0);
});
