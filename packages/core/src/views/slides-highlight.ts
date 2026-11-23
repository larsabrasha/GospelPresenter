// A search hit's marking (SONG-A20; ADR 0008, ported back from crates/gp-core/src/search.rs's `highlight`): the text
// cut into pieces with the word prefixes that match a query term marked, as typed or without accents. It works code
// point by code point, as the Rust core did; search.ts's `highlight` (2.0's, by UTF-16 unit) is not the same.
import { argsOf, asStr } from './serde.ts';

/** Each code point lowered where it lowers to one code point, after NFC. */
const lower = (s: string): string[] =>
  [...s.normalize('NFC')].map((c) => {
    const x = c.toLowerCase();
    return [...x].length === 1 ? x : c;
  });

/** Each code point without its accents ("ä" → "a") where that leaves one code point. */
const fold = (cs: string[]): string[] =>
  cs.map((c) => {
    const base = [...c.normalize('NFD')].filter((d) => !/\p{M}/u.test(d));
    return base.length === 1 ? base[0]! : c;
  });

/**
 * A letter or a digit of the BMP, as Rust's `word_char`: numeric, or alphabetic but for marks and the circled letters
 * (what Other_Alphabetic adds); a character past the BMP is none.
 */
function wordChar(c: string): boolean {
  const cp = c.codePointAt(0)!;
  if (cp > 0xffff) return false;
  return /\p{N}/u.test(c) || (/\p{Alphabetic}/u.test(c) && !/\p{M}/u.test(c) && !(cp >= 0x24b6 && cp <= 0x24e9));
}

/** `terms`: lowered, trimmed and split on white space as JavaScript reads it. */
const terms = (query: string): string[] => lower(query).join('').trim().split(/\s+/).filter(Boolean);

/** `highlightView` {text, query}: `text`, as NFC, in pieces `{text, hit}`. */
export function highlightView(args: unknown): { text: string; hit: boolean }[] {
  const a = argsOf(args);
  const text = asStr(a.text) ?? '';
  const nfc = [...text.normalize('NFC')];
  const l = lower(text);
  const lf = fold(l);
  const marked = nfc.map(() => false);
  for (const term of terms(asStr(a.query) ?? '')) {
    for (const [hay, needle] of [
      [l, [...term]],
      [lf, fold([...term])],
    ] as const) {
      if (!needle.length || needle.length > hay.length) continue;
      for (let i = 0; i + needle.length <= hay.length; i++) {
        if ((i === 0 || !wordChar(hay[i - 1]!)) && needle.every((c, k) => hay[i + k] === c)) marked.fill(true, i, Math.min(i + needle.length, nfc.length));
      }
    }
  }
  const pieces: { text: string; hit: boolean }[] = [];
  nfc.forEach((c, i) => {
    const last = pieces.at(-1);
    if (last && last.hit === marked[i]) last.text += c;
    else pieces.push({ text: c, hit: marked[i]! });
  });
  return pieces;
}
