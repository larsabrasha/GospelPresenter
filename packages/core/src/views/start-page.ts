// The start page's lists (ADR 0008; ported back from crates/gp-core/src/page_models.rs `start_page`): spec 03 screen
// 1, dashboard.ts's `groupPresentations`, worked out once for every shell.
import { MutationError } from '../mutation.ts';
import { presentationListView } from './lists.ts';
import { byCodePoint } from './serde.ts';
import type { RunSql } from './sql.ts';

type Row = Record<string, unknown>;

const textOf = (p: Row, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
/** Strings as JavaScript's `<` orders them: by UTF-16 code units. */
const jsCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `startPageView` {today}: Idag by time (no time last), Kommande soonest first, and the rest, past and undated alike,
 * last changed first; id last, so the order is total. Each row is the presentation with its number of items
 * (`itemCount`); each list says whether its rows show their date and its year (Idag neither, Kommande the date, the
 * rest both). An empty list is left out. `today` is the device's date, `YYYY-MM-DD`.
 */
export async function startPageView(args: unknown, sql: RunSql) {
  const a = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Row;
  if (typeof a.today !== 'string') throw new MutationError('invalid-args', 'today');
  const today = a.today;
  const all = (await presentationListView(args, sql)) as Row[];
  const counts = await sql('SELECT presentation_id AS id, COUNT(*) AS n FROM presentation_items GROUP BY presentation_id', []);
  for (const p of all) p.itemCount = counts.find((c) => c[0] === p.id)?.[1] ?? 0;
  const time = (p: Row) => textOf(p, 'time') ?? '99:99';
  const changed = (p: Row) => (typeof p.updatedAt === 'number' ? p.updatedAt : -1);
  const byTime = (x: Row, y: Row) => byCodePoint(time(x), time(y));
  const byChanged = (x: Row, y: Row) => changed(y) - changed(x);
  const byId = (x: Row, y: Row) => jsCmp(textOf(x, 'id') ?? '', textOf(y, 'id') ?? '');
  const date = (p: Row) => textOf(p, 'eventDate');
  const day = all.filter((p) => date(p) === today).toSorted((x, y) => byTime(x, y) || byChanged(x, y) || byId(x, y));
  const upcoming = all
    .filter((p) => date(p) !== undefined && byCodePoint(date(p)!, today) > 0)
    .toSorted((x, y) => byCodePoint(date(x)!, date(y)!) || byTime(x, y) || byId(x, y));
  const rest = all.filter((p) => date(p) === undefined || byCodePoint(date(p)!, today) < 0).toSorted((x, y) => byChanged(x, y) || byId(x, y));
  const lists = [
    ['today', 'presentations.today', false, false, day],
    ['upcoming', 'presentations.upcoming', true, false, upcoming],
    ['recent', 'presentations.recent', true, true, rest],
  ] as const;
  return lists.filter((l) => l[4].length).map(([id, title, showDate, withYear, rows]) => ({ id, title, showDate, withYear, rows }));
}
