// A church's planning sheet as events (docs/planning.md, "Import"): a header row, the first column the date and time as
// people write them ("Sö 4/1 kl 11", "Lö 3/1-Sö4/1 kl 11-11", "12-13/9"), the second the title, every other a field.
import { EVENT_LIMITS, type FieldEntry } from './calendar.ts';
import type { ImportedEventArgs } from './mutator-args.ts';

/** A member as the import matches a cell against: their user id and full name. */
export interface SheetMember {
  id: string;
  name: string;
}

/** What a sheet gave: its events, and the rows (1-based, as the sheet numbers them) whose date did not read. */
export interface SheetEvents {
  events: ImportedEventArgs[];
  skipped: { row: number; text: string }[];
}

/** Swedish and English weekdays as people shorten them, Sunday 0. */
const WEEKDAYS: [RegExp, number][] = [
  [/^(sö|sön|söndag|su|sun|sunday)$/, 0],
  [/^(må|mån|måndag|mo|mon|monday)$/, 1],
  [/^(ti|tis|tisdag|tu|tue|tuesday)$/, 2],
  [/^(on|ons|onsdag|we|wed|wednesday)$/, 3],
  [/^(to|tor|tors|torsdag|th|thu|thursday)$/, 4],
  [/^(fr|fre|fredag|fri|friday)$/, 5],
  [/^(lö|lör|lördag|sa|sat|saturday)$/, 6],
];
const weekdayOf = (word: string) => WEEKDAYS.find(([re]) => re.test(word.toLowerCase().replace(/\.$/, '')))?.[1] ?? null;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dayOf = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
const time = (h: string, m: string | undefined) => (Number(h) <= 23 && Number(m ?? 0) <= 59 ? `${pad(Number(h))}:${m ?? '00'}` : null);

interface When {
  day: number;
  month: number;
  year: number | null;
  weekday: number | null;
  endDay: number | null;
  endMonth: number | null;
  time: string | null;
  endTime: string | null;
  note: string;
}

