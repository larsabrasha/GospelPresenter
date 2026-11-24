// A translation imported from a .zip of USX or USFM (spec 05 BIBLE-R3–R6; ADR 0008, ported back from
// crates/gp-core/src/bible_import.rs, itself from bible-import.ts at 238d481b). It runs on the device that imports, so
// a desktop host needs no internet and the server never parses a zip: the core's zip reader (zip.ts), a small XML
// reader, and readers of the two formats.
import { compareBooks, swedishBookName } from '../bible-books.ts';
import { BIBLE_LIMITS, BIBLE_ZIP_MAX_BYTES, type BibleBookText } from '../bible.ts';
import { cutChars } from '../chars.ts';
import { FIELD_RULES, MutationError } from '../mutation.ts';
import { utf8Decode } from '../platform.ts';
import { readZip, zipEntryBytes, type ZipEntry } from '../zip.ts';
import { wellFormed } from './files-json.ts';
import { byUnits } from './serde.ts';

type Verse = BibleBookText['verses'][number];
type Book = BibleBookText;

const refuse = (code: string): never => {
  throw new MutationError(code);
};

/** An entry's text: stored, or DEFLATE (`zipEntryBytes`). */
const textOf = (data: Uint8Array, e: ZipEntry) => utf8Decode(zipEntryBytes(data, e));

// ------------------------------------------------------------------ XML

interface El {
  name: string;
  attrs: Map<string, string>;
  children: (El | string)[];
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** A numeric entity's character: none for 0 or past U+10FFFF, U+FFFD for a surrogate. */
const codePoint = (n: bigint) => (n > 0n && n <= 0x10ffffn ? (n >= 0xd800n && n <= 0xdfffn ? '�' : String.fromCodePoint(Number(n))) : '');
/** u128's parse: none past it. */
const parsed = (digits: string, radix: 10 | 16) => {
  const n = BigInt(radix === 16 ? `0x${digits}` : digits);
  return n < 2n ** 128n ? codePoint(n) : '';
};

/** `&amp;` and the four others, and `&#229;` `&#xE5;`; an entity it does not know stays as it is. */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(\w+));/g, (whole, hex?: string, dec?: string, name?: string) =>
    hex !== undefined ? parsed(hex, 16) : dec !== undefined ? parsed(dec, 10) : (NAMED[name!] ?? whole),
  );
}

const SPACE = /\s/;
/** The attributes of a start tag's body after its name. */
function attributes(s: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of s.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs.set(m[1]!, decodeEntities(m[3] ?? m[4] ?? ''));
  return attrs;
}

/** XML into elements and text: enough for USX and DBL metadata (no namespaces or DTDs). */
function parseXml(xml: string): El {
  const stack: El[] = [{ name: '#document', attrs: new Map(), children: [] }];
  const top = () => stack[stack.length - 1]!;
  const close = () => {
    const el = stack.pop()!;
    top().children.push(el);
  };
  const find = (from: number, pat: string) => xml.indexOf(pat, Math.min(from, xml.length));
  let i = 0;
  while (i < xml.length) {
    const lt = find(i, '<');
    if (lt < 0) {
      top().children.push(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(xml.slice(i, lt)));
    const next = xml[lt + 1];
    if (xml.startsWith('<!--', lt)) {
      const e = find(lt + 4, '-->');
      i = e < 0 ? xml.length : e + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = find(lt + 9, ']]>');
      top().children.push(xml.slice(lt + 9, e < 0 ? xml.length : e));
      i = e < 0 ? xml.length : e + 3;
    } else if (next === '?' || next === '!') {
      const e = find(lt, '>');
      i = e < 0 ? xml.length : e + 1;
    } else if (next === '/') {
      const e = find(lt, '>');
      const stop = e < 0 ? xml.length : e;
      const name = xml.slice(Math.min(lt + 2, stop), stop).trim();
      // Close up to the matching element; a stray end tag is ignored.
      const at = stack.findLastIndex((el) => el.name === name);
      if (at > 0) while (stack.length > at) close();
      i = e < 0 ? xml.length : e + 1;
    } else {
      // A start tag: its end outside quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      while (j < xml.length && (quote !== null || xml[j] !== '>')) {
        const c = xml[j]!;
        if (quote !== null) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        j++;
      }
      let body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      let n = 0;
      while (n < body.length && !SPACE.test(body[n]!) && body[n] !== '/' && body[n] !== '>') n++;
      const el: El = { name: body.slice(0, n), attrs: attributes(body.slice(n)), children: [] };
      if (selfClosing) top().children.push(el);
      else stack.push(el);
      i = j + 1;
    }
  }
  while (stack.length > 1) close();
  return stack[0]!;
}

