import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Core, type Rows } from '../../src/core.ts';

/** An organisation's database in memory, migrated by the core, with the presentations given. */
function org(presentations: string) {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[]) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  new Core().runSync('migrateOrgSchema', all);
  db.exec(`INSERT INTO presentations (id, name, event_date, time, updated_at) VALUES ${presentations}`);
  return { db, rows: async (sql: string, params: unknown[]) => all(sql, params) };
}

interface StartList {
  id: string;
  showDate: boolean;
  withYear: boolean;
  rows: { name: string; itemCount: number }[];
}

describe('startPageView', () => {
  it('splits into today by time, upcoming soonest first, and the rest last changed first', async () => {
    const { rows } = org(`
      ('a', 'Gammal', '2026-01-04', NULL, 300), ('b', 'Utan datum', NULL, NULL, 200), ('c', 'Nästa vecka', '2026-11-03', NULL, NULL),
      ('d', 'Kväll', '2026-10-27', '18:00', NULL), ('e', 'Imorgon', '2026-10-28', NULL, NULL), ('f', 'Förmiddag', '2026-10-27', '10:00', NULL),
      ('g', 'Igår', '2026-10-26', NULL, 100), ('h', 'Aldrig ändrad', '2026-10-01', NULL, NULL)`);

    const lists = await new Core().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => [l.id, l.rows.map((r) => r.name)])).toEqual([
      ['today', ['Förmiddag', 'Kväll']],
      ['upcoming', ['Imorgon', 'Nästa vecka']],
      ['recent', ['Gammal', 'Utan datum', 'Igår', 'Aldrig ändrad']],
    ]);
  });

  it('says which lists show their rows’ date and year', async () => {
    const { rows } = org(`('a', 'Idag', '2026-10-27', NULL, NULL), ('b', 'Sedan', '2026-11-03', NULL, NULL), ('c', 'Förr', '2026-01-04', NULL, NULL)`);

    const lists = await new Core().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => [l.id, l.showDate, l.withYear])).toEqual([['today', false, false], ['upcoming', true, false], ['recent', true, true]]);
  });

  it('leaves out an empty list', async () => {
    const { rows } = org(`('a', 'Förr', '2026-01-04', NULL, NULL)`);

    const lists = await new Core().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => l.id)).toEqual(['recent']);
  });

  it('gives each row its number of items', async () => {
    const { db, rows } = org(`('a', 'Förr', '2026-01-04', NULL, NULL)`);
    db.exec(`INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i1', 'a', 'header', 'Välkommen', 'i1', 0), ('i2', 'a', 'header', 'Bön', 'i2', 1)`);

    const lists = await new Core().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists[0]!.rows[0]!.itemCount).toBe(2);
  });
});

describe('addPositionView', () => {
  it('adds after the last thing added while that is still ahead of the shown item', () => {
    const place = { order: ['welcome', 'song', 'added', 'reading'], shownId: 'song', lastAddedId: 'added', chosenId: null };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('adds after the selected item before presenting, though something was added since', () => {
    const place = { order: ['welcome', 'song', 'added'], shownId: null, lastAddedId: 'added', chosenId: null, selectedId: 'welcome' };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBe('welcome');
  });

  it('adds after the last thing added before presenting when nothing is selected, as on a phone', () => {
    const place = { order: ['welcome', 'added', 'song'], shownId: null, lastAddedId: 'added', chosenId: null };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('takes a selected item that is gone as no selection', () => {
    const place = { order: ['welcome', 'added'], shownId: null, lastAddedId: 'added', chosenId: null, selectedId: 'removed' };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('adds after the shown item while presenting, though another is selected', () => {
    const place = { order: ['welcome', 'song', 'reading'], shownId: 'song', lastAddedId: null, chosenId: null, selectedId: 'reading' };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBe('song');
  });

  it('adds at the end when nothing is shown, chosen, added or selected', () => {
    const place = { order: ['welcome', 'song'], shownId: null, lastAddedId: null, chosenId: null };

    const after = new Core().pure('addPositionView', place);

    expect(after).toBeNull();
  });
});
