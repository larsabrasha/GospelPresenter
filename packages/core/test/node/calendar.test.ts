// The calendar (docs/planning.md): events and their fields, templates, the link to a presentation, the trash, and the
// views Kalender, an event's page and a person read.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import { Core, runMutation, type MutationDb, type Rows } from '../../src/core.ts';
import { orgMigrations } from '../../src/org-schema.ts';

const user: MutatorCtx = { userId: 'u', role: 'user', now: 1000 };
const admin: MutatorCtx = { userId: 'a', role: 'admin', now: 1000 };
const today = '2026-11-28';

/** An organisation's database in memory, migrated by the core, and a core over it. */
function org(): MutationDb & { db0: DatabaseSync; view: <T>(name: string, args: unknown) => Promise<T> } {
  const db0 = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db0.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = new Core();
  core.runSync('migrateOrgSchema', rows);
  return { db0, core, rows, view: (name, args) => core.view(name, args, async (sql, params) => rows(sql, params)) };
}

const sunday = { id: 'e1', title: 'Gudstjänst', date: '2026-11-29', time: '11:00', at: 1 };
type Row = { id: string; title: string; filled: { name: string; text: string }[]; missing: number; presentation: { id: string; name: string } | null };

describe('events', () => {
  it('lists a coming event in Lista', async () => {
    const o = org();

    await runMutation(o, 'createEvent', sunday, user);

    expect((await o.view<Row[]>('calendarListView', { today })).map((e) => e.title)).toEqual(['Gudstjänst']);
  });

  it('keeps a past event out of Lista until the past is asked for', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, date: '2026-11-01' }, user);

    const coming = await o.view<Row[]>('calendarListView', { today });
    const past = await o.view<Row[]>('calendarListView', { today, past: true });

    expect([coming.length, past.length]).toEqual([0, 1]);
  });

  it('moves the end time with the start time, so the length stays', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, endTime: '12:30' }, user);

    await runMutation(o, 'updateEvent', { id: 'e1', time: '18:00', at: 2 }, user);

    expect(await o.view('eventView', { id: 'e1' })).toMatchObject({ time: '18:00', endTime: '19:30' });
  });

  it('leaves the end time where it is when the change names it too', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, endTime: '12:30' }, user);

    await runMutation(o, 'updateEvent', { id: 'e1', time: '18:00', endTime: '20:00', at: 2 }, user);

    expect(await o.view('eventView', { id: 'e1' })).toMatchObject({ time: '18:00', endTime: '20:00' });
  });

  it('leaves the end time where it is when moving it would pass midnight', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, time: '20:00', endTime: '23:00' }, user);

    await runMutation(o, 'updateEvent', { id: 'e1', time: '22:00', at: 2 }, user);

    expect(await o.view('eventView', { id: 'e1' })).toMatchObject({ time: '22:00', endTime: '23:00' });
  });

  it('moves the end date with the date of an event over several days', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, date: '2027-01-30', endDate: '2027-01-31' }, user);

    await runMutation(o, 'updateEvent', { id: 'e1', date: '2027-02-27', at: 2 }, user);

    expect(await o.view('eventView', { id: 'e1' })).toMatchObject({ date: '2027-02-27', endDate: '2027-02-28' });
  });

  it('gives an event from a template the template’s length', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { id: 't1', title: 'Fredagscafé', date: null, isTemplate: true, time: '15:00', endTime: '18:00', at: 1 }, admin);

    await runMutation(o, 'createEvent', { id: 'e1', title: 'Fredagscafé', date: '2026-12-04', template: 't1', at: 2 }, user);

    expect(await o.view('eventView', { id: 'e1' })).toMatchObject({ time: '15:00', endTime: '18:00' });
  });

  it('lists a month’s events, the past too, for Kalender', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, date: '2026-11-01' }, user);
    await runMutation(o, 'createEvent', { ...sunday, id: 'e2', date: '2026-12-06' }, user);

    const rows = await o.view<Row[]>('calendarListView', { month: '2026-11' });

    expect(rows.map((e) => e.id)).toEqual(['e1']);
  });

  it('gives each event its members and its words, for the start page’s filters', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, place: 'Kyrksalen' }, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Predikan', entries: [{ person: 'u2', name: 'Lena Sjö' }, { text: 'Karl D' }] }, user);

    const [row] = await o.view<{ persons: string[]; search: string }[]>('calendarListView', { today });

    expect(row).toMatchObject({ persons: ['u2'], search: 'gudstjänst kyrksalen lena sjö karl d' });
  });

  it('lists every event, past and coming, for a search', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { ...sunday, date: '2026-11-01' }, user);
    await runMutation(o, 'createEvent', { ...sunday, id: 'e2', date: '2026-12-06' }, user);

    const rows = await o.view<Row[]>('calendarListView', { all: true });

    expect(rows.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('refuses an event without a date', async () => {
    const o = org();

    await expect(runMutation(o, 'createEvent', { ...sunday, date: null }, user)).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it('counts the fields that still need someone', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Predikan', entries: [{ text: 'Johan Lind' }] }, user);
    await runMutation(o, 'addEventField', { id: 'f2', eventId: 'e1', name: 'Ljud' }, user);

    const [row] = await o.view<Row[]>('calendarListView', { today });

    expect(row).toMatchObject({ filled: [{ name: 'Predikan', text: 'Johan Lind' }], missing: 1 });
  });

  it('writes a field’s entries whole, a person and text side by side', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Förebedjare' }, user);

    await runMutation(o, 'updateEventField', { id: 'f1', entries: [{ person: 'u2', name: 'Lena Sjö' }, { text: 'Karl D' }] }, user);

    const page = await o.view<{ fields: { entries: unknown[] }[] }>('eventView', { id: 'e1' });
    expect(page.fields[0]!.entries).toEqual([{ person: 'u2', name: 'Lena Sjö' }, { text: 'Karl D' }]);
  });

  it('moves a field to another place among the event’s', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    for (const [id, name] of [['f1', 'A'], ['f2', 'B'], ['f3', 'C']]) await runMutation(o, 'addEventField', { id, eventId: 'e1', name }, user);

    await runMutation(o, 'moveEventField', { id: 'f3', to: 0 }, user);

    const page = await o.view<{ fields: { name: string }[] }>('eventView', { id: 'e1' });
    expect(page.fields.map((f) => f.name)).toEqual(['C', 'A', 'B']);
  });

  it('makes Tabell’s columns of the field names in the order they first come', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'createEvent', { ...sunday, id: 'e2', date: '2026-12-04', title: 'Fredagscafé' }, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Predikan' }, user);
    await runMutation(o, 'addEventField', { id: 'f2', eventId: 'e2', name: 'Kaffe' }, user);
    await runMutation(o, 'addEventField', { id: 'f3', eventId: 'e2', name: 'Predikan' }, user);

    const table = await o.view<{ columns: string[]; rows: { cells: Record<string, unknown> }[] }>('calendarTableView', { today });

    expect([table.columns, Object.keys(table.rows[0]!.cells)]).toEqual([['Predikan', 'Kaffe'], ['Predikan']]);
  });
});