const elements = (el: El) => el.children.filter((c): c is El => typeof c !== 'string');
const child = (el: El | undefined, name: string) => (el ? elements(el).find((c) => c.name === name) : undefined);
const textIn = (el: El): string => el.children.map((c) => (typeof c === 'string' ? c : textIn(c))).join('');

// ------------------------------------------------------------------ verses

/** Collects verse text: fragments joined as they stand, a paragraph or line break a space, white space runs one space. */
class Verses {
  private chapter: number | null = null;
  private current: Verse | null = null;
  readonly verses: Verse[] = [];
  startChapter(n: number) {
    this.endVerse();
    this.chapter = n;
  }
  /** `number` may be a range ("5-6"): the verse is the first number (BIBLE-R6). */
  startVerse(number: string) {
    this.endVerse();
    const v = parseInt(number, 10);
    if (this.chapter !== null && Number.isFinite(v)) this.current = [this.chapter, v, ''];
  }
  endVerse() {
    if (this.current) this.verses.push([this.current[0], this.current[1], this.current[2].replace(/\s+/g, ' ').trim()]);
    this.current = null;
  }
  text(s: string) {
    if (this.current) this.current[2] += s;
  }
  space() {
    this.text(' ');
  }
}

/** Paragraph styles that hold headings and metadata, not verse text (BIBLE-R6, plus psalm titles and the like). */
const NON_CONTENT_STYLES = new Set([
  'ide', 'rem', 'h', 'h1', 'h2', 'h3', 'toc1', 'toc2', 'toc3', 'toca1', 'toca2', 'toca3', 'mt', 'mt1', 'mt2', 'mt3', 'mt4', 'mte',
  'mte1', 'mte2', 's', 's1', 's2', 's3', 's4', 'sr', 'ms', 'ms1', 'ms2', 'ms3', 'mr', 'r', 'sp', 'd', 'qa', 'cl', 'cd',
]);
/** Book codes of front and back matter: never Bible text. */
const PERIPHERALS = new Set(['FRT', 'BAK', 'OTH', 'INT', 'CNC', 'GLO', 'TDX', 'NDX']);
const bookOf = (code: string, verses: Verse[]): Book | null => (/^[0-9A-Z]{3}$/.test(code) ? { code, verses } : null);

/** One USX file (USX 2 or 3) to its book. Text before the first chapter, headings, notes and figures are left out. */
function parseUsx(xml: string): Book | null {
  const usx = elements(parseXml(xml)).find((e) => e.name === 'usx');
  if (!usx) return null;
  const code = (child(usx, 'book')?.attrs.get('code') ?? '').toUpperCase();
  const out = new Verses();
  const walk = (el: El) => {
    for (const node of el.children) {
      if (typeof node === 'string') out.text(node.replaceAll('\n', ' '));
      else if (node.name === 'verse') {
        const number = node.attrs.get('number');
        if (number !== undefined) out.startVerse(number);
        else if (node.attrs.has('eid')) out.endVerse();
      } else if (node.name !== 'note' && node.name !== 'figure' && node.name !== 'sidebar') walk(node);
    }
  };
  let inChapters = false;
  for (const el of elements(usx)) {
    if (el.name === 'chapter') {
      const number = el.attrs.get('number');
      if (number !== undefined) {
        inChapters = true;
        out.startChapter(parseInt(number, 10));
      }
    } else if (!inChapters) continue;
    else if ((el.name === 'para' && !NON_CONTENT_STYLES.has(el.attrs.get('style') ?? '')) || el.name === 'table' || el.name === 'list') {
      out.space();
      walk(el);
      out.space();
    }
  }
  out.endVerse();
  return bookOf(code, out.verses);
}

