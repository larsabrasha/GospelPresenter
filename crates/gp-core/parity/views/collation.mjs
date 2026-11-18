// Names in the page's language against the web's Intl.Collator (what listSongs, listBibles, listTemplates,
// listDisplays and the CCLI report ordered by before the core did, collation.rs): `songsView` in Swedish and in
// English on libraries of made-up names, each name of pieces a church's names have and some they rarely do (å ä ö and
// their Danish and German kin, v and w, accents decomposed and composed, case, digits, punctuation and dashes, other
// scripts, emoji), against the same rows ordered by `Intl.Collator(lang, { sensitivity: 'base' })`, a stable sort.
// The two take CLDR from different places (the core ICU4X's, Node its ICU's): a difference names the pair.
import { DatabaseSync } from 'node:sqlite';
import { viewRust } from '../diff.mjs';

let seed = 79;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (n) => Math.floor(rand() * n);

const PIECES = [
  'Ängel', 'angel', 'Ångest', 'ånger', 'Öga', 'öra', 'Ø', 'Æble', 'Ætt', 'ä', 'å', 'ö', 'A', 'a', 'Z', 'z', 'é', 'e', 'É', 'Ü', 'ü', 'y',
  'ß', 'ss', 'Wasa', 'Vasa', 'v', 'w', 'W', 'Härlig', 'härlig', 'Hos dig', 'Hosianna', '10', '2', '9a', '1:a', 'a-b', 'a b', 'ab',
  "'apostrof", '"Citat"', '(parentes)', '–tankstreck', '-bindestreck', '_under', '#1', '&', 'Ω', 'Я', 'ж', 'Ðan', 'þorn', 'ǆ', 'ﬁ',
  'Ａ', 'Ⅻ', 'ⅻ', '🎵', ' ', '  ', 'O store Gud', 'O Store Gud', 'Ö store Gud',
];
const name = () => {
  const n = Array.from({ length: 1 + int(3) }, () => pick(PIECES)).join(pick(['', ' ', '']));
  return rand() < 0.2 ? n.normalize('NFD') : n;
};

/** A copy of the demo's database in memory, with `n` more songs named as `name` makes them. */
function library(file, n) {
  const db = new DatabaseSync(':memory:');
  db.exec(`ATTACH '${file}' AS demo`);
  for (const { name: t, sql } of db.prepare("SELECT name, sql FROM demo.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    db.exec(sql);
    db.exec(`INSERT INTO main.${t} SELECT * FROM demo.${t}`);
  }
  const columns = db.prepare('PRAGMA table_info(songs)').all().map((c) => c.name);
  const values = columns.map((c) => (c === 'id' || c === 'name' ? '?' : c)).join(', ');
  const insert = db.prepare(`INSERT INTO songs (${columns.join(', ')}) SELECT ${values} FROM songs WHERE id = 'song-0'`);
  for (let i = 0; i < n; i++) {
    const [id, title] = [`made-${i}`, name()];
    insert.run(...columns.flatMap((c) => (c === 'id' ? [id] : c === 'name' ? [title] : [])));
  }
  return db;
}

export default async function check(_, file) {
  const differ = [];
  let compared = 0;
  for (let round = 0; round < 20; round++) {
    const db = library(file, 150);
    const rows = db.prepare('SELECT id, name FROM songs WHERE deleted_at IS NULL').all();
    for (const lang of ['sv', 'en']) {
      compared++;
      const byName = new Intl.Collator(lang, { sensitivity: 'base' }).compare;
      const want = rows.toSorted((a, b) => byName(a.name, b.name)).map((r) => r.name);
      const got = (await viewRust(db, 'songsView', { locale: lang })).map((r) => r.name);
      const at = want.findIndex((w, i) => w !== got[i]);
      if (at >= 0) differ.push(`songsView ${lang} round ${round} at ${at}: TS ${JSON.stringify(want.slice(Math.max(0, at - 2), at + 3))} Rust ${JSON.stringify(got.slice(Math.max(0, at - 2), at + 3))}`);
    }
  }
  return { compared, differ, notes: ['20 libraries of 150 made-up names more, in Swedish and English'] };
}