describe('templates', () => {
  it('copies a template’s fields and details into a new event', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { id: 't1', title: 'Gudstjänst', date: null, isTemplate: true, time: '11:00', place: 'Kyrksalen', visibility: 'shown', at: 1 }, admin);
    await runMutation(o, 'addEventField', { id: 'tf1', eventId: 't1', name: 'Predikan' }, admin);

    await runMutation(o, 'createEvent', { id: 'e1', title: 'Gudstjänst', date: '2026-12-06', template: 't1', at: 2 }, user);

    const page = await o.view<{ time: string; place: string; visibility: string; fields: { id: string; name: string }[] }>('eventView', { id: 'e1' });
    expect(page).toMatchObject({ time: '11:00', place: 'Kyrksalen', visibility: 'shown', fields: [{ id: 'e1~tf1', name: 'Predikan' }] });
  });

  it('lets only an admin change a template', async () => {
    const o = org();
    await runMutation(o, 'createEvent', { id: 't1', title: 'Gudstjänst', date: null, isTemplate: true, at: 1 }, admin);

    await expect(runMutation(o, 'addEventField', { id: 'tf1', eventId: 't1', name: 'Predikan' }, user)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps templates out of Lista', async () => {
    const o = org();

    await runMutation(o, 'createEvent', { id: 't1', title: 'Gudstjänst', date: null, isTemplate: true, at: 1 }, admin);

    expect(await o.view<Row[]>('calendarListView', { today })).toEqual([]);
  });

  it('makes an event without a template hidden outside the church', async () => {
    const o = org();

    await runMutation(o, 'createEvent', sunday, user);

    expect(await o.view<{ visibility: string }>('eventView', { id: 'e1' })).toMatchObject({ visibility: 'hidden' });
  });
});

