// Builds demo.sqlite for the Mac app: the presentations of apptest's list, the running order of its first one, songs
// with made-up text (no real lyrics), and checks that the Rust core's slides are the TS core's (songSlides, bibleItemSlides).
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateOrgSchemaSync, labelSeedSql, songSlides, bibleItemSlides } from './.out/ts-core.mjs';
import { viewRust } from './diff.mjs';

const out = process.argv[2];
const db = new DatabaseSync(':memory:');
migrateOrgSchemaSync((s) => db.prepare(s).all(), (fn) => { db.exec('BEGIN'); fn(); db.exec('COMMIT'); });
for (const s of labelSeedSql) db.exec(s);
const labelId = Object.fromEntries(db.prepare('SELECT id, text FROM labels').all().map((l) => [l.text, l.id]));

// ---------------------------------------------------------------- made-up text

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const nouns = ['nåd', 'kärlek', 'frid', 'trofasthet', 'godhet', 'glädje', 'sanning', 'väg', 'hand', 'tröst'];
const places = ['morgonens ljus', 'kvällens frid', 'stormens brus', 'dalens skugga', 'himlens höjd', 'livets väg', 'nattens mörker'];
const verbs = ['sjunger', 'vilar', 'lovar', 'tackar', 'väntar', 'går', 'litar'];
const templates = [
  () => `Jag ${pick(verbs)} i din ${pick(nouns)}`,
  () => `Du är med mig i ${pick(places)}`,
  () => `Din ${pick(nouns)} bär mig hem`,
  () => `Herre, du är min ${pick(nouns)}`,
  () => `Genom ${pick(places)} håller du mig`,
  () => `Allt jag har ger jag till dig`,
  () => `Evigt ${pick(verbs)} min själ`,
];
const lines = (n) => Array.from({ length: n }, () => pick(templates)()).join('\n');

// ---------------------------------------------------------------- songs

const titles = ['Tusen skäl', 'Jag går på livets väg', 'His Mercy is More', 'Så stor är vår Gud', 'I din famn', 'Bara Du', 'Vilken vän jag fann',
  'Välsignelsen (bön)', 'Brustna kärl', 'Härlig är jorden', 'Blott en dag', 'Tryggare kan ingen vara', 'O store Gud', 'Amazing grace',
  'Ingen är som du', 'Led mig, Herre', 'Helig är du', 'Du vet väl om att du är värdefull', 'Gud är trofast', 'Kom som du är'];
const songId = (t) => `song-${titles.indexOf(t)}`;
titles.forEach((name, i) => {
  const id = `song-${i}`;
  db.prepare('INSERT INTO songs (id, name, author) VALUES (?, ?, ?)').run(id, name, i % 3 ? null : 'Okänd');
  const parts = [['Verse 1', 4], ['Verse 2', 4], ['Verse 3', 4], ['Chorus', 6], ...(i % 4 === 0 ? [['Bridge', 3]] : [])];
  parts.forEach(([label, n], k) =>
    db.prepare('INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES (?, ?, ?, ?, ?)').run(`${id}-p${k}`, id, k, labelId[label], lines(n)));
  // Most songs sing the chorus after every verse; one arrangement names a part that was deleted, which is skipped.
  if (i % 2 === 0)
    db.prepare('INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES (?, ?, ?, ?, 0)')
      .run(`${id}-a`, id, 'Kör efter varje vers', JSON.stringify([`${id}-p3`, `${id}-p0`, `${id}-p3`, `${id}-p1`, `${id}-p3`, ...(i === 2 ? ['gone'] : []), `${id}-p2`, `${id}-p3`]));
});

// ---------------------------------------------------------------- presentations

