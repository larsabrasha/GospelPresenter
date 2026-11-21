import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

/** An organisation's database in memory, migrated by the core, with the presentations given. */
function org(presentations: string) {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[]) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
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

    const lists = await nodeRustCore().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => [l.id, l.rows.map((r) => r.name)])).toEqual([
      ['today', ['Förmiddag', 'Kväll']],
      ['upcoming', ['Imorgon', 'Nästa vecka']],
      ['recent', ['Gammal', 'Utan datum', 'Igår', 'Aldrig ändrad']],
    ]);
  });

  it('says which lists show their rows’ date and year', async () => {
    const { rows } = org(`('a', 'Idag', '2026-10-27', NULL, NULL), ('b', 'Sedan', '2026-11-03', NULL, NULL), ('c', 'Förr', '2026-01-04', NULL, NULL)`);

    const lists = await nodeRustCore().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => [l.id, l.showDate, l.withYear])).toEqual([['today', false, false], ['upcoming', true, false], ['recent', true, true]]);
  });

  it('leaves out an empty list', async () => {
    const { rows } = org(`('a', 'Förr', '2026-01-04', NULL, NULL)`);

    const lists = await nodeRustCore().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists.map((l) => l.id)).toEqual(['recent']);
  });

  it('gives each row its number of items', async () => {
    const { db, rows } = org(`('a', 'Förr', '2026-01-04', NULL, NULL)`);
    db.exec(`INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i1', 'a', 'header', 'Välkommen', 'i1', 0), ('i2', 'a', 'header', 'Bön', 'i2', 1)`);

    const lists = await nodeRustCore().view<StartList[]>('startPageView', { today: '2026-10-27' }, rows);

    expect(lists[0]!.rows[0]!.itemCount).toBe(2);
  });
});

interface Groups {
  groups: { id: string; actions: { id: string; text: string; enabled: boolean; choices?: { id: string; name?: string | null; n?: number }[]; chosen?: string }[] }[];
}
const ids = (g: Groups) => g.groups.map((x) => [x.id, x.actions.map((a) => a.id)]);

describe('presentationActionsView', () => {
  it('offers details, notes, saving as a template and the trash to an admin before presenting', () => {
    const menu = nodeRustCore().pure<Groups>('presentationActionsView', { isTemplate: false, presenting: false, role: 'admin' });

    expect(ids(menu)).toEqual([['details', ['editDetails', 'materials']], ['template', ['saveAsTemplate']], ['remove', ['trash']]]);
  });

  it('offers no trash while the presentation is presented', () => {
    const menu = nodeRustCore().pure<Groups>('presentationActionsView', { isTemplate: false, presenting: true, role: 'admin' });

    expect(ids(menu).map(([g]) => g)).not.toContain('remove');
  });

  it('offers saving as a template only to a role that manages templates', () => {
    const menu = nodeRustCore().pure<Groups>('presentationActionsView', { isTemplate: false, presenting: false, role: 'user' });

    expect(ids(menu).map(([g]) => g)).not.toContain('template');
  });

  it("offers a template neither notes nor saving as a template, and names its trash as a template's", () => {
    const menu = nodeRustCore().pure<Groups>('presentationActionsView', { isTemplate: true, presenting: false, role: 'admin' });

    expect(ids(menu)).toEqual([['details', ['editDetails']], ['remove', ['trash']]]);
    expect(menu.groups[1]!.actions[0]!.text).toBe('templates.trash');
  });
});

