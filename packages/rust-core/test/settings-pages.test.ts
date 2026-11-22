// Inställningar's pages as the core lays them out for every shell (crates/gp-core/src/settings_pages.rs): the trash,
// the CCLI report, the themes, and the small rules the web had in TS (a fresh name, an output's code, an import's plan).
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const DAY = 86_400_000;
const NOW = 100 * DAY;

/** An organisation's database in memory, migrated by the core, with `sql` run in it. */
function org(sql = '') {
  const db = new DatabaseSync(':memory:');
  const all = (q: string, params: unknown[]) => {
    const st = db.prepare(q);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
  if (sql) db.exec(sql);
  return async (q: string, params: unknown[]) => all(q, params);
}

type Words = { key: string; n: number };

interface TrashPage {
  entries: { kind: string; id: string; daysLeft: number; restore: string; purge: string; left: Words; urgent: boolean }[];
  count: Words;
  kinds: string[];
  kind: string | null;
  total: number;
  expired: boolean;
}

const TRASH = `
  INSERT INTO songs (id, name, author, deleted_at) VALUES ('s1', 'Härlig är jorden', 'Ingemann', ${NOW - 2 * DAY}), ('s2', 'Gamla', NULL, ${NOW - 31 * DAY});
  INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at)
    VALUES ('i1', 'kors.jpg', 'image/jpeg', 'a', 'b', 10, 10, 0, ${NOW - DAY});
  INSERT INTO presentations (id, name, is_template, deleted_at, updated_at) VALUES ('t1', 'Mall', 1, ${NOW - 3 * DAY}, 0);`;

describe('labelColoursView', () => {
  type Colours = { swatches: string[]; chosen: string; maxLength: number };
  const colours = (args: object) => nodeRustCore().pure<Colours>('labelColoursView', args);

  it("adds a label's own colour as a last swatch when it is none of them", () => {
    const out = colours({ color: '#123456' });

    expect([out.swatches.length, out.swatches.at(-1), out.chosen]).toEqual([13, '#123456', '#123456']);
  });

  it('keeps the swatches as they are for one of theirs, in any case', () => {
    const out = colours({ color: '#DC2626' });

    expect(out.swatches.length).toBe(12);
  });

  it('chooses the default grey for a new label, and a text of at most 50', () => {
    const out = colours({});

    expect([out.chosen, out.maxLength]).toEqual(['#6b7280', 50]);
  });
});

describe('trashPageView', () => {
  it('lists the kinds the role manages, newest deletion first, with days left and their mutators', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW }, rows);

    expect(page.entries.map((e) => [e.id, e.daysLeft, e.restore, e.purge])).toEqual([
      ['i1', 29, 'restoreImage', 'purgeImage'],
      ['s1', 28, 'restoreSong', 'purgeSong'],
      ['t1', 27, 'restoreTemplate', 'purgeTemplate'],
      ['s2', 0, 'restoreSong', 'purgeSong'],
    ]);
  });

  it('leaves out what the role does not manage', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'user', now: NOW }, rows);

    expect(page.entries.map((e) => e.kind)).not.toContain('Template');
  });

  it('gives the kinds there are, in order, and a chosen kind that is empty falls back to all', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW, kind: 'Video' }, rows);

    expect([page.kinds, page.kind, page.entries.length]).toEqual([['Template', 'Song', 'Image'], null, 4]);
  });

  it('finds a song by its author', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW, query: 'INGEMANN' }, rows);

    expect(page.entries.map((e) => e.id)).toEqual(['s1']);
  });

  it('words the days left, Raderas snart when none are, and marks a day or less as urgent', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW }, rows);

    expect(page.entries.map((e) => [e.id, e.left, e.urgent])).toEqual([
      ['i1', { key: 'trash.days', n: 29 }, false],
      ['s1', { key: 'trash.days', n: 28 }, false],
      ['t1', { key: 'trash.days', n: 27 }, false],
      ['s2', { key: 'trash.soon', n: 0 }, true],
    ]);
  });

  it('counts the rows shown', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW, query: 'INGEMANN' }, rows);

    expect(page.count).toEqual({ key: 'trash.countOne', n: 1 });
  });

  it('says when something is past its 30 days', async () => {
    const rows = org(TRASH);

    const page = await nodeRustCore().view<TrashPage>('trashPageView', { role: 'admin', now: NOW }, rows);

    expect(page.expired).toBe(true);
  });
});

interface CcliPage {
  on: boolean;
  cards: { key: string; reported: boolean; entries: { id: string }[] }[];
}

const CCLI = `
  INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES
    ('c1', 's1', 'A', '1', 'p1', 'Gudstjänst', '2026-11-08', 5), ('c2', 's2', 'B', '2', 'p1', 'Gudstjänst', '2026-11-08', NULL),
    ('c3', 's1', 'A', '1', 'p2', 'Kväll', '2026-11-01', 5);
  INSERT INTO org_settings (id, value) VALUES ('ccliCollection', 'true');`;

