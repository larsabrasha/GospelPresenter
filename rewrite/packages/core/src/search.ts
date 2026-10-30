// Song search (spec 02, SONG-R30–R33): every term must start a word in the
// name, the author or the lyrics; accents are a fallback; hits are ranked.

/** What search needs of a song. `lyrics` is every part's text; `firstPart` the first part's. */
export interface SearchableSong {
  name: string;
  author: string | null;
  firstPart: string;
  lyrics: string;
}

/** Each code point's `lower` and `fold`, worked out once: a library has few distinct ones, and normalising each anew was most of preparing it. */
const lowerOf = new Map<string, string>();
const foldOf = new Map<string, string>();

/** Lower case and NFC, one code point for one code point, so positions match the NFC text. */
function lower(s: string): string {
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
function fold(s: string): string {
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

/**
 * A song's texts as search reads them: lowered (NFC), and folded without
 * accents. Preparing is most of a search's time, so a device keeps them
 * until the songs change (`SongSearch`, packages/sync's song-search.ts).
 */
export interface PreparedSong {
  /** The name. */
  title: string;
  titleFolded: string;
  /** The first part. */
  first: string;
  firstFolded: string;
  /** The name, the author and every part. */
  all: string;
  allFolded: string;
}

/**
 * Each song's prepared texts, kept while the song object lives, for a library
 * searched again on every keystroke. A song object is never changed in place;
 * a changed song is a new object.
 */
const prepared = new WeakMap<SearchableSong, PreparedSong>();

function prepare(s: SearchableSong): PreparedSong {
  let p = prepared.get(s);
  if (!p) prepared.set(s, (p = prepareSong(s)));
  return p;
}

/**
 * Every run of white space as one space: a phrase typed as it is sung, over a
 * line break of the lyrics, is then found as a phrase. Not in the old app; the
 * marking (`highlight`) reads the text itself, so it is not affected.
 */
const spaced = (s: string) => s.replace(/\s+/g, ' ');

/** What search reads of a song (`PreparedSong`). */
export function prepareSong(s: SearchableSong): PreparedSong {
  const title = spaced(lower(s.name).trim());
  const first = spaced(lower(s.firstPart));
  const all = spaced(lower([s.name, s.author ?? '', s.lyrics].join('\n')));
  return { title, titleFolded: fold(title), first, firstFolded: fold(first), all, allFolded: fold(all) };
}

/** The score of one term: the first rule that applies (SONG-R33), or null if the term is nowhere. */
function termScore(p: PreparedSong, term: string): number | null {
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
function bonus(p: PreparedSong, ts: string[]): number {
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
  return rankSongs(songs, prepare, query);
}

/** `searchSongs` over songs whose texts are prepared already: `texts` gives each one's. */
export function rankSongs<T>(songs: T[], texts: (song: T) => PreparedSong, query: string): T[] {
  const ts = terms(query);
  if (!ts.length) return songs;
  const hits: { song: T; score: number }[] = [];
  for (const song of songs) {
    const p = texts(song);
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
