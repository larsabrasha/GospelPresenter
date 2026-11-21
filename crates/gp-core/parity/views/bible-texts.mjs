// What a device does with Bible texts (`bibleTextPlanView`, `bibleTextStoreView`, `bibleTextJsonView`,
// `bibleUploadsView`) against the web's own syncBibleTexts, fetchBibleText and BibleTextUploads
// (packages/sync/src/client/bibles.ts at 3d061fc9, built by build.sh): texts made at random, sound and damaged in each
// way the schema refuses, written canonically and not; translations kept by hand and not, texts held that nothing
// names, queued imports naming texts held and not; and the uploads before a push, refused, failing and through.
import { copyFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { BibleTextUploads, fetchBibleText, syncBibleTexts } from '../.out/sync-bibles.mjs';
import { storeBibleTextSql } from '../../../../packages/core/src/bible.ts';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const CHARS = ['a', 'Å', 'ö', ' ', '"', '\\', '\n', '\t', '\u0001', '\u001f', '\u007f', ' ', '😀', '/', '<', 'é', 'é'];
const word = () => Array.from({ length: 1 + Math.floor(rand() * 12) }, () => pick(CHARS)).join('');
const CODES = ['GEN', 'EXO', 'MAT', 'JHN', 'REV', '1CO', 'PS2'];
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** A sound text, as a translation's books. */
function text() {
  const codes = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(CODES)))];
  return codes.map((code) => ({ code, verses: Array.from({ length: 1 + Math.floor(rand() * 5) }, () => [Math.floor(rand() * 999), Math.floor(rand() * 999), word()]) }));
}
const canonical = (books) => `{"v":1,"books":[${books.map((b) => `{"code":${JSON.stringify(b.code)},"verses":${JSON.stringify(b.verses)}}`).join(',')}]}`;

/** Each way a text is sent: canonical, spaced, with floats and keys the schema strips, and broken as it refuses. */
const WAYS = {
  canonical: (b) => canonical(b),
  spaced: (b) => JSON.stringify({ v: 1, books: b }, null, 2),
  floats: (b) => canonical(b).replace(/\[(\d+),(\d+),/g, '[$1.0,$2,').replace('"v":1', '"v":1.0'),
  extraKeys: (b) => JSON.stringify({ v: 1, x: 2, books: b.map((k) => ({ ...k, note: 'n' })) }),
  v2: (b) => JSON.stringify({ v: 2, books: b }),
  noBooks: () => '{"v":1,"books":[]}',
  lowerCode: (b) => JSON.stringify({ v: 1, books: [{ ...b[0], code: b[0].code.toLowerCase() }] }),
  twice: (b) => JSON.stringify({ v: 1, books: [b[0], b[0]] }),
  fourParts: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1, 1, 'a', 4]] }] }),
  chapter1000: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1000, 1, 'a']] }] }),
  negative: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[-1, 1, 'a']] }] }),
  half: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1.5, 1, 'a']] }] }),
  stringNumber: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [['1', 1, 'a']] }] }),
  longVerse: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1, 1, '😀'.repeat(5001)]] }] }),
  emojiLimit: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1, 1, '😀'.repeat(10_000)]] }] }),
  emojiOver: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1, 1, '😀'.repeat(10_001)]] }] }),
  limitVerse: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [[1, 1, 'å'.repeat(10_000)]] }] }),
  noVerses: (b) => JSON.stringify({ v: 1, books: [{ code: b[0].code, verses: [] }] }),
  tooMany: () => JSON.stringify({ v: 1, books: ['GEN', 'EXO'].map((code) => ({ code, verses: Array.from({ length: 30_001 }, (_, i) => [1, i % 999, 'a']) })) }),
  manyBooks: () => JSON.stringify({ v: 1, books: Array.from({ length: 201 }, (_, i) => ({ code: String(i).padStart(3, '0'), verses: [[1, 1, 'a']] })) }),
  notJson: (b) => canonical(b).slice(0, -3),
  array: (b) => JSON.stringify(b),
};

function device(file, label) {
  const copy = file.replace(/\.sqlite$/, `-${label}.sqlite`);
  rmSync(copy, { force: true });
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  db.exec('CREATE TABLE IF NOT EXISTS _mutation (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)');
  const client = {
    query: async (sql, params = []) => db.prepare(sql).all(...params),
    localWrite: async (statements) => { for (const s of statements) db.prepare(s.sql).run(...(s.params ?? [])); },
    pending: async () => db.prepare('SELECT id, name, v, args FROM _mutation ORDER BY id').all(),
    rejected: [],
  };
  return { db, client };
}

/** A device with translations kept and not, texts held and not, and imports queued. */
function library(file, label, texts) {
  const d = device(file, label);
  const run = (sql, ...p) => d.db.prepare(sql).run(...p);
  const store = (hash, books) => { for (const s of storeBibleTextSql(hash, books)) run(s.sql, ...s.params); };
  texts.forEach(({ hash, books }, i) => {
    // Every third translation not here, every other kept, the last held but named by nothing.
    if (i < texts.length - 1) run('INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES (?, ?, ?, ?, 1, ?)', `bible:${i}`, `B${i}`, `B${i}`, 'sv', hash);
    if (i % 2 === 0) run('INSERT INTO kept_bibles (id, kept_at) VALUES (?, ?)', `bible:${i}`, i);
    if (i % 3 !== 0) store(hash, books);
  });
  // A second translation of the first text, so it is named twice.
  run("INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES ('bible:twin', 'T', 'T', 'sv', 1, ?)", texts[0].hash);
  return d;
}

