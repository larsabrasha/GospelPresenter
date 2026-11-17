// The Bible tab's reads against 2.0's (238d481b): the text's books (`bibleBooks`), a book's chapters and a chapter's
// verses (BibleTab.tsx's `chaptersOf`, `versesOf`), a browsed passage (`versesInRange`) and a searched one
// (`searchVerses`, its reference planned by `planVerseSearch`), on a made-up text of three books stored as the app
// stores one (`storeBibleTextSql`), and a text this database does not have.
import { bibleBooks, bibleItemSlides, bibleLabel, bibleTitle, planVerseSearch, searchVerses, splitBibleSlides, storeBibleTextSql, versesInRange } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';
import { readDb } from './web-db.mjs';

const HASH = 'f'.repeat(64);

/** Made-up verses (no real text): chapters of uneven length, with a verse number missing and Unicode in the text. */
function madeUp() {
  const book = (code, chapters) => ({
    code,
    verses: chapters.flatMap((n, i) => Array.from({ length: n }, (_, v) => [i + 1, v + (v > 3 && i === 1 ? 2 : 1), `${code} ${i + 1}:${v + 1} – åäö “citat”`])),
  });
  return [book('GEN', [5, 7, 3]), book('PSA', [2, 1, 9, 4]), book('JHN', [4, 6])];
}

export default async function check(_, file) {
  const db = fixture(file);
  const books = madeUp();
  for (const s of storeBibleTextSql(HASH, books)) db.prepare(s.sql).run(...s.params);
  const ref = await bibleBooks(readDb(db), HASH);
  const differ = [];
  let compared = 0;
  const same = async (args, want, pick) => {
    compared++;
    const got = pick(await viewRust(db, 'bibleView', args));
    if (canon(want) !== canon(got)) differ.push(`bibleView ${JSON.stringify(args)}: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  await same({ hash: HASH }, ref.map((b) => b.code), (r) => r.books);
  await same({ hash: 'e'.repeat(64) }, await bibleBooks(readDb(db), 'e'.repeat(64)), (r) => r);
  // The tab's preview of a passage (`bibleSlidesView`, pure): the title and slides 2.0 worked out on the page.
  const preview = async (verses) => {
    compared++;
    const want = { title: bibleTitle(verses), label: bibleLabel(verses), slides: bibleItemSlides(bibleTitle(verses), { translation: 'SFB', slides: splitBibleSlides(verses) }) };
    const got = await viewRust(db, 'bibleSlidesView', { translation: 'SFB', verses });
    if (canon(want) !== canon({ title: got.title, label: got.label, slides: got.slides })) differ.push(`bibleSlidesView ${verses.length} verses: TS ${canon(want).slice(0, 300)} Rust ${canon(got).slice(0, 300)}`);
  };
  for (const b of ref) {
    const chapters = [...new Set(b.verses.map(([c]) => c))];
    await same({ hash: HASH, book: b.code }, chapters, (r) => r.chapters);
    for (const chapter of [...chapters, 99]) await same({ hash: HASH, book: b.code, chapter }, b.verses.filter(([c]) => c === chapter), (r) => r.verses);
    // Every browse: each start, and each end from it (BibleTab's `browseVerses`).
    const points = b.verses.map(([c, v]) => [c, v]);
    for (const from of points) {
      for (const to of points.filter(([c, v]) => c > from[0] || (c === from[0] && v >= from[1])).slice(0, 6)) {
        await same({ hash: HASH, book: b.code, passage: { books: [b.code], from, to } }, versesInRange(b, from, to), (r) => r.passage);
        await preview(versesInRange(b, from, to));
      }
    }
  }
  const queries = ['gen 1', 'Gen 2:3', 'GEN 2:3-', '1 mos 1:2-3', 'gen 1:4-2:6', 'gen 2-3', 'Psaltaren 3:2-5', 'ps', 'Joh 2:1-4', 'j', 'jhn 9', 'xyz 1', 'gen', ''];
  for (const q of queries) {
    const plan = planVerseSearch(q, ref.map((b) => b.code));
    if (plan) await same({ hash: HASH, passage: { books: plan.codes, from: plan.from, to: plan.to } }, searchVerses(q, ref), (r) => r.passage);
    else if (searchVerses(q, ref).length) differ.push(`${q}: no plan, but TS finds verses`);
  }
  return { compared, differ, notes: ['a text\'s books, chapters, verses, every browse and searches, and a text not here; each browse\'s preview'] };
}
