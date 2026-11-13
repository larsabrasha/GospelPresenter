// Builds demo.sqlite for the Mac app: the presentations of apptest's list, the running order of its first one, songs
// with made-up text (no real lyrics), and checks that the Rust core's slides are the TS core's (readItemSlides).
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateOrgSchemaSync, labelSeedSql } from './.out/ts-core.mjs';
import { canon, tsSlides } from './sources.mjs';
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
  // Credits of every kind: an author, a publisher, a year, none; the last song in the trash.
  db.prepare('INSERT INTO songs (id, name, author, publisher, year, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, i % 3 ? null : 'Okänd', i % 4 === 1 ? 'Förlaget' : null, i % 5 === 2 ? 1980 + i : null, i === titles.length - 1 ? 1000 : null);
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
      .run(`${id}-i${sort}`, id, type, title, extra.source ?? (type === 'song' ? songId(title) : `${id}-src${sort}`), sort, extra.arrangement ?? null, extra.content ?? null));
}

// The library's media, by made-up hashes: a video, a sound, a picture, and a slideshow page with two texts.
db.prepare(`INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at)
  VALUES ('vid-1', 'FOREVERGREEN.mp4', 'video/mp4', 'h264', 'h-video', 1000, 60, 1920, 1080, 'h-still', 'h-vthumb', 0, NULL)`).run();
db.prepare(`INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES ('aud-1', 'Äventyret - Jesusparty.mp3', 'audio/mpeg', 'h-audio', 100, 0, NULL)`).run();
db.prepare(`INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES ('img-1', 'swish.jpg', 'image/jpeg', 'h-full', 'h-thumb', 800, 600, 0)`).run();
const text = (id, y, x, t) => ({ id, x, y, w: 800, h: 100, kind: 'text', text: t, size: 60, bold: true, italic: false, align: 'center', color: '#ffffff' });
const page = { background: '#000000', backgroundPicture: null, backgroundPage: null, elements: [text('b', 500, 10, ' Swisha till 123 456 '), text('a', 100, 10, 'Kollekt'), text('c', 300, 10, '   ')] };
db.prepare(`INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES ('cs-1', 'Kollekt', ?, 0, 0, NULL)`).run(JSON.stringify([page]));
db.prepare(`INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES ('cs-bad', 'Trasig', 'not json', 0, 0, NULL)`).run();

const bible = (title, first, n) => ['bible', title, {
  content: JSON.stringify({ translation: 'Demo', slides: Array.from({ length: n }, (_, s) => [0, 1].map((k) => ({ n: k === 0 || s % 2 ? first + s * 2 + k : null, t: lines(2).replace('\n', ' ') + '.' }))) }),
}];
const song = (t) => ['song', t];

presentation('pres-main', 'Presentation', '2026-11-08', '11:00', null,
  '* Simon välkomnar\n• Tusen skäl\n• Livets väg\n• Frågor för barn\n• Film och Jesusparty\n• Kollekt med Swish', [
    ['header', 'Simon välkomnar'], song('Tusen skäl'), song('Jag går på livets väg'), ['header', 'Frågor för barn'],
    ['video', 'FOREVERGREEN — Academy Award Nominated Short Film', { source: 'vid-1' }], ['audio', 'Äventyret - Jesusparty', { source: 'aud-1' }],
    ['header', 'Barnen erbjuds lämna till söndagsskolan'], ['image', 'swish.jpg', { source: 'img-1', content: JSON.stringify({ images: ['gone-img', 'img-1'] }) }], song('His Mercy is More'), song('Så stor är vår Gud'),
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
    // The rest of what an item can be, in the first two: a slideshow, a broken one, a song in the trash, files gone.
    else if (p === 0 && k === 1) items.push(['custom', 'Kollekt', { source: 'cs-1' }]);
    else if (p === 0 && k === 2) items.push(['custom', 'Trasig', { source: 'cs-bad' }]);
    else if (p === 1 && k === 1) items.push(song(titles.at(-1)));
    else if (p === 1 && k === 2) items.push(['audio', 'Borta', { source: 'gone' }]);
    else if (p === 1 && k === 4) items.push(['video', 'Borta', { source: 'gone' }]);
    else if (p === 1 && k === 5) items.push(['image', 'Borta', { source: 'gone' }]);
    else if (k === 3) items.push(bible(pick(['Johannes 3:16–21', 'Psaltaren 23', 'Matteus 5:1–12', 'Romarbrevet 8:28–39']), 1 + k, 2 + (p % 3)));
    else if (k === Math.floor(n / 2)) items.push(['header', 'Predikan']);
    else items.push(song(pick(titles)));
  }
  presentation(`pres-${p}`, name, date, time, location, null, items);
});

// ---------------------------------------------------------------- the Rust core's slides against the TS core's

const all = (s) => db.prepare(s).all();
let checked = 0, differ = 0;
for (const { id } of all('SELECT id FROM presentations')) {
  const view = await viewRust(db, 'presentationView', { id });
  const ts = await tsSlides(db, id);
  ts.items.forEach((item, k) => {
    const want = canon(ts.slides.get(item.id));
    const { slides, problem, audio, video } = view.items[k];
    const got = canon({ slides, problem, audio, video });
    checked++;
    if (want !== got) { differ++; if (differ < 4) console.log(`DIFF ${item.type} ${item.title}\n  TS   ${want.slice(0, 400)}\n  Rust ${got.slice(0, 400)}`); }
  });
}
console.log(`slides: ${checked} items compared, ${differ} different`);

rmSync(`${out}/demo.sqlite`, { force: true });
db.exec(`VACUUM INTO '${out}/demo.sqlite'`);
console.log(`demo.sqlite: ${all('SELECT count(*) n FROM presentations')[0].n} presentations, ${all('SELECT count(*) n FROM songs')[0].n} songs, ${all('SELECT count(*) n FROM presentation_items')[0].n} items`);
