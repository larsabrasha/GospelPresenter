// The schema and its migrations, the core's against org-schema.ts's: a fresh database, one of every version the TS
// migration still accepts (11 to 26, with rows its data migrations change), and the ones it refuses, migrated by
// both; then the default labels (labelSeedSql). The outcome, sqlite_master and every row compared.
import { DatabaseSync } from 'node:sqlite';
import { migrateOrgSchema, orgDdl, orgMigrations, orgIndexes, schemaMetaDdl, labelSeedSql } from '../.out/ts-core.mjs';
import { dumpAll, runRust, schemaOf } from './harness.mjs';

/** Today's DDL as version 11 made it: none of the tables and columns 12 to 25 added. */
const v11 = orgDdl
  .filter((s) => !orgIndexes.includes(s) && !/song_versions|song_materials|ccli_entries|TABLE IF NOT EXISTS (videos|video_files|custom_slides|themes) /.test(s))
  .map((s) =>
    s
      .replace(', description TEXT, updated_at INTEGER', '')
      .replace(', created_at INTEGER)', ')')
      .replace('sort INTEGER NOT NULL, updated_at INTEGER)', 'sort INTEGER NOT NULL)')
      .replace(', overlay_id TEXT, note TEXT)', ', overlay_id TEXT)')
      .replace(/, original_full_hash TEXT, original_thumb_hash TEXT,\s+original_width INTEGER, original_height INTEGER, edit TEXT\)/, ')'),
  );

const H = (c) => c.repeat(64);
const page = (extra) => JSON.stringify({ background: null, backgroundImageId: 'img1', elements: [{ kind: 'text', text: 'Hej' }, { kind: 'image', imageId: 'img1' }, { kind: 'image', imageId: 'gone' }, { kind: 'image', imageId: null }], ...extra });
/** Rows of every kind the data migrations change, each tried where its table and columns exist. */
const rows = [
  `INSERT OR IGNORE INTO labels (id, text, color, sort) VALUES ('label:verse', 'Verse', '#3478c7', 0)`,
  `INSERT OR IGNORE INTO songs (id, name) VALUES ('s1', 'Härlig är jorden'), ('s2', 'Blott en dag')`,
  ...[[';;', 'p1'], ['\\*;;', 'p2'], [' ; \n', 'p3'], ['a;b', 'p4'], ['Härlig', 'p5'], ['', 'p6'], ['\\\\', 'p7']].map(
    ([c, id], i) => `INSERT OR IGNORE INTO song_parts (id, song_id, sort, label_id, content) VALUES ('${id}', 's1', ${i}, NULL, '${c}')`,
  ),
  `INSERT OR IGNORE INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES ('a1', 's1', 'Kort', '["p1","p5","p2","p5"]', 0), ('a2', 's1', NULL, 'nej', 1), ('a3', 's1', 'Lång', '["p4","p5"]', 2)`,
  `INSERT OR IGNORE INTO presentations (id, name) VALUES ('P', 'Söndag')`,
  `INSERT OR IGNORE INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at) VALUES ('img1', 'a.jpg', 'image/jpeg', '${H('a')}', '${H('b')}', 10, 10, 0)`,
  `INSERT OR IGNORE INTO overlays (id, title, content, image_id, sort) VALUES ('O1', 'Kollekt', 'Swish 123', NULL, 0), ('O2', 'Sida', '${page({})}', NULL, 1)`,
  ...[
    ['I1', 'song', 'Härlig', 's1', null, 'O1'],
    ['I2', 'slides', 'Predikan.pdf', 'I2', JSON.stringify({ fileName: 'Predikan.pdf', pages: [{ full: H('c'), thumb: H('d') }, { full: H('e'), thumb: H('f') }] }), null],
    ['I3', 'slides', 'Tom.pdf', 'I3', JSON.stringify({ pages: [] }), null],
    ['I4', 'slides', 'Trasig.pdf', 'I4', 'inte json', null],
  ].map(([id, type, title, source, content, overlay], i) =>
    `INSERT OR IGNORE INTO presentation_items (id, presentation_id, type, title, source_id, sort, content, overlay_id) VALUES ('${id}', 'P', '${type}', '${title}', '${source}', ${i}, ${content === null ? 'NULL' : `'${content}'`}, ${overlay === null ? 'NULL' : `'${overlay}'`})`),
  `INSERT OR IGNORE INTO custom_slides (id, name, pages, created_at, updated_at) VALUES ('C1', 'Egen', '[${page({})},${page({ backgroundImageId: null })}]', 0, 0), ('C2', 'Trasig', 'inte json', 0, 0)`,
  `INSERT OR IGNORE INTO displays (id, name, code, kind) VALUES ('D1', 'Kyrksal', 'abcdefg', 'screen')`,
];

