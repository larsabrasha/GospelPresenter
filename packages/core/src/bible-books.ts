// The books of the Bible: USX codes in canonical order, their Swedish and
// English names, and the names a reference may use (spec 05 BIBLE-R9–R11, D12).

interface Book {
  code: string;
  sv: string;
  en: string;
  /** Swedish names and abbreviations, lower case. A numbered book's are built from `ordinal` and `stems`. */
  aliases: string[];
}

const ORDINALS: Record<number, string[]> = {
  1: ['1 ', '1:a ', 'första '],
  2: ['2 ', '2:a ', 'andra '],
  3: ['3 ', '3:e ', 'tredje '],
  4: ['4 ', '4:e ', 'fjärde '],
  5: ['5 ', '5:e ', 'femte '],
};

/** "1 mos", "1:a mosebok", "första moseboken", … */
const numbered = (n: number, stems: string[]) => ORDINALS[n]!.flatMap((o) => stems.map((s) => o + s));

const b = (code: string, sv: string, en: string, aliases: string[]): Book => ({ code, sv, en, aliases });

/** The 66 books of the Protestant canon, in order. The first 39 are the Old Testament. */
const BOOKS: Book[] = [
  b('GEN', '1 Moseboken', 'Genesis', [...numbered(1, ['mos', 'mosebok', 'moseboken']), 'genesis', 'gen']),
  b('EXO', '2 Moseboken', 'Exodus', [...numbered(2, ['mos', 'mosebok', 'moseboken']), 'exodus', 'exo']),
  b('LEV', '3 Moseboken', 'Leviticus', [...numbered(3, ['mos', 'mosebok', 'moseboken']), 'leviticus', 'lev']),
  b('NUM', '4 Moseboken', 'Numbers', [...numbered(4, ['mos', 'mosebok', 'moseboken']), 'numeri', 'num']),
  b('DEU', '5 Moseboken', 'Deuteronomy', [...numbered(5, ['mos', 'mosebok', 'moseboken']), 'deuteronomium', 'deu']),
  b('JOS', 'Josua', 'Joshua', ['josua', 'jos']),
  b('JDG', 'Domarboken', 'Judges', ['domarboken', 'dom']),
  b('RUT', 'Rut', 'Ruth', ['rut']),
  b('1SA', '1 Samuel', '1 Samuel', numbered(1, ['sam', 'samuel', 'samuelsboken'])),
  b('2SA', '2 Samuel', '2 Samuel', numbered(2, ['sam', 'samuel', 'samuelsboken'])),
  b('1KI', '1 Kungaboken', '1 Kings', numbered(1, ['kung', 'kungaboken'])),
  b('2KI', '2 Kungaboken', '2 Kings', numbered(2, ['kung', 'kungaboken'])),
  b('1CH', '1 Krönikeboken', '1 Chronicles', numbered(1, ['krön', 'krönikeboken'])),
  b('2CH', '2 Krönikeboken', '2 Chronicles', numbered(2, ['krön', 'krönikeboken'])),
  b('EZR', 'Esra', 'Ezra', ['esra', 'esr']),
  b('NEH', 'Nehemja', 'Nehemiah', ['nehemja', 'neh']),
  b('EST', 'Ester', 'Esther', ['ester', 'est']),
  b('JOB', 'Job', 'Job', ['job']),
  b('PSA', 'Psaltaren', 'Psalms', ['psaltaren', 'ps', 'psa']),
  b('PRO', 'Ordspråksboken', 'Proverbs', ['ordspråksboken', 'ords', 'ordspr']),
  b('ECC', 'Predikaren', 'Ecclesiastes', ['predikaren', 'pred']),
  b('SNG', 'Höga visan', 'Song of Solomon', ['höga visan', 'höga', 'hv']),
  b('ISA', 'Jesaja', 'Isaiah', ['jesaja', 'jes', 'isa']),
  b('JER', 'Jeremia', 'Jeremiah', ['jeremia', 'jer']),
  b('LAM', 'Klagovisorna', 'Lamentations', ['klagovisorna', 'klag']),
  b('EZK', 'Hesekiel', 'Ezekiel', ['hesekiel', 'hes']),
  b('DAN', 'Daniel', 'Daniel', ['daniel', 'dan']),
  b('HOS', 'Hosea', 'Hosea', ['hosea', 'hos']),
  b('JOL', 'Joel', 'Joel', ['joel']),
  b('AMO', 'Amos', 'Amos', ['amos']),
  b('OBA', 'Obadja', 'Obadiah', ['obadja', 'ob']),
  b('JON', 'Jona', 'Jonah', ['jona']),
  b('MIC', 'Mika', 'Micah', ['mika', 'mic']),
  b('NAM', 'Nahum', 'Nahum', ['nahum', 'nah']),
  b('HAB', 'Habackuk', 'Habakkuk', ['habackuk', 'hab']),
  b('ZEP', 'Sefanja', 'Zephaniah', ['sefanja', 'sef']),
  b('HAG', 'Haggaj', 'Haggai', ['haggaj', 'hag']),
  b('ZEC', 'Sakarja', 'Zechariah', ['sakarja', 'sak']),
  b('MAL', 'Malaki', 'Malachi', ['malaki', 'mal']),
  b('MAT', 'Matteus', 'Matthew', ['matteus', 'matt', 'mat', 'matteusevangeliet']),
  b('MRK', 'Markus', 'Mark', ['markus', 'mark', 'mrk', 'markusevangeliet']),
  b('LUK', 'Lukas', 'Luke', ['lukas', 'luk', 'lukasevangeliet']),
  b('JHN', 'Johannes', 'John', ['johannes', 'joh', 'johannesevangeliet']),
  b('ACT', 'Apostlagärningarna', 'Acts', ['apostlagärningarna', 'apg']),
  b('ROM', 'Romarbrevet', 'Romans', ['romarbrevet', 'rom']),
  b('1CO', '1 Korintierbrevet', '1 Corinthians', numbered(1, ['kor', 'korintierbrevet'])),
  b('2CO', '2 Korintierbrevet', '2 Corinthians', numbered(2, ['kor', 'korintierbrevet'])),
  b('GAL', 'Galaterbrevet', 'Galatians', ['galaterbrevet', 'gal']),
  b('EPH', 'Efesierbrevet', 'Ephesians', ['efesierbrevet', 'ef']),
  b('PHP', 'Filipperbrevet', 'Philippians', ['filipperbrevet', 'fil']),
  b('COL', 'Kolosserbrevet', 'Colossians', ['kolosserbrevet', 'kol']),
  b('1TH', '1 Thessalonikerbrevet', '1 Thessalonians', numbered(1, ['thess', 'thessalonikerbrevet', 'tess'])),
  b('2TH', '2 Thessalonikerbrevet', '2 Thessalonians', numbered(2, ['thess', 'thessalonikerbrevet', 'tess'])),
  b('1TI', '1 Timoteusbrevet', '1 Timothy', numbered(1, ['tim', 'timoteusbrevet'])),
  b('2TI', '2 Timoteusbrevet', '2 Timothy', numbered(2, ['tim', 'timoteusbrevet'])),
  b('TIT', 'Titus', 'Titus', ['titus', 'tit']),
  b('PHM', 'Filemon', 'Philemon', ['filemon', 'filem']),
  b('HEB', 'Hebreerbrevet', 'Hebrews', ['hebreerbrevet', 'hebr', 'heb']),
  b('JAS', 'Jakobsbrevet', 'James', ['jakob', 'jak', 'jakobsbrevet']),
  b('1PE', '1 Petrusbrevet', '1 Peter', numbered(1, ['petr', 'petrusbrevet', 'pet'])),
  b('2PE', '2 Petrusbrevet', '2 Peter', numbered(2, ['petr', 'petrusbrevet', 'pet'])),
  b('1JN', '1 Johannesbrevet', '1 John', numbered(1, ['joh', 'johannesbrevet'])),
  b('2JN', '2 Johannesbrevet', '2 John', numbered(2, ['joh', 'johannesbrevet'])),
  b('3JN', '3 Johannesbrevet', '3 John', numbered(3, ['joh', 'johannesbrevet'])),
  b('JUD', 'Judasbrevet', 'Jude', ['judas', 'jud', 'judasbrevet']),
  b('REV', 'Uppenbarelseboken', 'Revelation', ['uppenbarelseboken', 'upp', 'upb']),
];