/** The first column read: a date (and an end date), a time (and an end time), and what is left as a note; null without a date. */
export function readWhen(cell: string): When | null {
  let rest = ` ${cell.replace(/\s+/g, ' ').trim()} `;
  const take = (re: RegExp) => {
    const m = re.exec(rest);
    if (m) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return m;
  };
  const isoDate = take(/(\d{4})-(\d{2})-(\d{2})/);
  // "3/1-Sö4/1" and "12-13/9" before a single "4/1".
  const range = isoDate ? null : take(/(\d{1,2})(?:\/(\d{1,2}))?\s*[-–]\s*(?:[a-zåäö]+\.?\s*)?(\d{1,2})\/(\d{1,2})/i);
  const single = isoDate || range ? null : take(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  const clock = take(/\bkl\.?\s*(\d{1,2})(?:[.:](\d{2}))?(?:\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?)?/i);
  const words = rest.trim().split(' ').filter(Boolean);
  const weekdayAt = words.findIndex((w) => weekdayOf(w) !== null);
  const weekday = weekdayAt >= 0 ? weekdayOf(words[weekdayAt]!) : null;
  if (weekdayAt >= 0) words.splice(weekdayAt, 1);
  let when: Omit<When, 'time' | 'endTime' | 'note' | 'weekday'>;
  if (isoDate) when = { year: Number(isoDate[1]), month: Number(isoDate[2]), day: Number(isoDate[3]), endDay: null, endMonth: null };
  else if (range) when = { day: Number(range[1]), month: Number(range[2] ?? range[4]), year: null, endDay: Number(range[3]), endMonth: Number(range[4]) };
  else if (single) {
    const y = single[3] ? Number(single[3]) : null;
    when = { day: Number(single[1]), month: Number(single[2]), year: y !== null && y < 100 ? 2000 + y : y, endDay: null, endMonth: null };
  } else return null;
  const start = clock ? time(clock[1]!, clock[2]) : null;
  const end = clock?.[3] ? time(clock[3], clock[4]) : null;
  return { ...when, weekday, time: start, endTime: end, note: words.join(' ').replace(/^[,;.\s]+|[,;\s]+$/g, '') };
}

/**
 * The year a date without one has: of the years around the date before it, the one whose weekday is the one written,
 * else the nearest that does not go back more than a month (a sheet runs forward in time).
 */
function yearOf(w: When, previous: string): number {
  if (w.year !== null) return w.year;
  const y0 = Number(previous.slice(0, 4));
  const candidates = [y0 - 1, y0, y0 + 1].filter((y) => valid(y, w.month, w.day));
  const near = (y: number) => Math.abs(dayOf(iso(y, w.month, w.day)) - dayOf(previous));
  if (w.weekday !== null) {
    const matching = candidates.filter((y) => new Date(Date.UTC(y, w.month - 1, w.day)).getUTCDay() === w.weekday);
    if (matching.length) return matching.reduce((a, b) => (near(b) < near(a) ? b : a));
  }
  const forward = candidates.filter((y) => dayOf(iso(y, w.month, w.day)) >= dayOf(previous) - 31 * 86400000);
  return (forward.length ? forward : candidates).reduce((a, b) => (near(b) < near(a) ? b : a), forward[0] ?? y0);
}

/** A cell as entries: a member when it is exactly their name, else text; "-----" as "–"; stray separators at its ends gone. */
function entriesOf(cell: string, members: Map<string, SheetMember>): FieldEntry[] {
  const text = cell
    .replace(/\s+/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .slice(0, EVENT_LIMITS.entry);
  if (!text) return [];
  if (/^[-–—]+$/.test(text)) return [{ text: '–' }];
  const member = members.get(text.toLowerCase());
  return [member ? { person: member.id, name: member.name } : { text }];
}

/**
 * The sheet's events: the first row with anything in it is the header; a row after it with a date is an event, one with
 * something but no date that reads is skipped. `today` (`YYYY-MM-DD`) is where the years start from; `newId` names each.
 */
export function eventsFromSheet(rows: string[][], opts: { today: string; members: SheetMember[]; newId: () => string }): SheetEvents {
  const members = new Map(opts.members.map((m) => [m.name.trim().toLowerCase(), m]));
  const headerAt = rows.findIndex((r) => r.some((c) => c.trim()));
  const header = headerAt >= 0 ? rows[headerAt]!.map((h) => h.trim().slice(0, EVENT_LIMITS.fieldName)) : [];
  const out: SheetEvents = { events: [], skipped: [] };
  let previous = opts.today;
  rows.forEach((row, i) => {
    if (i <= headerAt || !row.some((c) => c.trim())) return;
    const w = readWhen(row[0] ?? '');
    if (!w || !valid(2000, w.month, w.day)) return void out.skipped.push({ row: i + 1, text: row.filter((c) => c.trim()).join(' · ') });
    const year = yearOf(w, previous);
    const date = iso(year, w.month, w.day);
    if (!valid(year, w.month, w.day)) return void out.skipped.push({ row: i + 1, text: row[0] ?? '' });
    previous = date;
    let endDate: string | null = null;
    if (w.endDay !== null && w.endMonth !== null) {
      const endYear = w.endMonth < w.month ? year + 1 : year;
      const end = iso(endYear, w.endMonth, w.endDay);
      endDate = valid(endYear, w.endMonth, w.endDay) && end > date ? end : null;
    }
    const fields = header.flatMap((name, c) => (c < 2 || !name ? [] : [{ name, entries: entriesOf(row[c] ?? '', members) }])).filter((f) => f.entries.length);
    out.events.push({
      id: opts.newId(),
      title: (row[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, EVENT_LIMITS.title),
      date,
      time: w.time,
      endDate,
      endTime: w.endTime,
      description: w.note || null,
      fields: fields.slice(0, EVENT_LIMITS.fieldsPerEvent),
    });
  });
  return out;
}
