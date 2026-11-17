// The Bible tab's references and books against 2.0's (238d481b), the core's pure views: a reference read as a plan
// (`verseSearchPlanView` against `planVerseSearch`, BIBLE-R11) for random queries made of every book's names and
// abbreviations, numbers, dashes, colons, spaces and case; and every book's names and testament (`bibleBookNamesView`
// against `swedishBookName`, `englishBookName`, `isOldTestament`), an unknown code too.
import { englishBookName, isOldTestament, planVerseSearch, swedishBookName } from '../.out/web-queries.mjs';
import { viewRust } from '../diff.mjs';
import { canon } from '../sources.mjs';
import { fixture } from './fixture.mjs';

const CODES = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const NAMES = ['1 mos', '1:a mosebok', 'första moseboken', 'andra mos', '5:e mos', 'gen', 'Genesis', 'joh', '1 joh', '3:e joh', 'johannes', 'John', 'ps', 'psalm', 'Psaltaren', 'höga visan', 'HV', 'song of songs', 'apg', 'acts', 'upp', 'jak', 'fil', 'filem', 'mat', 'ma', 'j', 'jo', 'x', '1', 'kö', 'kr', 'Ö', 'tess', '2 thess', 'jhn', 'PSA', 'ezk', 'Hes'];

export default async function check(_, file) {
  const db = fixture(file);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const n = () => String(1 + Math.floor(rand() * 30));
  const differ = [];
  let compared = 0;
  const books = [CODES, CODES.slice(0, 39), ['JHN', 'PSA', 'GEN'], ['1JN', '2JN', 'JHN'], []];
  const tails = [() => '', () => ` ${n()}`, () => ` ${n()}:${n()}`, () => ` ${n()}:${n()}-${n()}`, () => ` ${n()}-${n()}`, () => ` ${n()}:${n()}-${n()}:${n()}`, () => ` ${n()}:${n()}-`, () => ` ${n()}:`, () => ` ${n()}-`, () => `  ${n()} : ${n()} - ${n()} `, () => ` ${n()}:x`];
  for (let i = 0; i < 4000; i++) {
    const query = pick([(s) => s, (s) => s.toUpperCase(), (s) => ` ${s} `, (s) => s.normalize('NFD')])(pick(NAMES) + pick(tails)());
    const available = pick(books);
    compared++;
    const want = planVerseSearch(query, available);
    const got = await viewRust(db, 'verseSearchPlanView', { query, available });
    if (canon(want) !== canon(got)) differ.push(`verseSearchPlanView ${JSON.stringify(query)} in ${available.length}: TS ${canon(want)} Rust ${canon(got)}`);
  }
  for (const code of [...CODES, 'XYZ', 'jhn']) {
    compared++;
    const want = [{ code, sv: swedishBookName(code), en: englishBookName(code), oldTestament: isOldTestament(code) }];
    const got = await viewRust(db, 'bibleBookNamesView', { codes: [code] });
    if (canon(want) !== canon(got)) differ.push(`bibleBookNamesView ${code}: TS ${canon(want)} Rust ${canon(got)}`);
  }
  return { compared, differ, notes: ['4 000 random references read as plans, every book\'s names and testament, an unknown code'] };
}
