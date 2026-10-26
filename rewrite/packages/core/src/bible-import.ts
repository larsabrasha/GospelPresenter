import { sortBibleBooks, type BibleBookText } from './bible.ts';
import { inflateRaw, utf8Decode, utf8Encode } from './platform.ts';

// Importing a translation from a .zip of USX or USFM (spec 05 BIBLE-R3–R6).
// It runs on the device that imports, so a desktop host needs no internet and
// the server never parses a zip. No library: a zip reader over the platform's
// DEFLATE, and small readers for the two formats.

/** A refusal the user sees after "Importen misslyckades: ". */
export class BibleImportError extends Error {}

export interface ImportedBible {
  name: string;
  abbreviation: string;
  /** ISO 639 code from the metadata, if it has one. */
  language: string | null;
  books: BibleBookText[];
}

/** 50 MiB, as the current app (BIBLE-R2). */
export const BIBLE_ZIP_MAX_BYTES = 52_428_800;

// ------------------------------------------------------------------ zip

export interface ZipEntry {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
}

const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const u32 = (d: Uint8Array, o: number) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

/** The entries of a zip file, from its central directory. Stored and DEFLATE entries can be read. */
export function readZip(data: Uint8Array): ZipEntry[] {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (u32(data, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new BibleImportError('Filen är inte en giltig zip-fil.');
  const count = u16(data, end + 10);
  let p = u32(data, end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || u32(data, p) !== 0x02014b50) throw new BibleImportError('Filen är inte en giltig zip-fil.');
    const method = u16(data, p + 10);
    const compressed = u32(data, p + 20);
    const size = u32(data, p + 24);
    const nameLength = u16(data, p + 28);
    const extraLength = u16(data, p + 30);
    const commentLength = u16(data, p + 32);
    const local = u32(data, p + 42);
    const name = utf8Decode(data.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    entries.push({
      name,
      size,
      async read() {
        if (u32(data, local) !== 0x04034b50) throw new BibleImportError('Filen är inte en giltig zip-fil.');
        const start = local + 30 + u16(data, local + 26) + u16(data, local + 28);
        const raw = data.subarray(start, start + compressed);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new BibleImportError(`Zip-filen använder en komprimering som inte stöds (${method}).`);
      },
    });
  }
  return entries;
}

// ------------------------------------------------------------------ XML

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e] ?? whole;
  });
}

/** Parses XML into elements and text: enough for USX and DBL metadata (no namespaces or DTDs). */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1]!;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top().children.push(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e === -1 ? xml.length : e + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top().children.push(xml.slice(lt + 9, e === -1 ? xml.length : e));
      i = e === -1 ? xml.length : e + 3;
    } else if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const e = xml.indexOf('>', lt);
      i = e === -1 ? xml.length : e + 1;
    } else if (xml[lt + 1] === '/') {
      const e = xml.indexOf('>', lt);
      const name = xml.slice(lt + 2, e === -1 ? xml.length : e).trim();
      // Close up to the matching element; a stray end tag is ignored.
      const at = stack.findLastIndex((el) => el.name === name);
      if (at > 0) stack.length = at;
      i = e === -1 ? xml.length : e + 1;
    } else {
      // A start tag: find its end outside quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      while (j < xml.length && (quote || xml[j] !== '>')) {
        const ch = xml[j]!;
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        j++;
      }
      let body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/>]+/.exec(body)?.[0] ?? '';
      const attrs: Record<string, string> = {};
      for (const m of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '');
      const el: XmlElement = { name, attrs, children: [] };
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  return root;
}

const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => typeof c !== 'string');

function textOf(el: XmlElement): string {
  return el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el && elements(el).find((c) => c.name === name);
}

// ------------------------------------------------------------------ verses

/**
 * Collects verse text: fragments are joined as they stand, a paragraph or
 * line break is a space, and white space runs become one space. (The current
 * app trims every fragment and joins with spaces, which puts a space before
 * punctuation after a character style: "Herren ." Fixed here.)
 */
class VerseCollector {
  private chapter: number | null = null;
  private current: { c: number; v: number; parts: string[] } | null = null;
  readonly verses: [number, number, string][] = [];

  startChapter(n: number) {
    this.endVerse();
    this.chapter = n;
  }

  /** `number` may be a range ("5-6"): the verse is the first number (BIBLE-R6). */
  startVerse(number: string) {
    this.endVerse();
    const v = parseInt(number, 10);
    if (this.chapter !== null && Number.isFinite(v)) this.current = { c: this.chapter, v, parts: [] };
  }

  endVerse() {
    if (this.current) this.verses.push([this.current.c, this.current.v, this.current.parts.join('').replace(/\s+/g, ' ').trim()]);
    this.current = null;
  }

  text(s: string) {
    this.current?.parts.push(s);
  }

  /** A paragraph or poetry line ends: the words on either side must not run together. */
  space() {
    this.current?.parts.push(' ');
  }
}

