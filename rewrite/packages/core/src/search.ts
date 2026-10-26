// Song search (spec 02, SONG-R30–R33): every term must start a word in the
// name, the author or the lyrics; accents are a fallback; hits are ranked.

/** What search needs of a song. `lyrics` is every part's text; `firstPart` the first part's. */
export interface SearchableSong {
  name: string;
  author: string | null;
  firstPart: string;
  lyrics: string;
}

/** Lower case and NFC, one code point for one code point, so positions match the NFC text. */
function lower(s: string): string {
  return Array.from(s.normalize('NFC'), (c) => {
    const l = c.toLowerCase();
    return [...l].length === 1 ? l : c;
  }).join('');
}

/** Each code point without its accents ("ä" → "a"), keeping the length. */
function fold(s: string): string {
  return Array.from(s, (c) => {
    const base = c.normalize('NFD').replace(/\p{M}/gu, '');
    return [...base].length === 1 ? base : c;
  }).join('');
}

const wordChar = /[\p{L}\p{N}]/u;

/** Where `term` starts a word in `text` (start of text, or after a non-letter, non-digit). */
function wordPrefixes(text: string, term: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    if (i === 0 || !wordChar.test(text[i - 1]!)) at.push(i);
  }
  return at;
}

function terms(query: string): string[] {
  return lower(query).trim().split(/\s+/).filter(Boolean);
}

interface Prepared {
  title: string;
  titleFolded: string;
  first: string;
  firstFolded: string;
  all: string;
  allFolded: string;
}

function prepare(s: SearchableSong): Prepared {
  const title = lower(s.name).trim();
  const first = lower(s.firstPart);
  const all = lower([s.name, s.author ?? '', s.lyrics].join('\n'));
  return { title, titleFolded: fold(title), first, firstFolded: fold(first), all, allFolded: fold(all) };
}

/** The score of one term: the first rule that applies (SONG-R33), or null if the term is nowhere. */
function termScore(p: Prepared, term: string): number | null {
  const folded = fold(term);
  const inTitle = wordPrefixes(p.title, term);
  if (inTitle.length) return 10 + (inTitle[0] === 0 ? 5 : 0);
  const inTitleFolded = wordPrefixes(p.titleFolded, folded);
  if (inTitleFolded.length) return 8 + (inTitleFolded[0] === 0 ? 5 : 0);
  if (wordPrefixes(p.first, term).length) return 3;
  if (wordPrefixes(p.firstFolded, folded).length) return 2.5;
  if (wordPrefixes(p.all, term).length) return 1;
  if (wordPrefixes(p.allFolded, folded).length) return 0.5;
  return null;
}

/** The whole-query bonuses (SONG-R33). */
function bonus(p: Prepared, ts: string[]): number {
  const phrase = ts.join(' ');
  const folded = fold(phrase);
  let b = 0;
  if (p.title === phrase) b += 100;
  else if (p.titleFolded === folded) b += 90;
  if (ts.length > 1) {
    if (wordPrefixes(p.title, phrase).length) b += 50;
    else if (wordPrefixes(p.titleFolded, folded).length) b += 45;
    else if (wordPrefixes(p.first, phrase).length) b += 25;
    else if (wordPrefixes(p.firstFolded, folded).length) b += 22;
    else if (wordPrefixes(p.all, phrase).length) b += 10;
    else if (wordPrefixes(p.allFolded, folded).length) b += 8;
  }
  return b;
}

/**
 * The songs that match every term, best first. `songs` comes in library
 * order, which ties keep. A blank query returns them all (SONG-R30).
 */
export function searchSongs<T extends SearchableSong>(songs: T[], query: string): T[] {
  const ts = terms(query);
  if (!ts.length) return songs;
  const hits: { song: T; score: number }[] = [];
  for (const song of songs) {
    const p = prepare(song);
    let score = 0;
    let all = true;
    for (const term of ts) {
      const s = termScore(p, term);
      if (s === null) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ song, score: score + bonus(p, ts) });
  }
  return hits.toSorted((a, b) => b.score - a.score).map((h) => h.song);
}

/** `text` (as NFC) cut into pieces, with the word prefixes that match a query term marked (SONG-A20). */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const nfc = text.normalize('NFC');
  const l = lower(nfc);
  const lf = fold(l);
  const marked = Array.from({ length: nfc.length }, () => false);
  for (const term of terms(query)) {
    for (const [hay, needle] of [
      [l, term],
      [lf, fold(term)],
    ] as const) {
      for (const at of wordPrefixes(hay, needle)) marked.fill(true, at, at + needle.length);
    }
  }
  const pieces: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < nfc.length; i++) {
    const last = pieces.at(-1);
    if (last && last.hit === marked[i]) last.text += nfc[i];
    else pieces.push({ text: nfc[i]!, hit: marked[i]! });
  }
  return pieces;
}