describe('the link to a presentation', () => {
  it('makes a presentation for an event with its title and date, linked', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);

    await runMutation(o, 'createPresentationForEvent', { eventId: 'e1', presentationId: 'p1', name: 'Gudstjänst', at: 2 }, user);

    const p = o.db0.prepare('SELECT name, event_date, time FROM presentations WHERE id = ?').get('p1');
    expect([p, (await o.view<Row[]>('calendarListView', { today }))[0]!.presentation]).toEqual([
      { name: 'Gudstjänst', event_date: '2026-11-29', time: '11:00' },
      { id: 'p1', name: 'Gudstjänst' },
    ]);
  });

  it('makes a new presentation for an event whose presentation is in the trash', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'createPresentationForEvent', { eventId: 'e1', presentationId: 'p1', name: 'Gudstjänst', at: 2 }, user);
    await runMutation(o, 'trashPresentation', { id: 'p1', at: 3 }, user);

    await runMutation(o, 'createPresentationForEvent', { eventId: 'e1', presentationId: 'p2', name: 'Gudstjänst', at: 4 }, user);

    expect((await o.view<Row[]>('calendarListView', { today }))[0]!.presentation).toEqual({ id: 'p2', name: 'Gudstjänst' });
  });

  it('moves the linked presentation’s date with the event’s', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'createPresentationForEvent', { eventId: 'e1', presentationId: 'p1', name: 'Gudstjänst', at: 2 }, user);

    await runMutation(o, 'updateEvent', { id: 'e1', date: '2026-12-06', place: 'Lillsalen', at: 3 }, user);

    expect(o.db0.prepare('SELECT event_date, location FROM presentations WHERE id = ?').get('p1')).toEqual({ event_date: '2026-12-06', location: 'Lillsalen' });
  });

  it('puts a presentation in the calendar again when its event is in the trash', async () => {
    const o = org();
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Konsert', eventDate: '2026-12-12', time: '18:00' }, user);
    await runMutation(o, 'trashEvent', { id: 'p1', at: 2 }, user);

    await runMutation(o, 'createEventFromPresentation', { presentationId: 'p1', eventId: 'e1', at: 3 }, user);

    expect(await o.view('presentationEventView', { presentationId: 'p1' })).toMatchObject({ id: 'e1', title: 'Konsert', date: '2026-12-12', time: '18:00' });
  });

  it('takes a presentation from the event it was linked to when another links it', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'createEvent', { ...sunday, id: 'e2', date: '2026-12-06' }, user);
    await runMutation(o, 'createPresentationForEvent', { eventId: 'e1', presentationId: 'p1', name: 'Gudstjänst', at: 2 }, user);

    await runMutation(o, 'linkEventPresentation', { eventId: 'e2', presentationId: 'p1', at: 3 }, user);

    expect(o.db0.prepare('SELECT id FROM events WHERE presentation_id = ?').all('p1')).toEqual([{ id: 'e2' }]);
  });
});

describe('the trash', () => {
  it('lists a trashed event in the trash and not in Lista', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);

    await runMutation(o, 'trashEvent', { id: 'e1', at: 5 }, user);

    const trash = await o.view<{ kind: string }[]>('trashEntriesView', {});
    expect([trash.map((t) => t.kind), await o.view('calendarListView', { today })]).toEqual([['Event'], []]);
  });

  it('deletes an event and its fields for good from the trash', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Predikan' }, user);
    await runMutation(o, 'trashEvent', { id: 'e1', at: 5 }, user);

    await runMutation(o, 'emptyTrash', {}, user);

    expect(o.db0.prepare('SELECT (SELECT count(*) FROM events) AS e, (SELECT count(*) FROM event_fields) AS f').get()).toEqual({ e: 0, f: 0 });
  });
});

describe('a person', () => {
  it('lists the coming events a member is in, with the fields', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Predikan', entries: [{ person: 'u2', name: 'Lena Sjö' }] }, user);
    await runMutation(o, 'addEventField', { id: 'f2', eventId: 'e1', name: 'Musik', entries: [{ text: 'Lena Sjö' }] }, user);

    const events = await o.view<{ id: string; fields: string[] }[]>('personEventsView', { person: 'u2', today });

    expect(events.map((e) => [e.id, e.fields])).toEqual([['e1', ['Predikan']]]);
  });
});