describe('ccliPageView', () => {
  it('makes a card per day and presentation, newest day first, reported only when every entry is', async () => {
    const rows = org(CCLI);

    const page = await nodeRustCore().view<CcliPage>('ccliPageView', { locale: 'sv', filter: 'all' }, rows);

    expect([page.on, page.cards.map((c) => [c.key, c.reported, c.entries.length])]).toEqual([
      true,
      [['2026-11-08|p1', false, 2], ['2026-11-01|p2', true, 1]],
    ]);
  });

  it('filters the unreported, keeping those switched while the page was open', async () => {
    const rows = org(CCLI);

    const page = await nodeRustCore().view<CcliPage>('ccliPageView', { locale: 'sv', filter: 'unreported', keep: ['c3'] }, rows);

    expect(page.cards.flatMap((c) => c.entries.map((e) => e.id))).toEqual(['c2', 'c3']);
  });
});

interface ThemesPage {
  themes: { id: string; default: boolean; actions: { id: string }[] }[];
  canAdd: boolean;
}

describe('themesPageView', () => {
  const OWN = `INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('own', 'Vårt', '{}', 0, 0);
               INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'own');`;

  it('lists the built-in themes first, then the own, with the default marked', async () => {
    const rows = org(OWN);

    const page = await nodeRustCore().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.map((t) => [t.id, t.default])).toEqual([['classic', false], ['light', false], ['own', true]]);
  });

  it('offers editing and deleting an own theme only, and no default for the default', async () => {
    const rows = org(OWN);

    const page = await nodeRustCore().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.map((t) => t.actions.map((a) => a.id))).toEqual([['default', 'duplicate'], ['default', 'duplicate'], ['edit', 'duplicate', 'delete']]);
  });

  it('offers nothing to one who may not manage themes', async () => {
    const rows = org(OWN);

    const page = await nodeRustCore().view<ThemesPage>('themesPageView', { role: 'user' }, rows);

    expect([page.canAdd, page.themes.flatMap((t) => t.actions)]).toEqual([false, []]);
  });

  it('shows Classic as the default when the chosen theme is gone', async () => {
    const rows = org(`INSERT INTO org_settings (id, value) VALUES ('defaultThemeId', 'deleted')`);

    const page = await nodeRustCore().view<ThemesPage>('themesPageView', { role: 'admin' }, rows);

    expect(page.themes.find((t) => t.default)?.id).toBe('classic');
  });
});

describe('libraryOrderView', () => {
  const IMAGES = `INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES
    ('a', 'Bild 10.jpg', 'image/jpeg', 'h', 'h', 1, 1, 3), ('b', 'Bild 2.jpg', 'image/jpeg', 'h', 'h', 1, 1, 1), ('c', 'kors.jpg', 'image/jpeg', 'h', 'h', 1, 1, 2)`;
  const order = async (args: object) => (await nodeRustCore().view<{ rows: { id: string }[]; sort: string }>('libraryOrderView', { kind: 'images', locale: 'sv', ...args }, org(IMAGES))).rows.map((r) => r.id);

  it('lists the newest first by default', async () => {
    expect(await order({})).toEqual(['a', 'c', 'b']);
  });

  it('orders by name with digits by their value', async () => {
    expect(await order({ sort: 'name' })).toEqual(['b', 'a', 'c']);
  });

  it('keeps the names holding the query, any case', async () => {
    expect(await order({ query: 'BILD', sort: 'oldest' })).toEqual(['b', 'a']);
  });
});

describe('songListView', () => {
  const SONGS = `INSERT INTO songs (id, name, author) VALUES ('a', 'Ära vare Gud', 'Bo'), ('b', 'Amazing grace', NULL), ('c', 'Bara du', 'Anna'), ('d', '10 000 skäl', 'Bo')`;
  type List = { sort: string; index: boolean; sections: { letter: string | null; rows: { id: string }[] }[] };
  const list = async (sort?: string) => nodeRustCore().view<List>('songListView', { locale: 'sv', ...(sort ? { sort } : {}) }, org(SONGS));

  it('runs the songs by first letter, Ä its own and a digit under #', async () => {
    const l = await list();

    expect(l.sections.map((s) => [s.letter, s.rows.map((r) => r.id)])).toEqual([['#', ['d']], ['A', ['b']], ['B', ['c']], ['Ä', ['a']]]);
  });

  it('orders by author with those without one last, in one section', async () => {
    const l = await list('author');

    expect(l.sections.map((s) => [s.letter, s.rows.map((r) => r.id)])).toEqual([[null, ['c', 'd', 'a', 'b']]]);
  });

  it('has no letter index under 20 songs', async () => {
    expect((await list()).index).toBe(false);
  });

  it('has the letter index from 20 songs by name, never by author', async () => {
    const many = `INSERT INTO songs (id, name) VALUES ${Array.from({ length: 20 }, (_, i) => `('s${i}', 'Sång ${i}')`).join(', ')}`;
    const view = (sort: string) => nodeRustCore().view<List>('songListView', { locale: 'sv', sort }, org(many));

    expect([(await view('name')).index, (await view('author')).index]).toEqual([true, false]);
  });
});

