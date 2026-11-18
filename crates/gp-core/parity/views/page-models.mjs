// What a page offers against what the web worked out at 2.0 (238d481b; docs/view-models.md): `addPositionView` against
// liveList.ts's `addAfter`, for random running orders with the shown, last added, chosen and selected items among them,
// gone from them, empty or missing.
import { addAfter, groupPresentations, itemCounts, listPresentations } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

/**
 * `startPageView` against the start page as the web made it: `groupPresentations` of `listPresentations` on a given
 * day, each row with its count from `itemCounts`, the lists' flags as Presentations.tsx's `row` passes them, an empty
 * list left out as the page leaves it out. Every day the presentations are on, a day before, between and after them.
 */
async function startPage(file) {
  const db = fixture(file);
  const d = readDb(db);
  const all = await listPresentations(d);
  const counts = await itemCounts(d);
  const dates = [...new Set(all.map((p) => p.eventDate).filter(Boolean))].toSorted();
  const shift = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const days = [...dates, ...dates.map((x) => shift(x, -1)), ...dates.map((x) => shift(x, 1)), '1999-01-01', '2099-12-31'];
  const differ = [];
  for (const today of days) {
    const g = groupPresentations(all, today);
    const rows = (xs) => xs.map((p) => ({ ...p, itemCount: Number(counts.get(p.id) ?? 0) }));
    const want = [
      { id: 'today', title: 'presentations.today', showDate: false, withYear: false, rows: rows(g.today) },
      { id: 'upcoming', title: 'presentations.upcoming', showDate: true, withYear: false, rows: rows(g.upcoming) },
      { id: 'recent', title: 'presentations.recent', showDate: true, withYear: true, rows: rows(g.rest) },
    ].filter((l) => l.rows.length);
    const got = (await viewRust(db, 'startPageView', { today })).map((l) => ({ ...l, rows: l.rows.map((p) => ({ ...p, itemCount: Number(p.itemCount) })) }));
    if (canon(want) !== canon(got)) differ.push(`startPageView ${today}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  }
  return { compared: days.length, differ };
}

export default async function check(db, file) {
  let seed = 23;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const differ = [];
  let compared = 0;
  for (let i = 0; i < 4000; i++) {
    const order = pool.filter(() => rand() < 0.7).toSorted(() => rand() - 0.5);
    const one = () => pick([...order, ...order, 'gone', '', null, undefined]);
    const place = { order, shownId: one(), lastAddedId: one(), chosenId: one(), selectedId: one() };
    for (const k of Object.keys(place)) if (place[k] === undefined) delete place[k];
    compared++;
    // The TS function takes null where a key is missing, as its callers pass it.
    const want = addAfter({ shownId: null, lastAddedId: null, chosenId: null, ...place }) ?? null;
    const got = await viewRust(db, 'addPositionView', place);
    if (canon(want) !== canon(got)) differ.push(`addPositionView ${JSON.stringify(place)}: TS ${canon(want)} Rust ${canon(got)}`);
  }
  const start = await startPage(file);
  return { compared: compared + start.compared, differ: [...differ, ...start.differ], notes: ['4 000 running orders with an addition placed', `the start page on ${start.compared} days`] };
}
