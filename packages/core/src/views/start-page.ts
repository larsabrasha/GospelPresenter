// The start page's three views (spec 03 screen 1; Lars, 2026-11-27): Lista, what is planned by month; Kalender, a
// month of any time; Tabell, the planned (and the past, when asked) as rows of a sheet. Worked out once for every shell.
import { MutationError } from '../mutation.ts';
import { langOf, sortRows, type Key } from './lists-rows.ts';
import { presentationListView } from './lists.ts';
import { byCodePoint, byUnits } from './serde.ts';
import type { RunSql } from './sql.ts';

type Row = Record<string, unknown>;

const textOf = (p: Row, k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : undefined);
const date = (p: Row) => textOf(p, 'eventDate');
const byId = (x: Row, y: Row) => byUnits(textOf(x, 'id') ?? '', textOf(y, 'id') ?? '');
const changed = (p: Row) => (typeof p.updatedAt === 'number' ? p.updatedAt : -1);
/** Soonest first, a day by its time, no time last. */
const byWhen = (x: Row, y: Row) => byCodePoint(date(x)!, date(y)!) || byCodePoint(textOf(x, 'time') ?? '99:99', textOf(y, 'time') ?? '99:99') || byId(x, y);

function argsOf(args: unknown): Row {
  return (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Row;
}

function todayOf(a: Row): string {
  if (typeof a.today !== 'string') throw new MutationError('invalid-args', 'today');
  return a.today;
}

/** `rows` by month, `YYYY-MM`, in the order they come. */
function byMonth(rows: Row[]): { month: string; rows: Row[] }[] {
  const months: { month: string; rows: Row[] }[] = [];
  for (const p of rows) {
    const month = date(p)!.slice(0, 7);
    if (months.at(-1)?.month === month) months.at(-1)!.rows.push(p);
    else months.push({ month, rows: [p] });
  }
  return months;
}

/**
 * `startPageView` {today}: Lista. What has no date, last changed first, and what is planned, today on, soonest first
 * and a day by its time, in a list per month. The past is the calendar's: only how many (`past`). `today` is the
 * device's date, `YYYY-MM-DD`.
 */
export async function startPageView(args: unknown, sql: RunSql) {
  const today = todayOf(argsOf(args));
  const all = (await presentationListView(args, sql)) as Row[];
  const undated = all.filter((p) => !date(p)).toSorted((x, y) => changed(y) - changed(x) || byId(x, y));
  const planned = all.filter((p) => date(p) && byCodePoint(date(p)!, today) >= 0).toSorted(byWhen);
  return { undated, months: byMonth(planned), past: all.length - undated.length - planned.length };
}

/** `calendarMonthView` {month}: Kalender. The presentations of a month, `YYYY-MM`, past or planned, by day and time. */
export async function calendarMonthView(args: unknown, sql: RunSql) {
  const month = argsOf(args).month;
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new MutationError('invalid-args', 'month');
  const all = (await presentationListView(args, sql)) as Row[];
  return all.filter((p) => date(p)?.startsWith(`${month}-`)).toSorted(byWhen);
}

/** The columns Tabell sorts by, and the field each reads. */
const TABLE_SORTS: Record<string, [Key[0], string]> = {
  date: ['id', 'eventDate'],
  name: ['name', 'name'],
  location: ['name', 'location'],
  description: ['name', 'description'],
  changed: ['last', 'updatedAt'],
};

/**
 * `presentationTableView` {today, past?, sort?, desc?, locale?}: Tabell. What is planned (today on) and what has no date,
 * with the past too when `past`; by `sort` (date and time, name, location, description, changed; date by default), `desc` the other
 * way, and those without the value last either way. By date the rows are a list per month and those without a date a
 * list of their own last (`month` null); by another column one list.
 */
export async function presentationTableView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const today = todayOf(a);
  const sort = typeof a.sort === 'string' && a.sort in TABLE_SORTS ? a.sort : 'date';
  const all = ((await presentationListView(args, sql)) as Row[]).filter((p) => a.past === true || !date(p) || byCodePoint(date(p)!, today) >= 0);
  const [kind, field] = TABLE_SORTS[sort]!;
  const has = (p: Row) => (field === 'updatedAt' ? typeof p.updatedAt === 'number' : textOf(p, field) !== undefined);
  // `last` is largest first, so the latest change first is its ascending order.
  const ordered = sortRows(langOf(a), all.filter(has), [[kind, field], ...(sort === 'date' ? ([['id', 'time']] as Key[]) : []), ['name', 'name'], ['id', 'id']]);
  const rows = [...(a.desc === true ? ordered.toReversed() : ordered), ...all.filter((p) => !has(p)).toSorted((x, y) => changed(y) - changed(x) || byId(x, y))];
  if (sort !== 'date') return [{ month: undefined, rows }];
  const dated = rows.filter((p) => date(p));
  const undated = rows.filter((p) => !date(p));
  return [...byMonth(dated), ...(undated.length ? [{ month: null, rows: undated }] : [])];
}