export default async function check(_, file) {
  const differ = [];
  let compared = 0;
  let taken = 0;
  // A text read: what the web stores of it, or null.
  for (let n = 0; n < 400; n++) {
    const books = text();
    const [way, write] = n < Object.keys(WAYS).length ? Object.entries(WAYS)[n] : pick(Object.entries(WAYS));
    const json = write(books);
    // The hash of what was sent as the web would write it, so a sound text is named rightly; now and then a wrong one.
    const sent = safe(json)?.books;
    const hash = rand() < 0.1 || !Array.isArray(sent) ? sha(json) : sha(canonical(sent.map((b) => ({ code: b?.code, verses: b?.verses }))));
    compared++;
    const ts = await fetchBibleText(async () => json, hash);
    const want = ts ? storeBibleTextSql(hash, ts) : null;
    if (want) taken++;
    const got = (await viewRust(new DatabaseSync(':memory:'), 'bibleTextStoreView', { hash, json })).store;
    if (canon(want) !== canon(got)) differ.push(`bibleTextStoreView ${way}: TS ${canon(want).slice(0, 200)} Rust ${canon(got).slice(0, 200)}`);
  }
  // Which texts to fetch and drop, keeping every one or those chosen, with imports queued.
  const texts = Array.from({ length: 9 }, () => { const books = text(); return { books, hash: sha(canonical(books)) }; });
  for (const keeping of ['all', 'chosen']) {
    for (const queued of [[], [texts[8].hash], [texts[7].hash, 42]]) {
      compared++;
      const label = `bibles-${keeping}-${queued.length}`;
      const base = library(file, `${label}-base`, texts);
      const want = library(file, label, texts);
      for (const d of [base, want]) queued.forEach((h, i) => d.db.prepare("INSERT INTO _mutation (id, name, v, args) VALUES (?, 'importBible', 1, ?)").run(i + 1, JSON.stringify({ name: 'B', abbreviation: 'B', contentHash: h })));
      const before = want.db.prepare('SELECT hash FROM bible_blobs').all().map((r) => r.hash);
      const r = await syncBibleTexts(want.client, async () => null, keeping);
      const dropped = before.filter((h) => !want.db.prepare('SELECT hash FROM bible_blobs').all().some((x) => x.hash === h)).toSorted();
      const plan = await viewRust(base.db, 'bibleTextPlanView', { keeping });
      const mine = { fetch: plan.fetch, drop: [...plan.drop].toSorted() };
      if (canon(mine) !== canon({ fetch: r.missing, drop: dropped })) differ.push(`bibleTextPlanView ${keeping} ${queued}: TS ${canon({ fetch: r.missing, drop: dropped })} Rust ${canon(mine)}`);
    }
  }
  // The uploads before a push: each queued import's text, once; one failing holds back its import and what follows.
  for (const fail of [null, 200, 413, 503, 'unreachable']) {
    compared++;
    const d = library(file, `uploads-${fail}`, texts);
    const queue = [['createPresentation', { id: 'p', name: 'P' }], ['importBible', { contentHash: texts[1].hash }], ['importBible', { contentHash: texts[3].hash }], ['importBible', { contentHash: texts[1].hash }], ['importBible', { contentHash: 7 }], ['importBible', { contentHash: texts[2].hash }]];
    queue.forEach(([name, args], i) => d.db.prepare('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, 1, ?)').run(i + 1, name, JSON.stringify(args)));
    const status = (k) => (fail !== null && k === 1 ? fail : 200);
    const sent = [];
    const ts = new BibleTextUploads(async (hash, json) => { sent.push([hash, json]); const s = status(sent.length); if (s === 'unreachable') throw new Error('offline'); return s; });
    const pending = await d.client.pending();
    const limits = [await ts.beforePush(pending, d.client), await ts.beforePush(pending, d.client)];
    // The shell's part as the web's BibleTextUploads now does it, over the core's lists.
    const mineSent = [];
    const uploaded = new Set();
    const mineLimits = [];
    for (let round = 0; round < 2; round++) {
      const { uploads } = await viewRust(d.db, 'bibleUploadsView', { uploaded: [...uploaded] });
      let limit;
      for (const u of uploads.filter((x) => x.index < pending.length)) {
        if (u.uploaded || uploaded.has(u.hash)) continue;
        const { json } = await viewRust(d.db, 'bibleTextJsonView', { hash: u.hash });
        if (json === null) continue;
        mineSent.push([u.hash, json]);
        const s = status(mineSent.length);
        if (s === 'unreachable' || s >= 500) { limit = u.index; break; }
        if (s < 300) uploaded.add(u.hash);
      }
      mineLimits.push(limit);
    }
    const want = { sent, limits };
    const got = { sent: mineSent, limits: mineLimits };
    if (canon(want) !== canon(got)) differ.push(`bibleUploadsView ${fail}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  }
  return { compared, differ, notes: [`texts sound and damaged each way, written canonically and not (${taken} of 400 taken); what to fetch and drop, keeping all or the chosen, with imports queued; the uploads before a push`] };
}

function safe(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
