// The calendar's views (docs/planning.md): Kalender's Lista and Tabell, an event's page, the templates, what typing in a
// field offers, a person's coming events, and the event a presentation is linked to. Worked out once for every shell.
import { entryText, isMissing, type FieldEntry } from '../calendar.ts';
import { MutationError } from '../mutation.ts';
import { argsOf, idOf, isObj, type Obj } from './serde.ts';
import type { RunSql } from './sql.ts';

const EVENT_COLUMNS = 'e.id, e.title, e.date, e.time, e.end_date, e.end_time, e.place, e.description, e.visibility, e.busy_word, e.presentation_id, e.updated_at';
/** The linked presentation's name, when it is there and out of the trash. */
const PRESENTATION_NAME = '(SELECT p.name FROM presentations p WHERE p.id = e.presentation_id AND p.deleted_at IS NULL)';

/** An event's row: its fields as the shells name them, and its presentation, if it is there. */
function eventRow(r: unknown[]) {
  const [id, title, date, time, endDate, endTime, place, description, visibility, busyWord, presentationId, updatedAt, presentationName] = r;
  const presentation = presentationId && typeof presentationName === 'string' ? { id: presentationId, name: presentationName } : null;
  return { id, title, date, time, endDate, endTime, place, description, visibility, busyWord, presentation, updatedAt };
}

/** A field's entries as stored, those that do not read left out. */
function entriesOf(json: unknown): FieldEntry[] {
  let v: unknown;
  try {
    v = typeof json === 'string' ? JSON.parse(json) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is FieldEntry => isObj(e) && (typeof e.text === 'string' || (typeof e.person === 'string' && typeof e.name === 'string')));
}

type Field = { id: string; eventId: string; name: string; entries: FieldEntry[] };

/** The fields by the event they are on (Map.groupBy, which older Safari lacks). */
function byEventId(fields: Field[], key: (f: Field) => string): Map<string, Field[]> {
  const m = new Map<string, Field[]>();
  for (const f of fields) m.set(key(f), [...(m.get(key(f)) ?? []), f]);
  return m;
}

/** The fields of the events `ids`, in each event's order. */
async function fieldsOf(sql: RunSql, where: string, params: unknown[]): Promise<Field[]> {
  const rows = await sql(`SELECT f.id, f.event_id, f.name, f.entries FROM event_fields f JOIN events e ON e.id = f.event_id WHERE ${where} ORDER BY f.event_id, f.sort, f.id`, params);
  return rows.map((r) => ({ id: String(r[0]), eventId: String(r[1]), name: String(r[2]), entries: entriesOf(r[3]) }));
}

/** `today` (`YYYY-MM-DD`) and whether the past is asked for: coming events from today on, the past newest first. */
type When = { where: string; order: string; params: unknown[] };

function when(a: Obj): When {
  // A month, `YYYY-MM`, past or coming: Kalender's (`calendarMonthEventsView`).
  if (typeof a.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(a.month)) throw new MutationError('invalid-args', 'month');
    return { where: "e.is_template = 0 AND e.deleted_at IS NULL AND substr(e.date, 1, 7) = ?", order: "e.date, COALESCE(e.time, ''), e.title", params: [a.month] };
  }
  // Every event, past or coming, oldest first: what a search on the start page looks through.
  if (a.all === true) return { where: 'e.is_template = 0 AND e.deleted_at IS NULL', order: "e.date, COALESCE(e.time, ''), e.title", params: [] };
  const today = a.today;
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new MutationError('invalid-args', 'today');
  const past = a.past === true;
  return {
    where: `e.is_template = 0 AND e.deleted_at IS NULL AND ${past ? 'COALESCE(e.end_date, e.date) < ?' : 'COALESCE(e.end_date, e.date) >= ?'}`,
    order: past ? 'e.date DESC, e.time DESC, e.title' : "e.date, COALESCE(e.time, ''), e.title",
    params: [today],
  };
}

async function eventsAndFields(sql: RunSql, args: unknown) {
  const w = when(argsOf(args));
  const rows = (await sql(`SELECT ${EVENT_COLUMNS}, ${PRESENTATION_NAME} FROM events e WHERE ${w.where} ORDER BY ${w.order}`, w.params)).map(eventRow);
  const fields = await fieldsOf(sql, w.where, w.params);
  const byEvent = byEventId(fields, (f) => f.eventId);
  return rows.map((e) => {
    const own = byEvent.get(String(e.id)) ?? [];
    return { e: { ...e, ...facets(e, own) }, fields: own };
  });
}

/**
 * What the start page's filters read (docs/planning.md, "One list"): the members in an event's fields, for Mina, and
 * its words, lower case, for the search: its title, place and description, and what its fields say.
 */
function facets(e: ReturnType<typeof eventRow>, fields: Field[]) {
  const entries = fields.flatMap((f) => f.entries);
  const persons = [...new Set(entries.flatMap((x) => ('person' in x ? [x.person] : [])))];
  const words = [e.title, e.place, e.description, ...entries.map(entryText)].filter((w) => typeof w === 'string' && w);
  return { persons, search: words.join(' ').toLocaleLowerCase('sv') };
}

/**
 * `calendarListView` {today, past?}, {month} or {all}: Lista, Kalender's month or a search's (the start page's,
 * docs/planning.md): each event with the first two fields that hold something (their name and what they say), how many
 * are missing someone, its members and its words for the filters.
 */
