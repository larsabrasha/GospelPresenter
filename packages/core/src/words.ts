// How search reads text (spec 02, SONG-R31, R32), one rule for finding a song and for marking the hit (SONG-A20): a
// text lowered and folded code point by code point, so positions keep, and where a word starts.

/** Each code point's `lower` and `fold`, worked out once: a library has few distinct ones, and normalising each anew was most of preparing it. */
const lowerOf = new Map<string, string>();
const foldOf = new Map<string, string>();

/** Lower case and NFC, one code point for one code point, so positions match the NFC text. */
export function lower(s: string): string {
  let out = '';
  for (const c of s.normalize('NFC')) {
    let l = lowerOf.get(c);
    if (l === undefined) {
      const x = c.toLowerCase();
      lowerOf.set(c, (l = [...x].length === 1 ? x : c));
    }
    out += l;
  }
  return out;
}

/** Each code point without its accents ("ä" → "a"), keeping the length. */
export function fold(s: string): string {
  let out = '';
  for (const c of s) {
    let base = foldOf.get(c);
    if (base === undefined) {
      const x = c.normalize('NFD').replace(/\p{M}/gu, '');
      foldOf.set(c, (base = [...x].length === 1 ? x : c));
    }
    out += base;
  }
  return out;
}

/**
 * Whether `c`, a code point or a UTF-16 unit, is a letter or a digit of the BMP, as the Rust core's `word_char` had it:
 * numeric, or alphabetic but for marks and the circled letters (what Other_Alphabetic adds). A character past the BMP
 * (or half of one) is none, so a term right after one starts a word.
 */
export function wordChar(c: string): boolean {
  const cp = c.codePointAt(0)!;
  if (cp > 0xffff) return false;
  return /\p{N}/u.test(c) || (/\p{Alphabetic}/u.test(c) && !/\p{M}/u.test(c) && !(cp >= 0x24b6 && cp <= 0x24e9));
}

/** A query's terms: lowered, trimmed and split on white space. */
export const terms = (query: string): string[] => lower(query).trim().split(/\s+/).filter(Boolean);
