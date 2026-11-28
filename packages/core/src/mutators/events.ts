import { and, asc, count, eq, isNotNull, isNull, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_LIMITS, VISIBILITIES } from '../calendar.ts';
import { eventFields, events, presentations } from '../schema.ts';
import { id, limit, MutationError, name, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { eventDescription, eventLocation, eventTime } from './presentations.ts';

// ------------------------------------------------------------------ the calendar (docs/planning.md)

const isoDate = z.iso.date();
const title = z.string().trim().max(EVENT_LIMITS.title);
const visibility = z.enum(VISIBILITIES);
const busyWord = optionalText(EVENT_LIMITS.busyWord);
const fieldName = z.string().trim().min(1).max(EVENT_LIMITS.fieldName);
const entryText = z.string().trim().min(1).max(EVENT_LIMITS.entry);
/** A name in a field: text, or a member picked, with their name then. */
const fieldEntry = z.union([z.strictObject({ text: entryText }), z.strictObject({ person: id, name: entryText })]);
const entries = z.array(fieldEntry).max(EVENT_LIMITS.entriesPerField);

/** When and where, and what it is about: each optional on a change, a null clearing it. */
const details = {
  title: title.optional(),
  time: eventTime.optional(),
  endDate: isoDate.nullable().optional(),
  endTime: eventTime.optional(),
  place: eventLocation.optional(),
  description: eventDescription.optional(),
  visibility: visibility.optional(),
  busyWord: busyWord.optional(),
};

type EventRow = typeof events.$inferSelect;

async function eventOf(tx: Tx, eventId: string): Promise<EventRow | undefined> {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  return row;
}

/** The event to change, if there is one, by one who may: a template's by those who manage templates. */
async function editable(tx: Tx, eventId: string, ctx: MutatorCtx): Promise<EventRow | undefined> {
  const row = await eventOf(tx, eventId);
  requirePermission(ctx, row?.isTemplate ? 'ManageTemplates' : 'ManageEvents');
  return row;
}

/** The linked presentation takes the event's date, time and place (docs/planning.md, "One date"). */
async function followPresentation(tx: Tx, row: EventRow, at: number) {
  if (!row.presentationId || row.isTemplate) return;
  await tx
    .update(presentations)
    .set({ eventDate: row.date, time: row.time, location: row.place, updatedAt: at })
    .where(and(eq(presentations.id, row.presentationId), eq(presentations.isTemplate, false)));
}

async function nextSort(tx: Tx, eventId: string): Promise<{ n: number; sort: number }> {
  const [r] = await tx.select({ n: count(), last: max(eventFields.sort) }).from(eventFields).where(eq(eventFields.eventId, eventId));
  return { n: r?.n ?? 0, sort: (r?.last ?? -1) + 1 };
}

export const createEventArgs = z
  .object({ id, ...details, title, date: isoDate.nullable(), isTemplate: z.boolean().optional(), template: id.optional(), at: z.number().int() })
  .refine((a) => (a.isTemplate ? a.date === null : a.date !== null), 'an event has a date, a template none');
/**
 * Ny händelse, or a new template: a template given is copied, its fields with it (ids `{id}~{field id}`, the same on
 * every device), and what the arguments name wins over it. Nothing links the event to its template afterwards.
 */
export async function createEvent(tx: Tx, a: z.output<typeof createEventArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, a.isTemplate ? 'ManageTemplates' : 'ManageEvents');
  if (await eventOf(tx, a.id)) return;
  const [n] = await tx
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.isTemplate, a.isTemplate ?? false), isNull(events.deletedAt)));
  limit((n?.n ?? 0) >= (a.isTemplate ? EVENT_LIMITS.templates : EVENT_LIMITS.events), a.isTemplate ? 'templates' : 'events');
  const from = a.template ? await eventOf(tx, a.template) : undefined;
  const t = from?.isTemplate && from.deletedAt === null ? from : undefined;
  const pick = <K extends keyof typeof details>(k: K) => (a[k] !== undefined ? a[k] : (t?.[k] ?? null));
  await tx.insert(events).values({
    id: a.id,
    title: a.title,
    date: a.date,
    time: pick('time'),
    endDate: a.endDate ?? null,
    endTime: pick('endTime'),
    place: pick('place'),
    description: pick('description'),
    visibility: a.visibility ?? (t?.visibility as typeof a.visibility) ?? 'hidden',
    busyWord: pick('busyWord'),
    presentationId: null,
    isTemplate: a.isTemplate ?? false,
    deletedAt: null,
    updatedAt: a.at,
  });
  if (!t) return;
  const fields = await tx.select().from(eventFields).where(eq(eventFields.eventId, t.id)).orderBy(asc(eventFields.sort));
  for (const f of fields) await tx.insert(eventFields).values({ ...f, id: `${a.id}~${f.id}`, eventId: a.id });
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