describe('songHistoryPageView', () => {
  const data = (name: string) => JSON.stringify({ name, author: null, publisher: null, year: null, ccli: null, arrangements: [],
    parts: [{ id: 'p1', labelId: null, labelText: 'Vers', labelColor: '#123456', content: 'Rad' }] });
  const HISTORY = `INSERT INTO songs (id, name) VALUES ('s', 'Sång');
    INSERT INTO song_versions (id, song_id, user_id, created_at, name, data) VALUES
      ('v1', 's', 'u', ${10 * DAY + 5}, 'Idag', '${data('Idag')}'), ('v2', 's', 'u', ${9 * DAY + 5}, 'Igår', '${data('Igår')}'), ('v3', 's', 'u', ${2 * DAY}, 'Förr', '${data('Förr')}')`;

  it('runs the versions by day, newest first, each with its parts as slides and their labels', async () => {
    const page = await nodeRustCore().view<{ days: { day: string; versions: { id: string; slides: { label: { text: string; color: string } }[] }[] }[] }>(
      'songHistoryPageView', { id: 's', today: 10 * DAY, yesterday: 9 * DAY }, org(HISTORY));

    expect(page.days.map((d) => [d.day, d.versions.map((v) => v.id)])).toEqual([['today', ['v1']], ['yesterday', ['v2']], ['before', ['v3']]]);
    expect(page.days[0]!.versions[0]!.slides[0]!.label).toEqual({ text: 'Vers', color: '#123456' });
  });
});

describe('freshNameView', () => {
  it('gives the base when it is free', () => {
    expect(nodeRustCore().pure('freshNameView', { base: 'Ny sång', taken: ['Annan'] })).toBe('Ny sång');
  });

  it('numbers the base from 2, whatever the case of the names taken', () => {
    expect(nodeRustCore().pure('freshNameView', { base: 'Ny sång', taken: ['ny sång', 'NY SÅNG 2'] })).toBe('Ny sång 3');
  });
});

describe('displayCodeView', () => {
  it('makes seven of the letters and digits not easily confused', () => {
    const code = nodeRustCore().pure<string>('displayCodeView', { random: Array.from({ length: 64 }, (_, i) => i * 3) });

    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{7}$/);
  });

  it('skips the bytes that would bias it', () => {
    const code = nodeRustCore().pure<string>('displayCodeView', { random: [255, 254, 0, 1, 2, 3, 4, 5, 6] });

    expect(code).toBe('abcdefg');
  });
});

describe('mediaImportView', () => {
  it('fits a picture within 1920 × 1080 and its thumbnail within 400 × 225, never larger', () => {
    const plan = nodeRustCore().pure('mediaImportView', { kind: 'image', name: 'a.png', size: 1000, type: 'image/png', width: 4000, height: 3000 });

    expect(plan).toEqual({ refused: null, storedType: 'image/webp', full: { width: 1440, height: 1080, quality: 0.9 }, thumb: { width: 300, height: 225, quality: 0.8 } });
  });

  it('takes a type by the extension when none is reported, and refuses another', () => {
    const byName = nodeRustCore().pure<{ storedType: string }>('mediaImportView', { kind: 'image', name: 'a.JPG', size: 10, width: 10, height: 10 });
    const other = nodeRustCore().pure('mediaImportView', { kind: 'image', name: 'a.tiff', size: 10, type: 'image/tiff' });

    expect([byName.storedType, other]).toEqual(['image/jpeg', { refused: 'type' }]);
  });

  it('refuses a sound over 20 MiB', () => {
    expect(nodeRustCore().pure('mediaImportView', { kind: 'audio', name: 'a.mp3', size: 21 * 1024 * 1024 })).toEqual({ refused: 'size' });
  });

  it('refuses a sound whose reported type is not a sound’s, as readAudio does', () => {
    expect(nodeRustCore().pure('mediaImportView', { kind: 'audio', name: 'a.mp3', size: 1000, type: 'audio/x-mpeg' })).toEqual({ refused: 'type' });
  });

  it('keeps a sound as the type its first bytes say', () => {
    const head = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map((c) => c.charCodeAt(0)));

    const plan = nodeRustCore().pure('mediaImportView', { kind: 'audio', name: 'a.mp3', size: 1000, head });

    expect(plan).toEqual({ refused: null, contentType: 'audio/wav' });
  });

  it('refuses a file named as a sound whose bytes are none', () => {
    expect(nodeRustCore().pure('mediaImportView', { kind: 'audio', name: 'a.mp3', size: 1000, head: [1, 2, 3, 4] })).toEqual({ refused: 'type' });
  });

  it('says a wrong type before a long name, in the web’s order', () => {
    expect(nodeRustCore().pure('mediaImportView', { kind: 'image', name: `${'a'.repeat(250)}.txt`, size: 10, type: 'text/plain' })).toEqual({ refused: 'type' });
  });
});
