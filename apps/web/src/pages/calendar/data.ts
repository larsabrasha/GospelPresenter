// What the calendar's pages read (docs/planning.md): the core's views of events, and the members a field may name,
// from the server, kept for offline on this device.
import type { FieldEntry, Visibility } from '@gp/core';
import { useEffect, useState } from 'react';
import { api } from '../../auth/api.ts';
import type { ReadDb } from '../../db/share.ts';
import { t } from '../../i18n.ts';
import { fullDate } from '../dashboard.ts';

/** The tables the calendar's views read: a page reads again when one of them changes. */
export const CALENDAR_READS = ['events', 'event_fields', 'presentations', 'presentation_items'];

export interface EventRow {
  id: string;
  title: string;
  date: string | null;
  time: string | null;
  endDate: string | null;
  endTime: string | null;
  place: string | null;
  description: string | null;
  visibility: Visibility;
  busyWord: string | null;
  presentation: { id: string; name: string } | null;
}
/** What the start page's filters read of a row: how many fields are missing someone, its members, its words. */
export type Facets = { missing: number; persons: string[]; search: string };
export type ListRow = EventRow & Facets & { filled: { name: string; text: string }[] };
type Cell = { id: string; entries: FieldEntry[] };
export type TableData = { columns: string[]; rows: (EventRow & Facets & { cells: Record<string, Cell> })[] };
/** Which events a view reads: the coming or the past, a month's, or all of them (a search). */
export type Scope = { today: string; past: boolean } | { month: string } | { all: true };
export type EventField = { id: string; name: string; entries: FieldEntry[] };
export type EventPage = Omit<EventRow, 'presentation'> & {
  presentation: { id: string; name: string; items: number } | null;
  isTemplate: boolean;
  deletedAt: number | null;
  fields: EventField[];
};
export type Suggestions = { titles: string[]; places: string[]; fieldNames: string[]; texts: Record<string, string[]> };

export const calendarList = (db: ReadDb, scope: Scope) => db.view<ListRow[]>('calendarListView', scope);
export const calendarTable = (db: ReadDb, scope: Scope) => db.view<TableData>('calendarTableView', scope);

/** The start page's filters (docs/planning.md, "One list"): each one on narrows the rows; all of them together. */
export interface StartFilter {
  presentation: boolean;
  missing: boolean;
  mine: boolean;
  /** What is typed in the search, every word to be found. */
  query: string;
  /** A day picked in Kalender, `YYYY-MM-DD`. */
  day: string | null;
}

/** Whether row `e` passes filter `f`, for the member `userId` (Mina). */
export const passes = (f: StartFilter, userId: string) => (e: EventRow & Facets) => {
  const words = f.query.toLocaleLowerCase('sv').split(/\s+/).filter(Boolean);
  return (
    (!f.presentation || !!e.presentation) &&
    (!f.missing || e.missing > 0) &&
    (!f.mine || e.persons.includes(userId)) &&
    words.every((w) => e.search.includes(w)) &&
    (!f.day || e.date === f.day)
  );
};
export const eventPage = (db: ReadDb, id: string) => db.view<EventPage | null>('eventView', { id });
export const eventTemplates = (db: ReadDb) => db.view<(EventRow & { fields: string[] })[]>('eventTemplatesView', {});
export const eventSuggestions = (db: ReadDb) => db.view<Suggestions>('eventSuggestionsView', {});
export const personEvents = (db: ReadDb, person: string, today: string) => db.view<(EventRow & { fields: string[] })[]>('personEventsView', { person, today });
export const presentationEvent = (db: ReadDb, presentationId: string) => db.view<EventRow | null>('presentationEventView', { presentationId });

/** "kl 11–12", "kl 11", or two days' start and end. */
export function whenText(e: Pick<EventRow, 'time' | 'endDate' | 'endTime'>): string {
  // No time is all day, as iOS's Calendar has it (docs/planning.md).
  const time = e.time ? `${e.time}${e.endTime && !e.endDate ? `–${e.endTime}` : ''}` : t('event.allDay');
  if (e.endDate) return `${time} – ${fullDate(e.endDate, false)}${e.time && e.endTime ? ` ${e.endTime}` : ''}`;
  return time;
}

/** The fields Ny händelse gives when the organisation has no template yet (docs/planning.md, "Templates"). */
export const DEFAULT_FIELDS = ['Mötesledning', 'Predikan', 'Musik', 'Ljud', 'Bild'];

// ------------------------------------------------------------------ the members

export interface Person {
  id: string;
  name: string;
}

const KEY = 'gp-people';
let people: Person[] | null = null;
let asking: Promise<Person[]> | null = null;

function stored(): Person[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Person[]) : [];
  } catch {
    return [];
  }
}

/** The organisation's members, from the server, else as this device last had them (offline). */
export function loadPeople(): Promise<Person[]> {
  asking ??= api<Person[]>('GET', '/api/people')
    .then((r) => {
      if (r.error || !Array.isArray(r.body)) return stored();
      people = r.body;
      try {
        localStorage.setItem(KEY, JSON.stringify(r.body));
      } catch {
        // storage refused: they are asked for again next time
      }
      return r.body;
    })
    .catch(() => stored())
    .finally(() => (asking = null));
  return asking;
}

/** The members, as last known at once and then from the server. */
export function usePeople(): Person[] {
  const [list, setList] = useState<Person[]>(() => people ?? stored());
  useEffect(() => {
    let live = true;
    void loadPeople().then((p) => live && setList(p));
    return () => {
      live = false;
    };
  }, []);
  return list;
}
