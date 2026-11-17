// The books of the Bible in canonical order, for the import to sort a translation's books by (BIBLE-R9). Their names,
// the names a reference may use and the testaments are the Rust core's (crates/gp-core/src/bible_books.rs).

/** The 66 books of the Protestant canon, in order, as USX codes. */
const CANON =
  'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(
    ' ',
  );
const order = new Map(CANON.map((code, i) => [code, i]));

/** Canonical order, GEN…REV; codes outside the 66 books come after, by code (BIBLE-R9). */
export function compareBooks(x: string, y: string): number {
  const ox = order.get(x.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  const oy = order.get(y.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  return ox - oy || x.localeCompare(y);
}
