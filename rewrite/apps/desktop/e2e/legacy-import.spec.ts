// Importera från version 1 (docs/import-from-1x.md): an admin of an empty organisation picks an export zip under
// Organisationen, sees what it holds and imports it; its songs, presentations, Bibles and users are there after.
import { expect, test } from '@playwright/test';
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
  await expect(page.getByText('1 nya användare, 0 som redan fanns på servern.')).toBeVisible();
  await openAdmin(page, 'Sånger');
  await expect(page.getByText('Bred dina vida vingar')).toBeVisible();
  await openAdmin(page, 'Biblar');
  await expect(page.getByText('Svenska 1917')).toBeVisible();
  await openAdmin(page, 'Användare');
  await expect(page.getByText('Bo Berg')).toBeVisible();
  await closeAdmin(page);
  await openPresentations(page);
  await expect(page.getByText('Gudstjänst i oktober')).toBeVisible();
});

test('an organisation that has songs does not offer the import', async () => {
  host = await launch();
  const page = host.page;
  await setUpHost(host);
  await createSong(page, 'En sång', []);

  await openAdmin(page, 'Organisationen');

  await expect(page.getByText('Organisationen har redan innehåll. Importen går bara till en tom organisation.')).toBeVisible();
  await expect(page.getByTestId('legacy-zip')).toHaveCount(0);
});