/**
 * The end a moved start takes, as Apple's and Google's calendars move it (Lars, 2026-11-28): a start time moved moves
 * the end time as far, unless the change names the end itself or the end would pass midnight (then it stays); a date
 * moved moves the end date as far. Nothing for an event without an end.
 */
function keepLength(row: EventRow, change: { time?: string | null; endTime?: string | null; date?: string; endDate?: string | null }) {
  const out: { endTime?: string; endDate?: string } = {};
  if (change.time && change.endTime === undefined && row.time && row.endTime) {
    const end = minutes(row.endTime) + minutes(change.time) - minutes(row.time);
    if (end >= 0 && end < 24 * 60) out.endTime = hhmm(end);
  }
  if (change.date && change.endDate === undefined && row.date && row.endDate) {
    const end = new Date((dayNumber(row.endDate) + dayNumber(change.date) - dayNumber(row.date)) * 86400000);
    out.endDate = end.toISOString().slice(0, 10);
  }
  return out;
}

export const updateEventArgs = z.object({ id, ...details, date: isoDate.optional(), at: z.number().int() });
/**
 * Sets the fields it names; the end moves with a start moved, so the length stays (`keepLength`); the linked
 * presentation follows the date, time and place. A template has no date.
 */
export async function updateEvent(tx: Tx, a: z.output<typeof updateEventArgs>, ctx: MutatorCtx) {
  const row = await editable(tx, a.id, ctx);
  if (!row) return;
  const { id: eventId, at, ...fields } = a;
  if (row.isTemplate && fields.date !== undefined) throw new MutationError('invalid-args', 'a template has no date');
  const set = { ...keepLength(row, fields), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  await tx
    .update(events)
    .set({ ...set, updatedAt: at })
    .where(eq(events.id, eventId));
  if (['date', 'time', 'place'].some((k) => k in set)) await followPresentation(tx, { ...row, ...set } as EventRow, at);
}

export const trashEventArgs = z.object({ id, at: z.number().int() });
/** To the trash; its presentation stays, linked, and keeps its date. */
export async function trashEvent(tx: Tx, a: z.output<typeof trashEventArgs>, ctx: MutatorCtx) {
  if (await editable(tx, a.id, ctx)) await tx.update(events).set({ deletedAt: a.at }).where(eq(events.id, a.id));
}

export const restoreEventArgs = z.object({ id });
export async function restoreEvent(tx: Tx, a: z.output<typeof restoreEventArgs>, ctx: MutatorCtx) {
  if (await editable(tx, a.id, ctx)) await tx.update(events).set({ deletedAt: null }).where(eq(events.id, a.id));
}

export const purgeEventArgs = z.object({ id });
/** Deleted for good, its fields with it: only an event in the trash where this runs. */
export async function purgeEvent(tx: Tx, a: z.output<typeof purgeEventArgs>, ctx: MutatorCtx) {
  const row = await editable(tx, a.id, ctx);
  if (!row) return;
  if (row.deletedAt === null) throw new MutationError('not-in-trash', 'only an event in the trash is deleted for good');
  await deleteEventRows(tx, a.id);
}

async function deleteEventRows(tx: Tx, eventId: string) {
  await tx.delete(eventFields).where(eq(eventFields.eventId, eventId));
  await tx.delete(events).where(eq(events.id, eventId));
}

/** The trashed events of a kind, at or before `cutoff`, deleted for good (the trash's purge). */
export async function purgeTrashedEvents(tx: Tx, isTemplate: boolean, cutoff: number) {
  const expired = await tx
    .select({ id: events.id, deletedAt: events.deletedAt })
    .from(events)
    .where(and(eq(events.isTemplate, isTemplate), isNotNull(events.deletedAt)));
  for (const e of expired) if ((e.deletedAt ?? 0) <= cutoff) await deleteEventRows(tx, e.id);
}

// ------------------------------------------------------------------ fields ("Vem gör vad")

export const addEventFieldArgs = z.object({ id, eventId: id, name: fieldName, entries: entries.optional() });
/** A field last on the event, empty unless entries are given. */
export async function addEventField(tx: Tx, a: z.output<typeof addEventFieldArgs>, ctx: MutatorCtx) {
  if (!(await editable(tx, a.eventId, ctx))) return;
  const [existing] = await tx.select({ id: eventFields.id }).from(eventFields).where(eq(eventFields.id, a.id));
  if (existing) return;
  const { n, sort } = await nextSort(tx, a.eventId);
  limit(n >= EVENT_LIMITS.fieldsPerEvent, 'fields');
  await tx.insert(eventFields).values({ id: a.id, eventId: a.eventId, name: a.name, sort, entries: JSON.stringify(a.entries ?? []) });
}

/** The field and the event it is on, by one who may change that event. */
async function editableField(tx: Tx, fieldId: string, ctx: MutatorCtx) {
  const [field] = await tx.select().from(eventFields).where(eq(eventFields.id, fieldId));
  if (!field) return undefined;
  return (await editable(tx, field.eventId, ctx)) ? field : undefined;
}

export const updateEventFieldArgs = z.object({ id, name: fieldName.optional(), entries: entries.optional() });
/** Its name, what is in it, or both; the entries are written whole. */
export async function updateEventField(tx: Tx, a: z.output<typeof updateEventFieldArgs>, ctx: MutatorCtx) {
  if (!(await editableField(tx, a.id, ctx))) return;
  const set = { ...(a.name !== undefined ? { name: a.name } : {}), ...(a.entries !== undefined ? { entries: JSON.stringify(a.entries) } : {}) };
  if (Object.keys(set).length) await tx.update(eventFields).set(set).where(eq(eventFields.id, a.id));
}

export const moveEventFieldArgs = z.object({ id, to: z.number().int().min(0) });
/** Moves a field to the position `to` among its event's (past the end is last). */
export async function moveEventField(tx: Tx, a: z.output<typeof moveEventFieldArgs>, ctx: MutatorCtx) {
  const field = await editableField(tx, a.id, ctx);
  if (!field) return;
  const all = await tx.select({ id: eventFields.id, sort: eventFields.sort }).from(eventFields).where(eq(eventFields.eventId, field.eventId)).orderBy(asc(eventFields.sort), asc(eventFields.id));
  const order = all.filter((f) => f.id !== a.id);
  order.splice(Math.min(a.to, order.length), 0, { id: a.id, sort: field.sort });
  for (const [i, f] of order.entries()) if (all.find((x) => x.id === f.id)?.sort !== i) await tx.update(eventFields).set({ sort: i }).where(eq(eventFields.id, f.id));
}

export const removeEventFieldArgs = z.object({ id });
export async function removeEventField(tx: Tx, a: z.output<typeof removeEventFieldArgs>, ctx: MutatorCtx) {
  if (await editableField(tx, a.id, ctx)) await tx.delete(eventFields).where(eq(eventFields.id, a.id));
}

// ------------------------------------------------------------------ the link to a presentation

/** A presentation that is not a template, in or out of the trash, else `presentation-missing`. */
async function presentationOf(tx: Tx, presentationId: string) {
  const [p] = await tx.select().from(presentations).where(and(eq(presentations.id, presentationId), eq(presentations.isTemplate, false)));
  if (!p) throw new MutationError('presentation-missing', 'no such presentation');
  return p;
}

/** Links the event to the presentation, which leaves any other event it was linked to; the presentation follows the event. */
async function link(tx: Tx, row: EventRow, presentationId: string, at: number) {
  await tx
    .update(events)
    .set({ presentationId: null, updatedAt: at })
    .where(and(eq(events.presentationId, presentationId), ne(events.id, row.id)));
  await tx.update(events).set({ presentationId, updatedAt: at }).where(eq(events.id, row.id));
  await followPresentation(tx, { ...row, presentationId }, at);
}

export const linkEventPresentationArgs = z.object({ eventId: id, presentationId: id.nullable(), at: z.number().int() });
/** Links an event and a presentation, or (null) unlinks it: the presentation then keeps the date it had. */
export async function linkEventPresentation(tx: Tx, a: z.output<typeof linkEventPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const row = await editable(tx, a.eventId, ctx);
  if (!row || row.isTemplate) return;
  if (a.presentationId === null) await tx.update(events).set({ presentationId: null, updatedAt: a.at }).where(eq(events.id, a.eventId));
  else await link(tx, row, (await presentationOf(tx, a.presentationId)).id, a.at);
}

export const createPresentationForEventArgs = z.object({ eventId: id, presentationId: id, name, at: z.number().int() });
/** Skapa presentation: a presentation named `name` (the event's title, or a word for one without), linked. */
export async function createPresentationForEvent(tx: Tx, a: z.output<typeof createPresentationForEventArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const row = await editable(tx, a.eventId, ctx);
  if (!row || row.isTemplate) return;
  // A presentation linked and still there stays; one gone or in the trash is replaced, as the event shows none.
  if (row.presentationId) {
    const [p] = await tx.select({ deletedAt: presentations.deletedAt }).from(presentations).where(eq(presentations.id, row.presentationId));
    if (p && p.deletedAt === null) return;
  }
  await tx.insert(presentations).values({ id: a.presentationId, name: a.name, updatedAt: a.at }).onConflictDoNothing();
  await link(tx, row, a.presentationId, a.at);
}

export const createEventFromPresentationArgs = z.object({ presentationId: id, eventId: id, at: z.number().int() });
/** Lägg i kalendern: an event of the presentation's name, date, time and place, linked; only for one with a date. */
export async function createEventFromPresentation(tx: Tx, a: z.output<typeof createEventFromPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageEvents');
  const p = await presentationOf(tx, a.presentationId);
  if (!p.eventDate) throw new MutationError('invalid-args', 'the presentation has no date');
  const [linked] = await tx.select({ id: events.id }).from(events).where(and(eq(events.presentationId, p.id), isNull(events.deletedAt)));
  if (linked || (await eventOf(tx, a.eventId))) return;
  await createEvent(tx, { id: a.eventId, title: p.name.slice(0, EVENT_LIMITS.title), date: p.eventDate, time: p.time, place: p.location, at: a.at }, ctx);
  // One in the trash lets it go, so restoring that one does not give the presentation two events.
  await tx.update(events).set({ presentationId: null }).where(eq(events.presentationId, p.id));
  await tx.update(events).set({ presentationId: p.id }).where(eq(events.id, a.eventId));
}

// ------------------------------------------------------------------ the import

const importedEvent = z.object({
  id,
  title,
  date: isoDate,
  time: eventTime,
  endDate: isoDate.nullable(),
  endTime: eventTime,
  description: eventDescription,
  fields: z.array(z.object({ name: fieldName, entries })).max(EVENT_LIMITS.fieldsPerEvent),
});
export const importEventsArgs = z.object({ events: z.array(importedEvent).max(EVENT_LIMITS.importAtOnce), at: z.number().int() });
/** Importera från Excel: the events read from a sheet, their fields ids `{id}~{n}`; an id already here is left alone. */
export async function importEvents(tx: Tx, a: z.output<typeof importEventsArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageEvents');
  for (const e of a.events) {
    if (await eventOf(tx, e.id)) continue;
    await createEvent(tx, { id: e.id, title: e.title, date: e.date, time: e.time, endDate: e.endDate, endTime: e.endTime, description: e.description, at: a.at }, ctx);
    for (const [i, f] of e.fields.entries()) await tx.insert(eventFields).values({ id: `${e.id}~${i}`, eventId: e.id, name: f.name, sort: i, entries: JSON.stringify(f.entries) });
  }
}