let updated = 1000;
function presentation(id, name, date, time, location, description, items) {
  db.prepare('INSERT INTO presentations (id, name, event_date, time, location, description, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, date, time, location, description, updated--);
  items.forEach(([type, title, extra = {}], sort) =>
    db.prepare('INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, arrangement_id, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`${id}-i${sort}`, id, type, title, type === 'song' ? songId(title) : `${id}-src${sort}`, sort, extra.arrangement ?? null, extra.content ?? null));
}

const bible = (title, first, n) => ['bible', title, {
  content: JSON.stringify({ translation: 'Demo', slides: Array.from({ length: n }, (_, s) => [0, 1].map((k) => ({ n: k === 0 || s % 2 ? first + s * 2 + k : null, t: lines(2).replace('\n', ' ') + '.' }))) }),
}];
const song = (t) => ['song', t];

presentation('pres-main', 'Presentation', '2026-11-08', '11:00', null,
  '* Simon välkomnar\n• Tusen skäl\n• Livets väg\n• Frågor för barn\n• Film och Jesusparty\n• Kollekt med Swish', [
    ['header', 'Simon välkomnar'], song('Tusen skäl'), song('Jag går på livets väg'), ['header', 'Frågor för barn'],
    ['video', 'FOREVERGREEN — Academy Award Nominated Short Film'], ['audio', 'Äventyret - Jesusparty'],
    ['header', 'Barnen erbjuds lämna till söndagsskolan'], ['image', 'swish.jpg'], song('His Mercy is More'), song('Så stor är vår Gud'),
    song('I din famn'), song('Bara Du'), song('Vilken vän jag fann'), song('Välsignelsen (bön)'), song('Brustna kärl'),
  ]);

const list = [
  ['Gudstjänst', '2026-11-01', '11:00', null, 7], ['Gudstjänst', '2026-10-25', '11:00', null, 11], ['Gudstjänst', '2026-10-11', '11:00', null, 10],
  ['Gudstjänst', '2026-09-20', '11:00', 'Kyrksalen', 14], ['Kvällssamling', '2026-09-12', '19:00', null, 12], ['Nattvardsgudstjänst', '2026-09-06', '11:00', null, 20],
  ['Gudstjänst', '2026-08-30', '11:00', null, 27], ['Sommargudstjänst', '2026-07-19', '10:00', null, 13], ['Sommargudstjänst', '2026-07-05', '10:00', null, 8],
  ['Gudstjänst', '2026-05-10', '11:00', null, 12], ['Nattvardsgudstjänst', '2026-05-03', '11:00', null, 1], ['Gudstjänst', '2026-04-19', '11:00', null, 17],
  ['Presentation', null, null, null, 0], ['Gudstjänst', '2026-03-29', '11:00', null, 16], ['Långfredagsgudstjänst', '2026-04-03', '17:00', null, 10],
];
list.forEach(([name, date, time, location, n], p) => {
  const items = [];
  for (let k = 0; k < n; k++) {
    if (k === 0) items.push(['header', 'Välkommen']);
    else if (k === 3) items.push(bible(pick(['Johannes 3:16–21', 'Psaltaren 23', 'Matteus 5:1–12', 'Romarbrevet 8:28–39']), 1 + k, 2 + (p % 3)));
    else if (k === Math.floor(n / 2)) items.push(['header', 'Predikan']);
    else items.push(song(pick(titles)));
  }
  presentation(`pres-${p}`, name, date, time, location, null, items);
});

// ---------------------------------------------------------------- the Rust core's slides against the TS core's

const all = (s) => db.prepare(s).all();
const songs = new Map(all('SELECT * FROM songs').map((s) => [s.id, s]));
const parts = all('SELECT id, song_id AS songId, sort, label_id AS labelId, content FROM song_parts');
const arrangements = all('SELECT id, song_id AS songId, name, part_ids AS partIds, sort FROM song_arrangements');
const labels = new Map(all('SELECT * FROM labels').map((l) => [l.id, l]));
let checked = 0, differ = 0;
for (const { id } of all('SELECT id FROM presentations')) {
  const view = await viewRust(db, 'presentationView', { id });
  const items = all(`SELECT * FROM presentation_items WHERE presentation_id = '${id}' ORDER BY sort, id`);
  items.forEach((item, k) => {
    const ts =
      item.type === 'song' ? songSlides(songs.get(item.source_id), parts, labels, arrangements, item.arrangement_id)
      : item.type === 'bible' ? bibleItemSlides(item.title, JSON.parse(item.content))
      : item.type === 'header' ? [] : null;
    if (!ts) return;
    const want = JSON.stringify(ts.map((s) => [s.key, s.text, s.label ? [s.label.text, s.label.color] : null]));
    const got = JSON.stringify(view.items[k].slides.map((s) => [s.key, s.text, s.label ? [s.label.text, s.label.color] : null]));
    checked++;
    if (want !== got) { differ++; if (differ < 4) console.log(`DIFF ${item.title}\n  TS   ${want.slice(0, 300)}\n  Rust ${got.slice(0, 300)}`); }
  });
}
console.log(`slides: ${checked} items compared, ${differ} different`);

rmSync(`${out}/demo.sqlite`, { force: true });
db.exec(`VACUUM INTO '${out}/demo.sqlite'`);
console.log(`demo.sqlite: ${all('SELECT count(*) n FROM presentations')[0].n} presentations, ${songs.size} songs, ${all('SELECT count(*) n FROM presentation_items')[0].n} items`);
