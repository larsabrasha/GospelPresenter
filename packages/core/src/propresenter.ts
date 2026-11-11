// ProPresenter 7 `.pro` files to songs (spec 02 "Import (ProPresenter 7)", SONG-R35–R43;
// ProPresenterParser.cs in the current app). A `.pro` file is a protobuf message (rv.data.Presentation,
// GospelPresenter.Shared/Proto/propresenter.proto); only the fields for the title, the CCLI block, the
// groups, their slides' text and the arrangements are read, with a small reader of the wire format
// rather than a protobuf library. A slide's text is RTF, made plain here.

import { LIMITS } from './mutators/base.ts';
import { utf8Decode } from './platform.ts';

/** A song read from a file, before it has ids: arrangements name parts by their index. */
export interface ImportedSong {
  name: string;
  author: string | null;
  publisher: string | null;
  ccli: string | null;
  parts: { labelText: string | null; content: string }[];
  arrangements: { name: string | null; partIndexes: number[] }[];
}

/** The lengths an imported value is cut to rather than refused (SONG-R41). */
export const IMPORT_LIMITS = { name: 200, author: 200, publisher: 200, ccli: 20, label: 50, content: 5000 } as const;

/** Whether a file name is one the import considers (SONG-R35). */
export function isProPresenterFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pro');
}

// ------------------------------------------------------------------ the wire format

type Field = { no: number; wire: number; value: bigint | Uint8Array };

/** The fields of one message, in file order; a malformed message throws. */
function fields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): bigint => {
    let v = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (at >= buf.length || shift > 63n) throw new Error('bad varint');
      const b = buf[at++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
    }
  };
  while (at < buf.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) out.push({ no, wire, value: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (at + len > buf.length) throw new Error('truncated field');
      out.push({ no, wire, value: buf.subarray(at, at + len) });
      at += len;
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw new Error(`unsupported wire type ${wire}`);
    if (at > buf.length) throw new Error('truncated field');
  }
  return out;
}

function bytesOf(fs: Field[], no: number): Uint8Array[] {
  return fs.filter((f) => f.no === no && f.wire === 2).map((f) => f.value as Uint8Array);
}
function messageOf(fs: Field[], no: number): Field[] | null {
  const b = bytesOf(fs, no)[0];
  return b ? fields(b) : null;
}
function stringOf(fs: Field[] | null, no: number): string | null {
  const b = fs && bytesOf(fs, no)[0];
  return b ? utf8Decode(b) : null;
}
function uintOf(fs: Field[], no: number): number {
  const f = fs.find((x) => x.no === no && x.wire === 0);
  return f ? Number(f.value as bigint) : 0;
}
/** A `UUID` message's string. */
function uuidOf(fs: Field[] | null, no: number): string | null {
  return stringOf(fs && messageOf(fs, no), 1);
}

// ------------------------------------------------------------------ text

/** Trimmed and NFC-normalised (macOS stores names decomposed); blank is null (SONG-R37). */
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v.normalize('NFC') : null;
}

/** ProPresenter's default name, with the copy suffix it adds (SONG-R36). */
const PLACEHOLDER = /^untitled([ _-]*\d+)?$/i;

function firstRealTitle(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const v = clean(c);
    if (v && !PLACEHOLDER.test(v)) return v;
  }
  return null;
}

/** Windows-1252's bytes 0x80–0x9F; the rest are Latin-1, the same code points. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

function windows1252(byte: number): string {
  return byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80]! : String.fromCharCode(byte);
}

/**
 * `\uN` escapes as their characters (U+2028 and U+2029, which Cocoa writes for a line break, as one),
 * each followed by the `\ucN` fallback characters it says, which are dropped (`\uc1` unless set).
 */
function unicodeEscapes(text: string): string {
  const re = /\\uc(\d+)|\\u(-?\d+) ?/g;
  let out = '';
  let at = 0;
  let fallback = 1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += text.slice(at, m.index);
    at = re.lastIndex;
    if (m[1] !== undefined) {
      fallback = Number(m[1]);
      out += m[0]; // removed with the other control words
      continue;
    }
    const n = Number(m[2]);
    const code = n < 0 ? n + 65536 : n;
    out += code === 0x2028 || code === 0x2029 ? '\n' : String.fromCharCode(code);
    at = Math.min(text.length, at + fallback);
    re.lastIndex = at;
  }
  return out + text.slice(at);
}

