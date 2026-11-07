// The whole app by the keyboard (Lars, 2026-11-05): an item's … menu with its submenus, the pictures of a picture
// item put in order, a slideshow's slide, its elements picked with Tab and moved with the arrows, and the live keys.
import { expect, test } from '@playwright/test';
import { launch, type Desktop } from './apps.ts';
import { addSongs, createPresentation, createSong, nameNew, openAdmin, setUpHost } from './flows.ts';
import { solidPng } from './png.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

test("an item's … menu is used by the keyboard: the arrows, a submenu by → and Escape a step at a time", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);

  const more = page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name: 'Fler val för Sång A' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Fler val för Sång A' });
  await expect(menu.getByRole('menuitem', { name: 'Redigera' })).toBeFocused();
  // Up from the first is the last.
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Radera' })).toBeFocused();

  const addAfter = menu.getByRole('menuitem', { name: 'Lägg till efter…' });
  await addAfter.focus();
  await page.keyboard.press('ArrowRight');
  const sub = page.getByRole('menu', { name: 'Lägg till efter…' });
  await expect(sub.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sub).toHaveCount(0);
  await expect(addAfter).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // A choice by Enter: Kommentar's dialog has the focus in its field.
  await page.keyboard.press('Enter');
  await menu.getByRole('menuitem', { name: 'Kommentar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Kommentar' }).getByLabel('Kommentar')).toBeFocused();
});

test("a picture item's pictures are put in order by Alt+↑ and Alt+↓, the moved one keeping the focus", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bilder');
  await page.getByTestId('image-file').setInputFiles([
    { name: 'Röd.png', mimeType: 'image/png', buffer: solidPng(320, 180, [200, 30, 30]) },
    { name: 'Blå.png', mimeType: 'image/png', buffer: solidPng(320, 180, [30, 30, 200]) },
  ]);
  await expect(page.locator('[data-library-item]')).toHaveCount(2);
  await createPresentation(page, 'Söndag');
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Bild', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Lägg till' });
  await picker.getByRole('button', { name: 'Röd.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Blå.png', exact: true }).click();
  await picker.getByRole('button', { name: 'Lägg till 2 bilder' }).click();
  await picker.getByRole('button', { name: 'Stäng' }).click();
  await page.getByRole('region', { name: '2 bilder' }).getByRole('button', { name: 'Fler val för 2 bilder' }).click();
  await page.getByRole('menuitem', { name: 'Redigera' }).click();

  const pictures = page.getByTestId('image-order').getByRole('listitem');
  const sources = () => pictures.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
  await expect.poll(async () => (await sources()).length).toBe(2);
  const [first, second] = await sources();
  await pictures.first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(sources).toEqual([second, first]);
  await expect(pictures.nth(1)).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(sources).toEqual([first, second]);
  await expect(pictures.first()).toBeFocused();
});

test("a slideshow's elements are picked by Tab on the slide, moved by the arrows as one step for Ångra, and let go by Escape", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Bildspel');
  await page.getByRole('button', { name: 'Nytt bildspel' }).click();
  await nameNew(page, 'Tangenter');
  const canvas = page.getByTestId('slide-canvas');
  for (const kind of ['Text', 'Rektangel']) {
    await page.getByRole('button', { name: 'Lägg till', exact: true }).click();
    await page.getByRole('menuitem', { name: kind, exact: true }).click();
  }
  await canvas.press('Escape'); // the rectangle, just added, is picked
  const handles = page.locator('.moveable-control-box');
  await expect(handles).toHaveCount(0);
  const rect = canvas.locator('[data-element]').last();
  const left = () => rect.evaluate((n) => parseFloat((n as HTMLElement).style.left));
  const before = await left();

  // Tab picks the front one, the rectangle; Shift+→ twice moves it twenty points; ⌘Z puts it back at once.
  await canvas.focus();
  await page.keyboard.press('Tab');
  await expect(handles).toHaveCount(1);
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(left).toBe(before + 20);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(left).toBe(before);

  // Tab again picks the text, and past it leaves the slide with nothing picked.
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(canvas).not.toBeFocused();
  await expect(handles).toHaveCount(0);

  await canvas.focus();
  await page.keyboard.press('Tab');
  await expect(handles).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(handles).toHaveCount(0);
  await expect(canvas).toBeVisible();
});

test("a theme's texts are picked by Tab on its slide, the main text and then the credits, and moved by the arrows", async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Teman');
  await page.getByRole('button', { name: 'Nytt tema' }).click();
  await nameNew(page, 'Tangenter');
  const canvas = page.getByTestId('theme-canvas');
  const text = canvas.locator('.slide-content');
  const top = async () => (await text.boundingBox())!.y;

  await canvas.focus();
  await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-picked', 'main');
  const before = await top();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(top).toBeLessThan(before);
  await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-picked', 'credits');
  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveAttribute('data-picked');
  await expect(canvas).toBeFocused();
});

