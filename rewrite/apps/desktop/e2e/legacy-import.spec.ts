// Importera (docs/import-from-1x.md): an admin picks an export zip under Organisationen, of version 1 or of this app's
// Exportera, sees what it holds and imports it; its songs, presentations, Bibles, videos and users are there after,
// beside what was there.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { bibleTextHash, LEGACY_ENTRIES, LEGACY_TABLES, makeZip, serializeBibleText, utf8Encode } from '@gp/core';
import { launch, type Desktop } from './apps.ts';
import { ANNA, closeAdmin, createSong, openAdmin, openPresentations, setUpHost } from './flows.ts';

let host: Desktop | undefined;
test.afterEach(async () => {
  await host?.app.close();
  host = undefined;
});

async function exportZip(): Promise<Buffer> {
  const text = serializeBibleText([{ code: 'JHN', verses: [[3, 16, 'Ty så älskade Gud världen']] }]);
  const hash = await bibleTextHash(text);
  const rows: Record<string, unknown[]> = Object.fromEntries(LEGACY_TABLES.map((t) => [t, []]));
  rows.songs = [{ id: 'song-1', name: 'Bred dina vida vingar', author: 'Lina Sandell', publisher: null, year: null, ccli: null, deleted_at: null }];
  rows.song_parts = [{ id: 'p-1', song_id: 'song-1', sort: 0, label_id: null, content: 'Bred dina vida vingar' }];
  rows.presentations = [
    { id: 'pres-1', name: 'Gudstjänst i oktober', event_date: '2026-10-04', deleted_at: null, theme_id: null, is_template: 0, weekday: null, time: '11:00', location: null, last_used_at: null, description: null, updated_at: 1 },
  ];
  rows.presentation_items = [{ id: 'it-1', presentation_id: 'pres-1', type: 'song', title: 'Bred dina vida vingar', source_id: 'song-1', sort: 0, arrangement_id: null, content: null, overlay_id: null }];
  rows.bibles = [{ id: 'bible:sv1917', name: 'Svenska 1917', abbreviation: 'SV1917', language: null, verse_count: 1, content_hash: hash }];
  const users = [
    { name: 'Anna', email: ANNA.email, role: 'admin', google: [ANNA.sub] },
    { name: 'Bo Berg', email: 'bo@kyrkan.se', role: 'user', google: [] },
  ];
  const manifest = { format: 1, orgName: 'Gamla kyrkan', exportedAt: 1, counts: { songs: 1, presentations: 1, users: 2, blobs: 0 } };
  const json = (v: unknown) => utf8Encode(JSON.stringify(v));
  return Buffer.from(
    makeZip([
      { name: LEGACY_ENTRIES.manifest, data: json(manifest) },
      { name: LEGACY_ENTRIES.users, data: json(users) },
      ...LEGACY_TABLES.map((t) => ({ name: LEGACY_ENTRIES.rows(t), data: json(rows[t]) })),
      { name: LEGACY_ENTRIES.bible(hash), data: utf8Encode(text) },
    ]),
  );
}

test('an export from version 1 is imported into an empty organisation', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Organisationen');

  await page.getByTestId('legacy-zip').setInputFiles({ name: 'gamla-kyrkan.zip', mimeType: 'application/zip', buffer: await exportZip() });
  await expect(page.getByText('Gamla kyrkan: 1 sånger, 1 presentationer och mallar, 2 användare och 0 filer.')).toBeVisible();
  await page.getByRole('button', { name: 'Importera', exact: true }).click();

  await expect(page.getByText('Klart. Gamla kyrkan är importerad.')).toBeVisible();
  // Anna's import makes and links the accounts only in superadminläge; without it the users are invited.
  await expect(page.getByText('1 inbjudna, 0 nya användare, 0 som redan fanns på servern.')).toBeVisible();
  await openAdmin(page, 'Sånger');
  await expect(page.getByText('Bred dina vida vingar')).toBeVisible();
  await openAdmin(page, 'Biblar');
  await expect(page.getByText('Svenska 1917')).toBeVisible();
  await openAdmin(page, 'Användare');
  await expect(page.getByRole('list', { name: 'Inbjudna' })).toContainText('bo@kyrkan.se');
  await closeAdmin(page);
  await openPresentations(page);
  await expect(page.getByText('Gudstjänst i oktober')).toBeVisible();
});

test('an export is imported into an organisation that has songs, keeping them', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'En sång', []);
  await openAdmin(page, 'Organisationen');

  await page.getByTestId('legacy-zip').setInputFiles({ name: 'gamla-kyrkan.zip', mimeType: 'application/zip', buffer: await exportZip() });
  await page.getByRole('button', { name: 'Importera', exact: true }).click();
  await expect(page.getByText('Klart. Gamla kyrkan är importerad.')).toBeVisible();
  await openAdmin(page, 'Sånger');

  await expect(page.getByText('Bred dina vida vingar')).toBeVisible();
  await expect(page.getByText('En sång')).toBeVisible();
});

const fixture = (name: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url));

/** Clicks Exportera and returns the zip the page saved: the file and the link that saves it are caught, not followed. */
async function exported(page: Page): Promise<Buffer> {
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      Object.assign(window, { gpSavedBlob: blob });
      return create(blob);
    };
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      Object.assign(window, { gpSavedName: this.download });
    };
  });
  await page.getByRole('button', { name: 'Exportera', exact: true }).click();
  await expect(page.getByText('Klart. Zip-filen är sparad.')).toBeVisible({ timeout: 15_000 });
  const saved = await page.evaluate(async () => {
    const { gpSavedBlob: blob, gpSavedName: name } = window as unknown as { gpSavedBlob: Blob; gpSavedName: string };
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.readAsDataURL(blob);
    });
    return { name, base64: url.slice(url.indexOf(',') + 1) };
  });
  expect(saved.name).toMatch(/^gospel-presenter-Lilla-Kyrkan-\d{4}-\d{2}-\d{2}\.zip$/);
  return Buffer.from(saved.base64, 'base64');
}

test("an organisation exported on one host is imported on another: its song and its video, the video's file in parts", async () => {
  host = await launch();
  await setUpHost(host);
  await createSong(host.page, 'Härlig är jorden', [['Verse 1', 'Härlig är jorden']]);
  await openAdmin(host.page, 'Videor');
  await host.page.getByTestId('video-file').setInputFiles({ name: 'Dop.mp4', mimeType: 'video/mp4', buffer: fixture('h264-long.mp4') });
  await expect(host.page.locator('[data-library-item]')).toHaveCount(1, { timeout: 15_000 });
  await openAdmin(host.page, 'Organisationen');
  const zip = await exported(host.page);
  await host.app.close();

  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await openAdmin(page, 'Organisationen');
  await page.getByTestId('legacy-zip').setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: zip });
  // The video's file, its still and its thumbnail.
  await expect(page.getByText('Lilla Kyrkan: 1 sånger, 0 presentationer och mallar, 1 användare och 3 filer.')).toBeVisible();
  await page.getByRole('button', { name: 'Importera', exact: true }).click();
  await expect(page.getByText('Klart. Lilla Kyrkan är importerad.')).toBeVisible({ timeout: 15_000 });

  await openAdmin(page, 'Sånger');
  await expect(page.getByText('Härlig är jorden')).toBeVisible();
  await openAdmin(page, 'Videor');
  await expect(page.getByTestId('video-card')).toHaveText([/0:20\s*Dop\.mp4/]);
  await page.getByRole('button', { name: 'Dop.mp4', exact: true }).click();
  await expect(page.getByTestId('quick-look-video')).toBeVisible();
});