describe('itemActionsView', () => {
  const song = { id: 'i1', type: 'song', sourceId: 's1', arrangementId: null, overlayId: null };
  const two = [{ id: 'a1', name: null }, { id: 'a2', name: 'Kort' }];

  it("opens a song's page and offers its arrangements, the first chosen when the item names none", () => {
    const menu = nodeRustCore().pure<Groups>('itemActionsView', { item: song, song: { deletedAt: null }, arrangements: two, overlays: [], shownId: null });

    expect(ids(menu)).toEqual([['open', ['edit', 'note']], ['show', ['arrangement']], ['list', ['addAfter', 'tick']], ['remove', ['delete']]]);
    expect(menu.groups[1]!.actions[0]!.choices).toEqual([{ id: 'original', text: 'song.original' }, { id: 'a1', name: null, n: 1 }, { id: 'a2', name: 'Kort', n: 2 }]);
    expect(menu.groups[1]!.actions[0]!.chosen).toBe('a1');
  });

  it('offers neither the page nor the arrangements of a song in the trash', () => {
    const menu = nodeRustCore().pure<Groups>('itemActionsView', { item: song, song: { deletedAt: 5 }, arrangements: two, overlays: [], shownId: null });

    expect(ids(menu).slice(0, 2)).toEqual([['open', ['note']], ['list', ['addAfter', 'tick']]]);
  });

  it("renames a programme item, and offers it no overlay, which it would not show", () => {
    const menu = nodeRustCore().pure<Groups>('itemActionsView', { item: { ...song, type: 'header' }, song: null, arrangements: [], overlays: [{ id: 'o1', title: 'Välkommen' }], shownId: null });

    expect(ids(menu)[0]).toEqual(['open', ['rename', 'note']]);
    expect(ids(menu).map(([g]) => g)).not.toContain('show');
  });

  it('offers the overlays with Ingen first', () => {
    const menu = nodeRustCore().pure<Groups>('itemActionsView', { item: song, song: { deletedAt: null }, arrangements: [], overlays: [{ id: 'o1', title: 'Välkommen' }], shownId: null });

    expect(menu.groups[1]!.actions[0]!.choices).toEqual([{ id: '', text: 'overlays.itemNone' }, { id: 'o1', name: 'Välkommen' }]);
  });

  it('cannot remove the item shown, and says so', () => {
    const menu = nodeRustCore().pure<Groups>('itemActionsView', { item: song, song: { deletedAt: null }, arrangements: [], overlays: [], shownId: 'i1' });

    expect(menu.groups.at(-1)!.actions[0]).toMatchObject({ id: 'delete', text: 'live.shownCannotRemove', enabled: false });
  });
});

describe('detailsDialogView', () => {
  const dialog = (isNew: boolean) =>
    nodeRustCore().pure<{ title: string; groups: string[][]; actions: { id: string; text: string; role: string; busyText: string | null }[] }>('detailsDialogView', { isNew });

  it('titles a new presentation Skapa presentation, with Avbryt and Skapa', () => {
    const d = dialog(true);

    expect([d.title, d.actions.map((a) => [a.id, a.text, a.role])]).toEqual(['presentations.createTitle', [['cancel', 'common.cancel', 'cancel'], ['save', 'common.create', 'confirm']]]);
  });

  it('titles one there Redigera detaljer, with Avbryt and Spara', () => {
    const d = dialog(false);

    expect([d.title, d.actions.map((a) => a.text)]).toEqual(['presentation.editDetails', ['common.cancel', 'common.save']]);
  });

  it('offers the theme only for one there, between when and the description', () => {
    expect([dialog(true).groups, dialog(false).groups]).toEqual([
      [['name', 'location'], ['date', 'time'], ['description']],
      [['name', 'location'], ['date', 'time'], ['theme'], ['description']],
    ]);
  });
});

describe('pageButtonsView', () => {
  type Buttons = { buttons: { id: string; text: string; role: string; enabled: boolean }[] };
  const bar = (args: object) => nodeRustCore().pure<Buttons>('pageButtonsView', { place: 'presentationBar', ...args }).buttons;

  it('offers Starta in its role while the presentation can start and has a slide', () => {
    const start = bar({ presenting: false, canStart: true, hasSlides: true }).at(-1);

    expect(start).toEqual({ id: 'start', text: 'presentation.start', icon: 'play', role: 'start', enabled: true });
  });

  it('holds Starta back while another presentation is presented', () => {
    expect(bar({ presenting: false, canStart: false, hasSlides: true }).at(-1)?.enabled).toBe(false);
  });

  it('offers Avsluta while presenting', () => {
    expect(bar({ presenting: true }).map((b) => [b.id, b.role])).toEqual([['back', 'quiet'], ['end', 'end']]);
  });

  it('gives the start page its + as an add', () => {
    const buttons = nodeRustCore().pure<Buttons>('pageButtonsView', { place: 'startPage' }).buttons;

    expect(buttons.map((b) => [b.id, b.role])).toEqual([['new', 'add']]);
  });
});