/** Paragraph styles that hold headings and metadata, not verse text (BIBLE-R6, plus psalm titles and the like). */
const NON_CONTENT_STYLES = new Set([
  'ide', 'rem', 'h', 'h1', 'h2', 'h3', 'toc1', 'toc2', 'toc3', 'toca1', 'toca2', 'toca3',
  'mt', 'mt1', 'mt2', 'mt3', 'mt4', 'mte', 'mte1', 'mte2',
  's', 's1', 's2', 's3', 's4', 'sr', 'ms', 'ms1', 'ms2', 'ms3', 'mr', 'r', 'sp', 'd', 'qa', 'cl', 'cd',
]);

/** Book codes of front and back matter: never Bible text. */
const PERIPHERALS = new Set(['FRT', 'BAK', 'OTH', 'INT', 'CNC', 'GLO', 'TDX', 'NDX']);

/** One USX file (USX 2 or 3) to its book. Text before the first chapter, headings, notes and figures are left out. */
export function parseUsx(xml: string): BibleBookText | null {
  const doc = parseXml(xml);
  const usx = elements(doc).find((e) => e.name === 'usx');
  if (!usx) return null;
  const code = (child(usx, 'book')?.attrs.code ?? '').toUpperCase();
  const out = new VerseCollector();
  let inChapters = false;

  const walk = (el: XmlElement) => {
    for (const node of el.children) {
      if (typeof node === 'string') out.text(node.replace(/\n/g, ' '));
      else if (node.name === 'verse') {
        if (node.attrs.number !== undefined) out.startVerse(node.attrs.number);
        else if (node.attrs.eid !== undefined) out.endVerse();
      } else if (node.name === 'note' || node.name === 'figure' || node.name === 'sidebar') continue;
      else walk(node);
    }
  };

  for (const el of elements(usx)) {
    if (el.name === 'chapter') {
      if (el.attrs.number !== undefined) {
        inChapters = true;
        out.startChapter(parseInt(el.attrs.number, 10));
      }
    } else if (!inChapters) continue;
    else if (el.name === 'para') {
      if (NON_CONTENT_STYLES.has(el.attrs.style ?? '')) continue;
      out.space();
      walk(el);
      out.space();
    } else if (el.name === 'table' || el.name === 'list') {
      out.space();
      walk(el);
      out.space();
    }
  }
  out.endVerse();
  return /^[0-9A-Z]{3}$/.test(code) ? { code, verses: out.verses } : null;
}

/** Character markers: their text belongs to the verse (unlike footnotes and cross-references). */
const USFM_SKIP_SPANS = new Set(['f', 'fe', 'ef', 'x', 'ex', 'fig', 'ca', 'va', 'vp', 'rq']);
const USFM_CHARACTER = new Set([
  'add', 'bk', 'dc', 'k', 'nd', 'ord', 'pn', 'png', 'addpn', 'qt', 'sig', 'sls', 'tl', 'wj', 'em', 'bd', 'it', 'bdit', 'no', 'sc', 'sup',
  'w', 'wg', 'wh', 'wa', 'ior', 'iqt', 'jmp', 'qs', 'qac', 'rb', 'pro', 'ndx', 'lit', 'litl', 'liv',
]);
/** Paragraph markers whose text is a heading or metadata (BIBLE-R6). */
const USFM_SKIP_PARAGRAPHS = new Set([...NON_CONTENT_STYLES, 'id', 'usfm', 'sts', 'cp']);

/** One USFM file to its book (BIBLE-R6): verse text without footnotes, cross-references and headings. */
export function parseUsfm(usfm: string): BibleBookText | null {
  // `\w word|strong="H1"\w*`: the attributes after the bar are not text.
  const text = usfm.replace(/\|[^\\]*(?=\\\+?[a-z0-9]+\*)/gi, '');
  const out = new VerseCollector();
  let code = '';
  let skipParagraph = false;
  let skipSpan: string | null = null;
  // An opening marker takes one space after it; a closing one (`\\nd*`) leaves the text after it alone.
  const tokens = text.matchAll(/\\(\+?)([a-z]+[0-9]*(?:-[se])?)(\*|[ \t]?)|([^\\]+)/gi);
  let pending: 'chapter' | 'verse' | 'id' | null = null;

  for (const t of tokens) {
    const [, , markerRaw, after, plain] = t;
    const close = after === '*';
    if (plain !== undefined) {
      let s = plain;
      if (pending) {
        const m = /^\s*(\S+)/.exec(s);
        const value = m?.[1] ?? '';
        if (pending === 'chapter') {
          out.startChapter(parseInt(value, 10));
          skipParagraph = false;
        } else if (pending === 'verse') {
          out.startVerse(value);
          skipParagraph = false;
        } else code = value.toUpperCase();
        s = m ? s.slice(m[0].length) : s;
        if (pending === 'id') s = '';
        pending = null;
      }
      if (!skipParagraph && !skipSpan) out.text(s.replace(/\s+/g, ' '));
      continue;
    }
    const marker = markerRaw!.toLowerCase();
    if (skipSpan) {
      if (close && marker === skipSpan) skipSpan = null;
      continue;
    }
    if (close) continue; // the end of a character style: its text is already in
    if (USFM_SKIP_SPANS.has(marker)) {
      skipSpan = marker;
      continue;
    }
    if (USFM_CHARACTER.has(marker) || /^f[a-z]+$|^x[a-z]+$/.test(marker)) continue;
    if (marker === 'c') pending = 'chapter';
    else if (marker === 'v') pending = 'verse';
    else if (marker === 'id') {
      pending = 'id';
      skipParagraph = true;
    } else {
      // A paragraph marker: a break between words, and maybe a heading to leave out.
      out.space();
      skipParagraph = USFM_SKIP_PARAGRAPHS.has(marker) || /^i[a-z]*[0-9]*$/.test(marker);
    }
  }
  out.endVerse();
  return /^[0-9A-Z]{3}$/.test(code) ? { code, verses: out.verses } : null;
}

