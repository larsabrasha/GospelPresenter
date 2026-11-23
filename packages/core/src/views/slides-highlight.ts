// A search hit's marking (SONG-A20; ADR 0008, ported back from crates/gp-core/src/search.rs's `highlight`): the text
// cut into pieces with the word prefixes that match a query term marked, as typed or without accents. It works code
// point by code point, as the Rust core did, with search's own reading of a text (words.ts).
import { fold, lower, terms, wordChar } from '../words.ts';
import { argsOf, asStr } from './serde.ts';

/** `highlightView` {text, query}: `text`, as NFC, in pieces `{text, hit}`. */
export function highlightView(args: unknown): { text: string; hit: boolean }[] {
  const a = argsOf(args);
  const text = asStr(a.text) ?? '';
  const nfc = [...text.normalize('NFC')];
  const l = [...lower(text)];
  const lf = [...fold(l.join(''))];
  const marked = nfc.map(() => false);
  for (const term of terms(asStr(a.query) ?? '')) {
    for (const [hay, needle] of [
      [l, [...term]],
      [lf, [...fold(term)]],
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
