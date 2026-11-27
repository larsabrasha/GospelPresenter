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
  db.exec(`INSERT INTO presentations (id, name, event_date, time, location, updated_at) VALUES ${presentations}`);
  return { db, rows: async (sql: string, params: unknown[]) => all(sql, params) };
}

type Named = { name: string };
interface StartPage {
  undated: Named[];
  months: { month: string; rows: Named[] }[];
  past: number;
}
interface TableGroup {
  month?: string | null;
  rows: Named[];
}

const names = (rows: Named[]) => rows.map((r) => r.name);
const groups = (gs: TableGroup[]) => gs.map((g) => [g.month, names(g.rows)]);

describe('startPageView', () => {
  it('lists what is planned, today on, by month, soonest first and a day by its time', async () => {
    const { rows } = org(`
      ('a', 'Kväll', '2026-10-27', '18:00', NULL, NULL), ('b', 'Förmiddag', '2026-10-27', '10:00', NULL, NULL),
      ('c', 'Nästa vecka', '2026-11-03', NULL, NULL, NULL), ('d', 'Imorgon', '2026-10-28', NULL, NULL, NULL)`);

    const page = await new Core().view<StartPage>('startPageView', { today: '2026-10-27' }, rows);

    expect(page.months.map((m) => [m.month, names(m.rows)])).toEqual([
      ['2026-10', ['Förmiddag', 'Kväll', 'Imorgon']],
      ['2026-11', ['Nästa vecka']],
    ]);
  });

  it('leaves the past to the calendar', async () => {
    const { rows } = org(`('a', 'Igår', '2026-10-26', NULL, NULL, NULL)`);

    const page = await new Core().view<StartPage>('startPageView', { today: '2026-10-27' }, rows);

    expect([page.months, page.past]).toEqual([[], 1]);
  });

  it('gives what has no date apart, last changed first', async () => {
    const { rows } = org(`('a', 'Utkast', NULL, NULL, NULL, 200), ('b', 'Ändrad', NULL, NULL, NULL, 400)`);

    const page = await new Core().view<StartPage>('startPageView', { today: '2026-10-27' }, rows);

    expect(names(page.undated)).toEqual(['Ändrad', 'Utkast']);
  });
});

describe('calendarMonthView', () => {
  it('gives a month’s presentations, past and planned, by day and time', async () => {
    const { rows } = org(`
      ('a', 'Sedan', '2026-11-29', '11:00', NULL, NULL), ('b', 'Förr', '2026-11-01', '11:00', NULL, NULL),
      ('c', 'Kväll', '2026-11-15', '18:00', NULL, NULL), ('d', 'Morgon', '2026-11-15', '09:00', NULL, NULL),
      ('e', 'December', '2026-12-06', NULL, NULL, NULL), ('f', 'Utan', NULL, NULL, NULL, NULL)`);

    const month = await new Core().view<Named[]>('calendarMonthView', { month: '2026-11' }, rows);

    expect(names(month)).toEqual(['Förr', 'Morgon', 'Kväll', 'Sedan']);
  });
});

describe('presentationTableView', () => {
  const sheet = () =>
    org(`
      ('a', 'Advent', '2026-11-29', '11:00', 'Kyrksalen', 100), ('b', 'Zion', '2026-12-06', NULL, NULL, 300),
      ('c', 'Ödmjukhet', '2026-11-28', '18:00', 'Källaren', 200), ('d', 'Utkast', NULL, NULL, 'Lilla salen', 400),
      ('e', 'Förr', '2026-10-01', '11:00', NULL, 50)`);

  it('lists what is planned by month and what has no date last, by date', async () => {
    const { rows } = sheet();

    const table = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27' }, rows);

    expect(groups(table)).toEqual([
      ['2026-11', ['Ödmjukhet', 'Advent']],
      ['2026-12', ['Zion']],
      [null, ['Utkast']],
    ]);
  });

  it('takes the past too when asked', async () => {
    const { rows } = sheet();

    const table = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', past: true }, rows);

    expect(table[0]).toEqual({ month: '2026-10', rows: [expect.objectContaining({ name: 'Förr' })] });
  });

  it('turns the order the other way, the months with it', async () => {
    const { rows } = sheet();

    const table = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', desc: true }, rows);

    expect(groups(table)).toEqual([
      ['2026-12', ['Zion']],
      ['2026-11', ['Advent', 'Ödmjukhet']],
      [null, ['Utkast']],
    ]);
  });

  it('sorts by name in the page’s language as one list', async () => {
    const { rows } = sheet();

    const table = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', sort: 'name', locale: 'sv' }, rows);

    expect(groups(table)).toEqual([[undefined, ['Advent', 'Utkast', 'Zion', 'Ödmjukhet']]]);
  });

  it('puts the rows without the sorted value last, either way', async () => {
    const { rows } = sheet();

    const up = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', sort: 'location' }, rows);
    const down = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', sort: 'location', desc: true }, rows);

    // In Swedish order: Kyrksalen, Källaren (ä after y), Lilla salen; Zion has no place.
    expect([names(up[0]!.rows), names(down[0]!.rows)]).toEqual([
      ['Advent', 'Ödmjukhet', 'Utkast', 'Zion'],
      ['Utkast', 'Ödmjukhet', 'Advent', 'Zion'],
    ]);
  });

  it('sorts by change, latest first', async () => {
    const { rows } = sheet();

    const table = await new Core().view<TableGroup[]>('presentationTableView', { today: '2026-11-27', sort: 'changed' }, rows);

    expect(names(table[0]!.rows)).toEqual(['Utkast', 'Zion', 'Ödmjukhet', 'Advent']);
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
