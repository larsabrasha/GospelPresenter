// Which media files a device fetches (`wantedMediaView`) against the web's own `wantedBlobs` and `wantedVideos`
// (packages/sync/src/client/media.ts, as it is today): on the demo data with pictures in own themes, overlays and
// slideshows, presentations kept offline, and every policy a shell gives: presenting or not, kept offline by hand or
// as coming, a device that keeps nothing, one that fetches nothing.
import { copyFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { wantedBlobs, wantedVideos } from '../.out/sync-media.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

export default async function check(_, file) {
  const copy = file.replace(/\.sqlite$/, '-media.sqlite');
  rmSync(copy, { force: true });
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  // What does not read is passed over, never stops the fetch (Lars, 2026-11-20): the demo's slideshow whose pages do
  // not read, and an overlay and an image item alike, below.
  if (!db.prepare('SELECT 1 FROM custom_slides WHERE NOT json_valid(pages)').get()) throw new Error('the demo has no slideshow whose pages do not read');
  const pic = (n) => ({ kind: 'picture', full: `${n}f`.padEnd(64, 'a'), thumb: `${n}t`.padEnd(64, 'b') });
  const ground = (image) => ({ color: '#000000', image, fit: 'cover', scrim: 0 });
  const style = (image) => ({ background: ground(image), main: {}, credits: {} });
  run('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, 0, 0)', 'th-pic', 'Bild', JSON.stringify({ song: style(pic('s')), bible: style(null), media: ground(pic('m')) }));
  run('INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, 1, 0)', 'th-bad', 'Trasig', 'not json');
  const page = { background: null, backgroundPicture: { full: pic('o').full, thumb: pic('o').thumb }, backgroundPage: null, elements: [{ id: 'e', kind: 'image', x: 0, y: 0, w: 10, h: 10, fit: 'cover', picture: { full: pic('e').full, thumb: pic('e').thumb } }] };
  run('INSERT INTO overlays (id, title, content, sort, updated_at) VALUES (?, ?, ?, 3, 0)', 'ov-pic', 'Bild', JSON.stringify(page));
  run('INSERT INTO overlays (id, title, content, sort, updated_at) VALUES (?, ?, ?, 4, 0)', 'ov-bad', 'Trasig', 'not json');
  const bad = run("UPDATE presentation_items SET content = 'not json' WHERE id = (SELECT id FROM presentation_items WHERE type = 'image' ORDER BY id LIMIT 1)");
  if (bad.changes !== 1) throw new Error('the demo has no image item to break');
  const ids = db.prepare('SELECT id FROM presentations ORDER BY event_date, id').all().map((r) => r.id);
  run('INSERT INTO pinned_presentations (id, pinned_at) VALUES (?, 2), (?, 1), (?, 3)', ids[2], ids[5], 'gone');
  const client = { query: async (sql, params = []) => db.prepare(sql).all(...params) };
  const dates = db.prepare('SELECT event_date FROM presentations WHERE event_date IS NOT NULL ORDER BY event_date').all().map((r) => r.event_date);
  const differ = [];
  let compared = 0;
  const policies = [];
  for (const presenting of [null, 'pres-main', 'pres-1', ids.at(-1), 'no-such']) {
    for (const [persistent, keepComing] of [[true, false], [true, true], [false, true]]) {
      for (const today of [dates[0], dates[Math.floor(dates.length / 2)], '2026-12-28']) policies.push({ presenting, persistent, keepComing, today, days: 7, budget: 0 });
    }
  }
  policies.push({ presenting: 'pres-main', persistent: true, keepComing: true, today: dates[0], days: 7, budget: 0, fetch: false });
  for (const policy of policies) {
    compared++;
    const want = { blobs: await wantedBlobs(client, policy), videos: await wantedVideos(client, policy) };
    const got = await viewRust(db, 'wantedMediaView', policy);
    if (canon(want) !== canon(got)) differ.push(`wantedMediaView ${JSON.stringify(policy)}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
    // Past the rows that do not read: the good overlay's and slideshow's pictures are still fetched.
    if (policy.fetch !== false && !(got.blobs.includes(pic('e').thumb) && got.blobs.includes(pic('o').thumb))) differ.push(`wantedMediaView ${JSON.stringify(policy)}: the good overlay's pictures left out`);
  }
  return { compared, differ, notes: ['every policy: presenting or not, kept offline by hand or as coming, keeping nothing, fetching nothing'] };
}