/** The header groups whose text is not the slide's: fonts, colours, styles, and `{\*…}` destinations. */
const HEADER_GROUP = /\{\\(?:fonttbl|colortbl|stylesheet|info|\*)/g;

/** The RTF without its header groups, each removed to its matching brace. */
function withoutHeaderGroups(rtf: string): string {
  let out = '';
  let at = 0;
  for (let m = HEADER_GROUP.exec(rtf); m; m = HEADER_GROUP.exec(rtf)) {
    out += rtf.slice(at, m.index);
    let depth = 0;
    let i = m.index;
    for (; i < rtf.length; i++) {
      if (rtf[i] === '\\') i++; // an escaped brace or backslash
      else if (rtf[i] === '{') depth++;
      else if (rtf[i] === '}' && --depth === 0) break;
    }
    at = i + 1;
    HEADER_GROUP.lastIndex = at;
  }
  return out + rtf.slice(at);
}

/**
 * A slide's RTF as plain text, as the current app makes it (ProPresenterParser.RtfToPlainText): the
 * text after the last `\pard` line, `\'hh` escapes as Windows-1252, control words and braces gone, a
 * backslash at a line's end a line break. Unlike the current app: the header groups (fonts, colours,
 * `{\*…}`) go first, as a slide with no text would otherwise keep `;;` and `\*;;` from them as its text;
 * at most one blank line is kept between lines (Lars: one or two breaks in a row), not none; spaces at a
 * line's end go; and a `\uN` escape is its
 * character (Cocoa writes the line separator U+2028 so), with the `\ucN` fallback characters after it
 * skipped.
 */
export function rtfToPlainText(rtf: string): string {
  let text = withoutHeaderGroups(rtf).replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => windows1252(parseInt(hex, 16)));
  const lines = text.split('\n');
  let lastPard = -1;
  lines.forEach((l, i) => {
    if (l.includes('\\pard')) lastPard = i;
  });
  text = lines.slice(lastPard + 1).join('\n');
  text = unicodeEscapes(text);
  text = text.replace(/\\[a-z]+-?[0-9]*\s?/g, '');
  text = text.replaceAll('{', '').replaceAll('}', '');
  text = text.replace(/\\\r?\n/g, '\n');
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** The first text element of a cue whose RTF has text (SONG-R38). */
function slideText(cue: Field[]): string | null {
  for (const actionBytes of bytesOf(cue, 10)) {
    const slide = messageOf(messageOf(messageOf(fields(actionBytes), 23) ?? [], 2) ?? [], 1);
    if (!slide) continue;
    for (const elementBytes of bytesOf(slide, 1)) {
      const rtf = bytesOf(messageOf(messageOf(fields(elementBytes), 1) ?? [], 13) ?? [], 5)[0];
      if (!rtf?.length) continue;
      const source = utf8Decode(rtf);
      if (!source.startsWith('{\\rtf')) continue;
      const plain = rtfToPlainText(source);
      if (plain.trim()) return plain.normalize('NFC');
    }
  }
  return null;
}

const cut = (s: string | null, max: number) => (s && s.length > max ? s.slice(0, max) : s);

/**
 * A `.pro` file as a song, or null when it has no slide text or cannot be read (SONG-R40). The title is
 * the first real one of the file's own name for the presentation, `fileName` and the CCLI title, else
 * "Untitled" (SONG-R36). Values are cut to the limits, and to the first 50 parts and 10 arrangements
 * (SONG-R41, SONG-R8, SONG-R9).
 */
export function parseProPresenter(data: Uint8Array, fileName?: string | null): ImportedSong | null {
  try {
    const p = fields(data);
    const ccliBlock = messageOf(p, 14);
    const ccliNumber = ccliBlock ? uintOf(ccliBlock, 6) : 0;
    const name = firstRealTitle(stringOf(p, 3), fileName, stringOf(ccliBlock, 3)) ?? 'Untitled';

    const cues = new Map<string, Field[]>();
    for (const b of bytesOf(p, 13)) {
      const cue = fields(b);
      const id = uuidOf(cue, 1);
      if (id) cues.set(id, cue);
    }
    // One part per slide with text, group by group in file order, labelled with the group's name.
    const parts: ImportedSong['parts'] = [];
    const partsOfGroup = new Map<string, number[]>();
    for (const b of bytesOf(p, 12)) {
      const cueGroup = fields(b);
      const group = messageOf(cueGroup, 1);
      const groupId = uuidOf(group, 1);
      const label = cut(clean(stringOf(group, 2)), IMPORT_LIMITS.label);
      const mine: number[] = [];
      for (const ref of bytesOf(cueGroup, 2)) {
        const cue = cues.get(stringOf(fields(ref), 1) ?? '');
        const text = cue && slideText(cue);
        if (!text) continue;
        mine.push(parts.length);
        parts.push({ labelText: label, content: cut(text, IMPORT_LIMITS.content)! });
      }
      if (groupId && mine.length) partsOfGroup.set(groupId, mine);
    }
    if (!parts.length) return null;
    const kept = parts.slice(0, LIMITS.partsPerSong);

    // An arrangement names groups; each stands for all of its parts (SONG-R39).
    const arrangements: ImportedSong['arrangements'] = [];
    for (const b of bytesOf(p, 11)) {
      const arr = fields(b);
      const partIndexes = bytesOf(arr, 3)
        .flatMap((ref) => partsOfGroup.get(stringOf(fields(ref), 1) ?? '') ?? [])
        .filter((i) => i < kept.length);
      if (partIndexes.length) arrangements.push({ name: cut(clean(stringOf(arr, 2)), 100), partIndexes });
    }

    return {
      name: cut(name, IMPORT_LIMITS.name)!,
      author: cut(clean(stringOf(ccliBlock, 1)), IMPORT_LIMITS.author),
      publisher: cut(clean(stringOf(ccliBlock, 4)), IMPORT_LIMITS.publisher),
      ccli: ccliNumber ? cut(String(ccliNumber), IMPORT_LIMITS.ccli) : null,
      parts: kept,
      arrangements: arrangements.slice(0, LIMITS.arrangementsPerSong),
    };
  } catch {
    return null;
  }
}

/** How two song names compare for duplicates: case- and composition-insensitive (SONG-R42). */
export function songNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}