describe('presentationColumnsView', () => {
  type Columns = { columns: { id: string; shown: boolean; parts: string[]; foot: string[] }[] };
  const columns = (presenting: boolean) => nodeRustCore().pure<Columns>('presentationColumnsView', { presenting }).columns;

  it('never shows the next slide in the live column', () => {
    const live = columns(true).find((c) => c.id === 'live');

    expect(live?.parts).toEqual(['picture', 'outputs', 'overlays']);
  });

  it('shows the live column only while presenting', () => {
    expect([columns(false), columns(true)].map((cs) => cs.find((c) => c.id === 'live')?.shown)).toEqual([false, true]);
  });

  it('keeps Lägg till within reach in the running order', () => {
    const order = nodeRustCore().pure<{ columns: { id: string; sticky: string[] }[] }>('presentationColumnsView', { presenting: false }).columns[0];

    expect(order?.sticky).toEqual(['add']);
  });

  it('lets each column be dragged wider or narrower within bounds, never folded by it', () => {
    type Width = { ideal: number; min: number; max: number };
    const cs = nodeRustCore().pure<{ columns: { width: Width; foldsByDrag: boolean }[] }>('presentationColumnsView', { presenting: true }).columns;

    expect(cs.map((c) => [c.width.min <= c.width.ideal && c.width.ideal <= c.width.max, c.foldsByDrag])).toEqual([[true, false], [true, false]]);
  });

  it('folds each column by a button at its foot, at the edge beside the slides', () => {
    expect(columns(true).map((c) => c.foot.at(-1))).toEqual(['fold', 'fold']);
  });
});

describe('lookView', () => {
  type Look = { colors: Record<string, { light: { name: string; hex: string } }>; roles: Record<string, { color: string | null; weight: string }> };

  it('fills ▶ in emerald and ■ in red, as the web draws them', () => {
    const look = nodeRustCore().pure<Look>('lookView', {});

    expect([look.colors[look.roles.start!.color!]!.light.name, look.colors[look.roles.end!.color!]!.light.name]).toEqual(['emerald-500', 'red-500']);
  });
});

describe('addPositionView', () => {
  it('adds after the last thing added while that is still ahead of the shown item', () => {
    const place = { order: ['welcome', 'song', 'added', 'reading'], shownId: 'song', lastAddedId: 'added', chosenId: null };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('adds after the selected item before presenting, though something was added since', () => {
    const place = { order: ['welcome', 'song', 'added'], shownId: null, lastAddedId: 'added', chosenId: null, selectedId: 'welcome' };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBe('welcome');
  });

  it('adds after the last thing added before presenting when nothing is selected, as on a phone', () => {
    const place = { order: ['welcome', 'added', 'song'], shownId: null, lastAddedId: 'added', chosenId: null };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('takes a selected item that is gone as no selection', () => {
    const place = { order: ['welcome', 'added'], shownId: null, lastAddedId: 'added', chosenId: null, selectedId: 'removed' };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBe('added');
  });

  it('adds after the shown item while presenting, though another is selected', () => {
    const place = { order: ['welcome', 'song', 'reading'], shownId: 'song', lastAddedId: null, chosenId: null, selectedId: 'reading' };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBe('song');
  });

  it('adds at the end when nothing is shown, chosen, added or selected', () => {
    const place = { order: ['welcome', 'song'], shownId: null, lastAddedId: null, chosenId: null };

    const after = nodeRustCore().pure('addPositionView', place);

    expect(after).toBeNull();
  });
});