function tryAll(db, statements) {
  for (const s of statements) try { db.exec(s); } catch { /* not at this version */ }
}

/** A database at `version`: version 11's tables, then the TS migrations up to it, with rows before and after. */
function atVersion(version) {
  const db = new DatabaseSync(':memory:');
  for (const s of v11) db.exec(s);
  tryAll(db, rows);
  for (let v = 12; v <= version; v++) for (const s of orgMigrations[v]) db.exec(s);
  tryAll(db, rows);
  db.exec(schemaMetaDdl);
  db.exec(`INSERT INTO _schema (one, version) VALUES (1, ${version})`);
  return db;
}

const cases = [
  ['a new database', () => new DatabaseSync(':memory:')],
  ...Array.from({ length: 16 }, (_, i) => [`version ${11 + i}`, () => atVersion(11 + i)]),
  ['tables but no version (milestone 1)', () => { const db = new DatabaseSync(':memory:'); for (const s of v11) db.exec(s); return db; }],
  ['version 10', () => { const db = atVersion(11); db.exec('UPDATE _schema SET version = 10'); return db; }],
  ['version 27, newer than the core', () => { const db = atVersion(26); db.exec('UPDATE _schema SET version = 27'); return db; }],
];

async function migrateTs(db) {
  try {
    await migrateOrgSchema(async (sql) => { await Promise.resolve(); return db.prepare(sql).all(); }, async (fn) => { db.exec('BEGIN'); await fn(); db.exec('COMMIT'); });
    return 'ok';
  } catch (e) {
    return /made before/.test(e.message) ? 'schema-too-old' : /newer than/.test(e.message) ? 'schema-too-new' : `crash: ${e.message}`;
  }
}

/** The tables and rows apart from `_schema`, which only the TS migration leaves on a database it refuses. */
const withoutMeta = (text) => JSON.stringify(JSON.parse(text).filter((x) => (Array.isArray(x) ? x[0] : x.name) !== '_schema'));

let differences = 0;
for (const [label, make] of cases) {
  const a = make(), b = make();
  const ra = await migrateTs(a);
  const rb = await runRust(b, { name: 'migrateOrgSchema', args: {}, ctx: {} });
  const refused = ra !== 'ok';
  const same = ra === rb && (refused ? withoutMeta(schemaOf(a)) === withoutMeta(schemaOf(b)) && withoutMeta(dumpAll(a)) === withoutMeta(dumpAll(b)) : schemaOf(a) === schemaOf(b) && dumpAll(a) === dumpAll(b));
  if (!same) differences++;
  const tables = JSON.parse(dumpAll(b)).length, n = JSON.parse(dumpAll(b)).reduce((k, [, r]) => k + r.length, 0);
  console.log(`  ${same ? 'same' : 'DIFFERENT'}: ${label}: TS ${ra}, Rust ${rb}; ${tables} tables, ${n} rows`);
  if (!same && ra === rb) for (const [x, y] of [[schemaOf(a), schemaOf(b)], [dumpAll(a), dumpAll(b)]]) if (x !== y) console.log(`     TS   ${x.slice(0, 600)}\n     Rust ${y.slice(0, 600)}`);
}

// The default labels: on a new database, on one with labels of the same texts or ids, and seeded twice.
const labelCases = [
  ['no labels', []],
  ['labels of the same text, case and spacing aside, and of an id renamed', [`INSERT INTO labels (id, text, color, sort) VALUES ('x', ' verse  ', '#000000', 0), ('label:chorus', 'Refräng', '#111111', 1), ('y', 'BRIDGE 1', '#222222', 2)`]],
  ['seeded before', [`CREATE TABLE server_seeds (what TEXT PRIMARY KEY NOT NULL)`, `INSERT INTO server_seeds VALUES ('labels')`]],
];
for (const [label, setup] of labelCases) {
  const make = () => { const db = new DatabaseSync(':memory:'); for (const s of orgDdl) db.exec(s); for (const s of setup) db.exec(s); return db; };
  const a = make(), b = make();
  for (let i = 0; i < 2; i++) {
    for (const s of labelSeedSql) a.exec(s);
    await runRust(b, { name: 'seedLabels', args: {}, ctx: {} });
  }
  const same = dumpAll(a) === dumpAll(b);
  if (!same) differences++;
  console.log(`  ${same ? 'same' : 'DIFFERENT'}: default labels, ${label}: ${a.prepare('SELECT count(*) AS n FROM labels').get().n} labels`);
}
console.log(differences ? `schema: ${differences} differences` : 'schema: no differences');
process.exitCode = differences ? 1 : 0;