/** Character markers whose text is not the verse's (footnotes, cross-references), and those whose text is. */
const USFM_SKIP_SPANS = new Set(['f', 'fe', 'ef', 'x', 'ex', 'fig', 'ca', 'va', 'vp', 'rq']);
const USFM_CHARACTER = new Set([
  'add', 'bk', 'dc', 'k', 'nd', 'ord', 'pn', 'png', 'addpn', 'qt', 'sig', 'sls', 'tl', 'wj', 'em', 'bd', 'it', 'bdit', 'no', 'sc', 'sup',
  'w', 'wg', 'wh', 'wa', 'ior', 'iqt', 'jmp', 'qs', 'qac', 'rb', 'pro', 'ndx', 'lit', 'litl', 'liv',
]);
const USFM_SKIP_PARAGRAPHS = new Set([...NON_CONTENT_STYLES, 'id', 'usfm', 'sts', 'cp']);

/** One USFM file to its book (BIBLE-R6): verse text without footnotes, cross-references and headings. */
function parseUsfm(usfm: string): Book | null {
  // `\w word|strong="H1"\w*`: the attributes after the bar are not text.
  const text = usfm.replace(/\|[^\\]*(?=\\\+?[a-z0-9]+\*)/gi, '');
  const out = new Verses();
  let code = '';
  let skipParagraph = false;
  let skipSpan: string | null = null;
  let pending: 'chapter' | 'verse' | 'id' | null = null;
  // A backslash that starts no marker is dropped; an opening marker takes one space or tab after it.
  for (const [, marker, after, plain] of text.matchAll(/\\\+?([a-z]+[0-9]*(?:-[se])?)(\*|[ \t]?)|\\|([^\\]+)/gi)) {
    if (plain !== undefined) {
      let s = plain;
      if (pending) {
        const m = /^\s*(\S*)/.exec(s)!;
        const value = m[1]!;
        if (pending === 'chapter') {
          out.startChapter(parseInt(value, 10));
          skipParagraph = false;
        } else if (pending === 'verse') {
          out.startVerse(value);
          skipParagraph = false;
        } else code = value.toUpperCase();
        if (value) s = s.slice(m[0].length);
        if (pending === 'id') s = '';
        pending = null;
      }
      if (!skipParagraph && skipSpan === null) out.text(s.replace(/\s+/g, ' '));
      continue;
    }
    if (marker === undefined) continue;
    const name = marker.toLowerCase();
    const close = after === '*';
    if (skipSpan !== null) {
      if (close && name === skipSpan) skipSpan = null;
      continue;
    }
    if (close) continue; // the end of a character style: its text is already in
    if (USFM_SKIP_SPANS.has(name)) skipSpan = name;
    else if (USFM_CHARACTER.has(name) || /^[fx][a-z]+$/.test(name)) continue;
    else if (name === 'c') pending = 'chapter';
    else if (name === 'v') pending = 'verse';
    else if (name === 'id') {
      pending = 'id';
      skipParagraph = true;
    } else {
      // A paragraph marker: a break between words, and maybe a heading to leave out.
      out.space();
      skipParagraph = USFM_SKIP_PARAGRAPHS.has(name) || /^i[a-z]*[0-9]*$/.test(name);
    }
  }
  out.endVerse();
  return bookOf(code, out.verses);
}

// ------------------------------------------------------------------ the zip

const fileOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).toLowerCase();
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** The initials of a title's capitalised words, two or more ("Svenska Folkbibeln" SF). */
function initials(title: string): string | null {
  const letters = title
    .split(/\s/)
    .map((w) => String.fromCodePoint(w.codePointAt(0) ?? 0x20))
    .filter((c) => /^\p{Lu}$/u.test(c))
    .map((c) => (c.length > 1 ? '�' : c));
  return letters.length >= 2 ? letters.join('') : null;
}

/** The first title of an HTML page. */
function htmlTitle(html: string): string | null {
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const start = lower.indexOf('<title');
  const open = start < 0 ? -1 : lower.indexOf('>', start);
  const close = open < 0 ? -1 : lower.indexOf('</title>', open + 1);
  return close < 0 ? null : html.slice(open + 1, close);
}

/** The canonical order of two books (BIBLE-R9): the 66 books first, the others after by code. */
const known = (code: string) => swedishBookName(code) !== code;
const byBook = (x: Book, y: Book) => (known(x.code) || known(y.code) ? compareBooks(x.code, y.code) : byUnits(x.code, y.code));