test('while presenting ↵ shows the slide outlined in blue, which → ← ↑ ↓ and a number move, the clicker’s keys step at once, and Escape lets the outline go', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [
    ['Verse 1', 'A ett'],
    ['Verse 2', 'A två'],
  ]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createSong(page, 'Sång C', [['Verse 1', 'C ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A', 'Sång B', 'Sång C']);
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  const [output] = await Promise.all([host.app.waitForEvent('window'), page.getByRole('checkbox', { name: 'Utgångsfönster' }).check()]);
  await output.getByTestId('output').waitFor();
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await expect(output.getByTestId('slide-text')).toHaveText('A ett');
  const row = (name: string) => page.getByRole('list', { name: 'Programpunkter' }).getByRole('button', { name, exact: true });
  const shown = output.getByTestId('slide-text');
  const cue = page.getByTestId('live-cue');

  // ↵ shows the slide after, outlined in blue, and the outline goes on: into the next item too (Lars, 2026-11-07).
  await expect(page.getByRole('button', { name: 'Sång A 2' })).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('A två');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('B ett');
  // A clicker's keys step what is shown at once.
  await page.keyboard.press('PageUp');
  await expect(shown).toHaveText('A två');
  await page.keyboard.press(' ');
  await expect(shown).toHaveText('B ett');

  // ↑ marks Sång A, its first slide outlined and said over the picture; → moves the outline; nothing shows until ↵.
  await page.keyboard.press('ArrowUp');
  await expect(row('Sång A')).toHaveAttribute('aria-pressed', 'true');
  await expect(cue).toHaveText('Bild 1 i Sång A – Enter visar');
  await page.keyboard.press('ArrowRight');
  await expect(cue).toHaveText('Bild 2 i Sång A – Enter visar');
  await expect(shown).toHaveText('B ett');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('A två');
  await expect(cue).toHaveCount(0);

  // Escape lets an outline go: the mark back on what is shown, nothing new shown.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(row('Sång C')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(cue).toHaveCount(0);
  await expect(row('Sång A')).toHaveAttribute('aria-pressed', 'true');
  await expect(shown).toHaveText('A två');

  // A number outlines that slide of the item marked, and ↵ shows it; a slide it does not have is said, and shows nothing.
  await page.keyboard.press('1');
  await expect(cue).toHaveText('Bild 1 i Sång A – Enter visar');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('A ett');
  await page.keyboard.press('9');
  await expect(cue).toHaveText('Sång A har ingen bild 9');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('A ett');

  // A slide clicked keeps the focus, and ↵ there is still the outline's.
  await page.getByRole('button', { name: 'Sång A 1' }).click();
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('A två');
});

test('the app\'s keys: g and a letter go to a section, / searches it, the arrows walk its list, Delete asks, n adds, and F5 presents', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Sång A', [['Verse 1', 'A ett']]);
  await createSong(page, 'Sång B', [['Verse 1', 'B ett']]);
  await createPresentation(page, 'Söndag');
  await addSongs(page, ['Sång A']);
  await page.locator('body').click({ position: { x: 1, y: 1 } }); // the focus out of any field

  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/admin\/songs$/);
  const songs = page.locator('[data-library-item]');
  await expect(songs).toHaveCount(2); // Inställningar drawn, Sånger in it
  await page.keyboard.press('/');
  const search = page.locator('input[type="search"]').last();
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(songs.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(songs.nth(1)).toBeFocused();
  await page.keyboard.press('Delete');
  const asked = page.getByRole('dialog', { name: 'Radera' });
  await expect(asked).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(asked).toHaveCount(0);
  await expect(songs).toHaveCount(2);

  // n is the list's +: a new song, its name picked to type over.
  await songs.nth(1).blur();
  await page.keyboard.press('n');
  await nameNew(page, 'Sång C');
  await expect(page.getByRole('heading', { name: 'Sång C', exact: true })).toBeVisible();

  // Back to the presentation, and F5 presents it.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await page.getByRole('link', { name: 'Söndag' }).click();
  await expect(page.getByRole('button', { name: 'Starta presentation' })).toBeVisible();
  await page.keyboard.press('F5');
  await expect(page.getByTestId('live-panel')).toBeVisible();
});

test('⌘K searches everything: a song is added to the presentation open, opened elsewhere, and finds commands and Inställningar', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);
  await createPresentation(page, 'Söndag');
  const search = page.getByRole('dialog', { name: 'Sök i allt' });
  const field = search.getByRole('searchbox', { name: 'Sök i allt' });

  // In the presentation ⌘↵ adds the marked song, as Lägg till does, and picks it; its words show beside the list.
  await page.keyboard.press('ControlOrMeta+k');
  await field.fill('härlig');
  await expect(search.getByRole('option', { selected: true })).toContainText('Härlig är jorden');
  await expect(search.getByTestId('palette-preview')).toContainText('Härlig är jorden');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(search).toHaveCount(0);
  const order = page.getByRole('list', { name: 'Programpunkter' }).getByRole('listitem');
  await expect(order).toHaveText([/Härlig är jorden/]);

  // While presenting, it is shown at once: the quickest way to a song asked for.
  await page.getByRole('button', { name: 'Starta presentation' }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await field.fill('härlig');
  await expect(search.getByRole('option', { selected: true })).toContainText('Lägg till och visa');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(order).toHaveCount(2);
  await expect(order.nth(1).getByTestId('live-dot')).toBeVisible();

  // The bar's magnifier opens it too, as a phone, which has no ⌘K, needs; a command is found by its words.
  await page.getByRole('button', { name: 'Sök i allt' }).click();
  await field.fill('gå till');
  await expect(search.getByRole('group', { name: 'Kommandon' })).toBeVisible();
  await field.fill('teman');
  await expect(search.getByRole('group', { name: 'Inställningar' }).getByRole('option', { name: /Teman/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/themes$/);

  // Over Inställningar a song is opened, not added.
  await page.keyboard.press('ControlOrMeta+k');
  await field.fill('härlig');
  await expect(search.getByRole('option', { selected: true })).toContainText('Öppna');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/songs\/[^/]+$/);
});
