// startPageView (views/start-page.ts) on the demo data and on generated presentations: dates and times around
// `today`, missing and odd ones, equal times of change, every day of a span.
import { emptyDb } from './harness.mjs';

export function cases(db, { random }) {
  const pick = (xs) => xs[Math.floor(random() * xs.length)];
  const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-12-01', '2025-01-01', '', 'x', '2026-11-22T10', 'é', '😀'];
  const rows = [];
  const ids = [];
  for (let n = 0; n < 120; n++) {
    ids.push(`p${pick(['a', 'B', 'é', '😀', ''])}${n}`);
    const v = (x) => (x === null ? 'NULL' : typeof x === 'number' ? x : `'${x}'`);
    rows.push(`INSERT INTO presentations (id, name, event_date, time, updated_at, is_template, deleted_at) VALUES ('${ids[n]}', 'P${n}',
      ${v(pick([...days, null, null]))}, ${v(pick(['10:00', '09:30', '', null, '9:00', '😀', '99:99']))}, ${v(pick([null, 5, 5, 7, 1.5, -1]))}, ${random() < 0.1 ? 1 : 0}, ${random() < 0.1 ? 3 : 'NULL'})`);
  }
  for (let n = 0; n < 200; n++) rows.push(`INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i${n}', '${ids[n % 40]}', 'header', 'H', 'i${n}', ${n})`);
  const made = emptyDb(rows.map((r) => r.replace(/\n\s+/g, ' ')));
  const out = [];
  for (const today of [...days, undefined, 5]) for (const on of [db, made]) out.push({ name: 'startPageView', db: on, args: today === undefined ? {} : { today } });
  for (let n = 0; n < 300; n++) out.push({ name: 'startPageView', db: made, args: { today: `2026-11-${String(Math.floor(random() * 40)).padStart(2, '0')}` } });
  return out;
}