const byCode = new Map(BOOKS.map((book, i) => [book.code, { ...book, order: i }]));
const OLD_TESTAMENT = new Set(BOOKS.slice(0, 39).map((book) => book.code));

/**
 * Every name a reference may use, in a fixed order (ties in `resolveBook` go
 * to the first): the Swedish names and abbreviations, then the English
 * names (D12: book names resolve in English too), plus "psalm".
 */
const ALIASES: [string, string][] = [
  ...BOOKS.flatMap((book) => book.aliases.map((a): [string, string] => [a, book.code])),
  ...BOOKS.map((book): [string, string] => [book.en.toLowerCase(), book.code]),
  ['psalm', 'PSA'],
  ['song of songs', 'SNG'],
];
const EXACT = new Map<string, string>();
for (const [alias, code] of ALIASES) if (!EXACT.has(alias)) EXACT.set(alias, code);

/** The Swedish name of a book; a code we do not know shows as itself (spec 05 edge cases). */
export function swedishBookName(code: string): string {
  return byCode.get(code.toUpperCase())?.sv ?? code;
}

export function englishBookName(code: string): string {
  return byCode.get(code.toUpperCase())?.en ?? code;
}

/** Canonical order, GEN…REV; codes outside the 66 books come after, by code (BIBLE-R9). */
export function compareBooks(x: string, y: string): number {
  const ox = byCode.get(x.toUpperCase())?.order ?? Number.MAX_SAFE_INTEGER;
  const oy = byCode.get(y.toUpperCase())?.order ?? Number.MAX_SAFE_INTEGER;
  return ox - oy || x.localeCompare(y);
}

/** The 39 Protestant Old Testament books; everything else counts as the New (BIBLE-R10). */
export function isOldTestament(code: string): boolean {
  return OLD_TESTAMENT.has(code.toUpperCase());
}

/**
 * A book name or abbreviation to its code, case-insensitively (BIBLE-R11
 * step 5): an exact alias, else the longest alias that starts with the input.
 * Null when nothing matches.
 */
export function resolveBook(input: string): string | null {
  const q = input.normalize('NFC').trim().toLowerCase();
  if (!q) return null;
  const exact = EXACT.get(q);
  if (exact) return exact;
  let best: [string, string] | null = null;
  for (const entry of ALIASES) if (entry[0].startsWith(q) && entry[0].length > (best?.[0].length ?? 0)) best = entry;
  return best?.[1] ?? null;
}