/** `a - b || c - d` as a sort reads it: NaN and 0 alike are no answer. */
function byVerse(x: Verse, y: Verse): number {
  let d = x[0] - y[0];
  if (d === 0 || Number.isNaN(d)) d = x[1] - y[1];
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** Rust's stable sort: insertion for 20 or fewer, as a comparison that is not an order (NaN chapters) then sorts. */
function sorted<T>(xs: T[], by: (x: T, y: T) => number): T[] {
  if (xs.length > 20) return xs.toSorted(by);
  const out = [...xs];
  for (let i = 1; i < out.length; i++) {
    const x = out[i]!;
    let j = i;
    for (; j > 0 && by(x, out[j - 1]!) < 0; j--) out[j] = out[j - 1]!;
    out[j] = x;
  }
  return out;
}

/** Books in canonical order and each book's verses by chapter and verse (BIBLE-R9). */
export const sortBibleBooks = (books: BibleBookText[]): BibleBookText[] => sorted(books, byBook).map((b) => ({ code: b.code, verses: sorted(b.verses, byVerse) }));

/** A number as JSON from JavaScript has it: whole numbers as integers, NaN and infinities as null. */
const number = (f: number) => (Number.isFinite(f) ? f : null);

/**
 * A translation from a zip (BIBLE-R3): DBL metadata (`metadata.xml`) or eBible's `copr.htm` for its name, then USX
 * books from `USX_1/` or `USX_2/` beside the metadata, else any `.usx`, else every `.usfm`/`.sfm`. Books without
 * verses and front or back matter are left out; books come in canonical order, their verses by chapter and verse.
 * Files are taken in the order of their names (by code unit), the first of two with one book's code kept.
 */
export function importZip(data: Uint8Array): unknown {
  if (data.length > BIBLE_ZIP_MAX_BYTES) refuse('too-large');
  const entries = readZip(data).filter((e) => !e.name.endsWith('/') && e.size > 0);
  let name = 'Unknown Bible';
  let abbreviation = 'UNKNOWN';
  let language: string | null = null;
  const metadata = entries.find((e) => fileOf(e.name) === 'metadata.xml');
  const root = metadata ? dirOf(metadata.name) : '';
  if (metadata) {
    const meta = elements(parseXml(textOf(data, metadata)))[0];
    const id = child(meta, 'identification');
    const pick = (...names: string[]) => names.flatMap((n) => child(id, n) ?? []).map((e) => textIn(e).trim()).find(Boolean);
    name = pick('nameLocal', 'name') ?? name;
    abbreviation = pick('abbreviationLocal', 'abbreviation') ?? abbreviation;
    const iso = child(child(meta, 'language'), 'iso');
    language = (iso && textIn(iso).trim()) || null;
  } else {
    const copr = entries.find((e) => fileOf(e.name) === 'copr.htm');
    const title = copr && htmlTitle(textOf(data, copr))?.replace(/\s+/g, ' ').trim();
    if (title) {
      abbreviation = initials(title) ?? abbreviation;
      name = title;
    }
  }

  const under = (dir: string) => entries.filter((e) => e.name.startsWith(dir) && e.name.toLowerCase().endsWith('.usx'));
  let files = under(`${root}USX_1/`);
  if (!files.length) files = under(`${root}USX_2/`);
  if (!files.length) files = under('');
  const usx = files.length > 0;
  if (!usx) files = entries.filter((e) => /\.(usfm|sfm)$/.test(e.name.toLowerCase()));
  if (!files.length) refuse('no-files');

  const books: Book[] = [];
  for (const file of files.toSorted((x, y) => byUnits(x.name, y.name))) {
    const text = textOf(data, file);
    const book = usx ? parseUsx(text) : parseUsfm(text);
    if (book && book.verses.length && !PERIPHERALS.has(book.code) && !books.some((b) => b.code === book.code)) books.push(book);
  }
  if (!books.length) refuse('no-verses');
  return {
    name: cutChars(name, FIELD_RULES.name.max),
    abbreviation: cutChars(abbreviation, BIBLE_LIMITS.abbreviation),
    language: language === null ? null : cutChars(language, BIBLE_LIMITS.language),
    books: sortBibleBooks(books).map((b) => ({ code: b.code, verses: b.verses.map(([c, v, t]) => [number(c), number(v), wellFormed(t)]) })),
  };
}