export async function calendarListView(args: unknown, sql: RunSql) {
  return (await eventsAndFields(sql, args)).map(({ e, fields }) => ({
    ...e,
    filled: fields
      .filter((f) => !isMissing(f.entries))
      .slice(0, 2)
      .map((f) => ({ name: f.name, text: f.entries.map(entryText).join(', ') })),
    missing: fields.filter((f) => isMissing(f.entries)).length,
  }));
}

/**
 * `calendarTableView` {today, past?}, {month} or {all}: Tabell: a column per field name among the events, in the order they first come,
 * and each event's cells by name (the field's id and entries; no cell where the event has no field of that name).
 */
export async function calendarTableView(args: unknown, sql: RunSql) {
  const all = await eventsAndFields(sql, args);
  const columns = [...new Set(all.flatMap(({ fields }) => fields.map((f) => f.name)))];
  const rows = all.map(({ e, fields }) => ({
    ...e,
    missing: fields.filter((f) => isMissing(f.entries)).length,
    cells: Object.fromEntries(fields.map((f) => [f.name, { id: f.id, entries: f.entries }])),
  }));
  return { columns, rows };
}

/** `eventView` {id}: an event's or a template's page: it, its fields in order, its presentation's name and items. */
export async function eventView(args: unknown, sql: RunSql) {
  const eventId = idOf(argsOf(args), 'id');
  const [r] = await sql(`SELECT ${EVENT_COLUMNS}, ${PRESENTATION_NAME}, e.is_template, e.deleted_at FROM events e WHERE e.id = ?`, [eventId]);
  if (!r) return null;
  const e = eventRow(r);
  const fields = (await fieldsOf(sql, 'e.id = ?', [eventId])).map(({ id, name, entries }) => ({ id, name, entries }));
  const items = e.presentation ? Number((await sql('SELECT count(*) FROM presentation_items WHERE presentation_id = ?', [e.presentation.id]))[0]?.[0] ?? 0) : 0;
  return { ...e, presentation: e.presentation ? { ...e.presentation, items } : null, isTemplate: Boolean(r[13]), deletedAt: r[14] ?? null, fields };
}

/** `eventTemplatesView`: the templates out of the trash, by title, each with its fields' names, for Ny händelse and Mallar. */
export async function eventTemplatesView(args: unknown, sql: RunSql) {
  argsOf(args);
  const where = 'e.is_template = 1 AND e.deleted_at IS NULL';
  const rows = (await sql(`SELECT ${EVENT_COLUMNS}, NULL FROM events e WHERE ${where} ORDER BY e.title, e.id`, [])).map(eventRow);
  const byEvent = byEventId(await fieldsOf(sql, where, []), (f) => f.eventId);
  return rows.map((e) => ({ ...e, fields: (byEvent.get(String(e.id)) ?? []).map((f) => f.name) }));
}

/** The distinct texts of a column, most used first, then alphabetical. */
async function distinct(sql: RunSql, query: string): Promise<string[]> {
  return (await sql(`SELECT v FROM (${query}) WHERE v IS NOT NULL AND v <> '' GROUP BY v ORDER BY count(*) DESC, v`, [])).map((r) => String(r[0]));
}

/**
 * `eventSuggestionsView`: what typing offers: the titles and places written before, the field names, and by field name
 * the texts written in fields of that name (persons are offered from the members, not here).
 */
export async function eventSuggestionsView(args: unknown, sql: RunSql) {
  argsOf(args);
  const live = 'deleted_at IS NULL';
  const texts: Record<string, string[]> = {};
  const counts = new Map<string, Map<string, number>>();
  for (const [name, json] of await sql(`SELECT f.name, f.entries FROM event_fields f JOIN events e ON e.id = f.event_id WHERE e.${live}`, [])) {
    const m = counts.get(String(name)) ?? new Map<string, number>();
    for (const e of entriesOf(json)) if ('text' in e) m.set(e.text, (m.get(e.text) ?? 0) + 1);
    counts.set(String(name), m);
  }
  for (const [name, m] of counts) texts[name] = [...m].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv')).map(([t]) => t);
  return {
    titles: await distinct(sql, `SELECT title AS v FROM events WHERE ${live} AND is_template = 0`),
    places: await distinct(sql, `SELECT place AS v FROM events WHERE ${live}`),
    fieldNames: await distinct(sql, `SELECT f.name AS v FROM event_fields f JOIN events e ON e.id = f.event_id WHERE e.${live}`),
    texts,
  };
}

/** `personEventsView` {person, today}: a member's coming events and the fields they are in, for the person's view. */
export async function personEventsView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const person = idOf(a, 'person');
  return (await eventsAndFields(sql, { today: a.today }))
    .map(({ e, fields }) => ({ ...e, fields: fields.filter((f) => f.entries.some((x) => 'person' in x && x.person === person)).map((f) => f.name) }))
    .filter((e) => e.fields.length > 0);
}

/** `presentationEventView` {presentationId}: the event a presentation is linked to (out of the trash), or null. */
export async function presentationEventView(args: unknown, sql: RunSql) {
  const presentationId = idOf(argsOf(args), 'presentationId');
  const [r] = await sql(`SELECT ${EVENT_COLUMNS}, NULL FROM events e WHERE e.presentation_id = ? AND e.is_template = 0 AND e.deleted_at IS NULL`, [presentationId]);
  return r ? eventRow(r) : null;
}