describe('suggestions', () => {
  it('offers the texts written before in fields of the same name, most used first', async () => {
    const o = org();
    await runMutation(o, 'createEvent', sunday, user);
    await runMutation(o, 'createEvent', { ...sunday, id: 'e2', date: '2026-12-06' }, user);
    await runMutation(o, 'addEventField', { id: 'f1', eventId: 'e1', name: 'Ljud', entries: [{ text: 'Olof V' }] }, user);
    await runMutation(o, 'addEventField', { id: 'f2', eventId: 'e2', name: 'Ljud', entries: [{ text: 'Tomas F' }, { text: 'Olof V' }] }, user);

    const s = await o.view<{ texts: Record<string, string[]> }>('eventSuggestionsView', {});

    expect(s.texts.Ljud).toEqual(['Olof V', 'Tomas F']);
  });
});

describe('the import', () => {
  it('writes imported events and their fields', async () => {
    const o = org();
    const event = { id: 'e1', title: 'Gudstjänst', date: '2026-11-29', time: '11:00', endDate: null, endTime: null, description: null, fields: [{ name: 'Predikan', entries: [{ text: 'Johan Lind' }] }] };

    await runMutation(o, 'importEvents', { events: [event], at: 1 }, user);

    const page = await o.view<{ fields: { id: string; name: string }[] }>('eventView', { id: 'e1' });
    expect(page.fields).toMatchObject([{ id: 'e1~0', name: 'Predikan' }]);
  });
});

describe('a presentation’s event', () => {
  const linked = (o: MutationDb & { db0: DatabaseSync }, presentationId: string) => o.db0.prepare('SELECT id, title, date, time, place FROM events WHERE presentation_id = ? AND deleted_at IS NULL').all(presentationId);

  it('makes the event of a presentation made with a date', async () => {
    const o = org();

    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Gudstjänst', eventDate: '2026-11-29', time: '11:00', location: 'Kyrksalen' }, user);

    expect(linked(o, 'p1')).toEqual([{ id: 'p1', title: 'Gudstjänst', date: '2026-11-29', time: '11:00', place: 'Kyrksalen' }]);
  });

  it('makes no event for a presentation without a date', async () => {
    const o = org();

    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Välkomstbild' }, user);

    expect(linked(o, 'p1')).toEqual([]);
  });

  it('writes a date changed in the presentation to its event', async () => {
    const o = org();
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Gudstjänst', eventDate: '2026-11-29', time: '11:00' }, user);

    await runMutation(o, 'updatePresentation', { id: 'p1', eventDate: '2026-12-06', time: '18:00' }, user);

    expect(linked(o, 'p1')).toMatchObject([{ date: '2026-12-06', time: '18:00' }]);
  });

  it('makes the event when a presentation without a date gets one', async () => {
    const o = org();
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Konsert' }, user);

    await runMutation(o, 'updatePresentation', { id: 'p1', eventDate: '2026-12-12' }, user);

    expect(linked(o, 'p1')).toMatchObject([{ title: 'Konsert', date: '2026-12-12' }]);
  });

  it('lets the event go, and keeps it, when the presentation’s date is taken away', async () => {
    const o = org();
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Gudstjänst', eventDate: '2026-11-29' }, user);

    await runMutation(o, 'updatePresentation', { id: 'p1', eventDate: null }, user);

    expect([linked(o, 'p1'), o.db0.prepare('SELECT count(*) AS n FROM events').get()]).toEqual([[], { n: 1 }]);
  });

  it('makes the event of a presentation made from a template with a date', async () => {
    const o = org();
    await runMutation(o, 'createTemplate', { id: 't1', name: 'Söndag' }, admin);

    await runMutation(o, 'createFromTemplate', { id: 'p1', templateId: 't1', name: 'Söndag', eventDate: '2026-11-29', items: [], at: 1 }, user);

    expect(linked(o, 'p1')).toMatchObject([{ title: 'Söndag', date: '2026-11-29' }]);
  });

  it('gives the presentations with a date their events at the upgrade, and leaves the rest', () => {
    const o = org();
    o.db0.exec(`INSERT INTO presentations (id, name, event_date, time, location, is_template) VALUES
      ('p1', 'Gudstjänst', '2026-11-22', '11:00', 'Lundhagskyrkan', 0), ('p2', 'Utkast', NULL, NULL, NULL, 0), ('t1', 'Mall', NULL, '11:00', NULL, 1)`);

    for (const sql of orgMigrations[30]!) o.db0.exec(sql);

    expect(o.db0.prepare('SELECT id, title, date, time, place, presentation_id FROM events').all()).toEqual([
      { id: 'p1', title: 'Gudstjänst', date: '2026-11-22', time: '11:00', place: 'Lundhagskyrkan', presentation_id: 'p1' },
    ]);
  });
});