// ------------------------------------------------------------------ the zip

const lower = (s: string) => s.toLowerCase();
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

function initials(title: string): string | null {
  const letters = title
    .split(/\s+/)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w[0]!);
  return letters.length >= 2 ? letters.join('') : null;
}

/**
 * Reads a translation from a zip (BIBLE-R3): DBL metadata (`metadata.xml`)
 * or eBible's `copr.htm` for its name, then USX books from `USX_1/` or
 * `USX_2/` beside the metadata, else any `.usx` (the current app refuses
 * those), else every `.usfm`/`.sfm`. Books without verses and front or back
 * matter are left out; books come in canonical order.
 */
export async function importBibleZip(data: Uint8Array, yieldNow: () => Promise<void> = async () => {}): Promise<ImportedBible> {
  if (data.length > BIBLE_ZIP_MAX_BYTES) throw new BibleImportError('Filen är för stor (max 50 MB).');
  const entries = readZip(data).filter((e) => !e.name.endsWith('/') && e.size > 0);
  const read = async (e: ZipEntry) => utf8Decode(await e.read());

  let name = 'Unknown Bible';
  let abbreviation = 'UNKNOWN';
  let language: string | null = null;
  const metadata = entries.find((e) => lower(e.name.split('/').pop()!) === 'metadata.xml');
  const root = metadata ? dirOf(metadata.name) : '';
  if (metadata) {
    const doc = parseXml(await read(metadata));
    const meta = elements(doc)[0];
    const id = child(meta, 'identification');
    const pick = (...names: string[]) => names.map((n) => child(id, n)).map((e) => (e ? textOf(e).trim() : '')).find(Boolean);
    name = pick('nameLocal', 'name') ?? name;
    abbreviation = pick('abbreviationLocal', 'abbreviation') ?? abbreviation;
    const iso = child(child(meta, 'language'), 'iso');
    language = iso ? textOf(iso).trim() || null : null;
  } else {
    const copr = entries.find((e) => lower(e.name.split('/').pop()!) === 'copr.htm');
    if (copr) {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(await read(copr))?.[1]?.replace(/\s+/g, ' ').trim();
      if (title) {
        name = title;
        abbreviation = initials(title) ?? abbreviation;
      }
    }
  }

  const under = (dir: string) => entries.filter((e) => e.name.startsWith(dir) && lower(e.name).endsWith('.usx'));
  let files = under(`${root}USX_1/`);
  if (!files.length) files = under(`${root}USX_2/`);
  if (!files.length) files = entries.filter((e) => lower(e.name).endsWith('.usx'));
  const usx = files.length > 0;
  if (!usx) files = entries.filter((e) => /\.(usfm|sfm)$/.test(lower(e.name)));
  if (!files.length) throw new BibleImportError('Hittade inga USX- eller USFM-filer i zip-filen.');

  const books = new Map<string, BibleBookText>();
  for (const file of files.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const book = usx ? parseUsx(await read(file)) : parseUsfm(await read(file));
    if (book && book.verses.length && !PERIPHERALS.has(book.code) && !books.has(book.code)) books.set(book.code, book);
    await yieldNow(); // a big translation takes a moment: let the page breathe
  }
  if (!books.size) throw new BibleImportError('Hittade inga verser i zip-filen.');
  return {
    name: name.slice(0, 200), // BIBLE-R4
    abbreviation: abbreviation.slice(0, 50),
    language: language?.slice(0, 20) ?? null,
    books: sortBibleBooks([...books.values()]),
  };
}

// ------------------------------------------------------------------ tests and fixtures

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of d) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Little-endian header fields: [value, bytes] pairs. */
function header(fields: [number, 2 | 4][]): Uint8Array {
  const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0));
  let o = 0;
  for (const [v, size] of fields) for (let k = 0; k < size; k++) out[o++] = (v >>> (8 * k)) & 0xff;
  return out;
}

/** A zip of the given files, stored uncompressed: for tests and fixtures. */
export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8Encode(f.name);
    const crc = crc32(f.data);
    const common: [number, 2 | 4][] = [[20, 2], [0x0800, 2], [0, 2], [0, 4], [crc, 4], [f.data.length, 4], [f.data.length, 4], [name.length, 2], [0, 2]];
    const local = header([[0x04034b50, 4], ...common]);
    chunks.push(local, name, f.data);
    central.push(header([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), name);
    offset += local.length + name.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = header([[0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [centralSize, 4], [offset, 4], [0, 2]]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
