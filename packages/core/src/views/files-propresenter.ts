// ProPresenter 7 `.pro` files to songs (spec 02 "Import (ProPresenter 7)", SONG-R35–R43; ADR 0008, ported back from
// crates/gp-core/src/propresenter.rs, itself from propresenter.ts at 238d481b). A `.pro` file is a protobuf message
// (rv.data.Presentation); only the fields for the title, the CCLI block, the groups, their slides' text and the
// arrangements are read, with a small reader of the wire format. A slide's text is RTF, made plain here; a unit of a
// pair that pairs with none is U+FFFD, as the Rust core had it; a value too long is cut in characters (chars.ts).
import { FIELD_RULES, LIMITS } from '../mutation.ts';
import { utf8Decode } from '../platform.ts';
import { cutChars } from '../chars.ts';
import { wellFormed } from './files-json.ts';

/** The lengths an imported value is cut to rather than refused (SONG-R41): the most its field takes, in characters. */
const MAX = {
  name: FIELD_RULES.name.max,
  author: FIELD_RULES.author.max,
  publisher: FIELD_RULES.publisher.max,
  ccli: FIELD_RULES.ccli.max,
  label: FIELD_RULES.label.max,
  content: FIELD_RULES.partContent.max,
  arrangementName: FIELD_RULES.arrangementName.max,
} as const;

export interface ImportedSong {
  name: string;
  author: string | null;
  publisher: string | null;
  ccli: string | null;
  parts: { labelText: string | null; content: string }[];
  arrangements: { name: string | null; partIndexes: number[] }[];
}

/** The song a `.pro` file holds, or null when it has no slide text or cannot be read (SONG-R35–R43). */
export function proPresenterSong(data: Uint8Array, fileName: string | null): ImportedSong | null {
  try {
    return song(data, fileName);
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ the wire format

type Field = { no: bigint; value: bigint | Uint8Array };
/** A message that cannot be read: the whole file is then no song. */
class Bad extends Error {}

/** The fields of one message, in file order; a malformed message is Bad. */
function fields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): bigint => {
    let v = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (at >= buf.length || shift > 63n) throw new Bad();
      const b = buf[at++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
    }
  };
  while (at < buf.length) {
    const key = varint();
    const no = key >> 3n;
    const wire = key & 7n;
    if (wire === 0n) out.push({ no, value: varint() });
    else if (wire === 2n) {
      const len = varint();
      if (BigInt(at) + len > BigInt(buf.length)) throw new Bad();
      out.push({ no, value: buf.subarray(at, at + Number(len)) });
      at += Number(len);
    } else if (wire === 1n) at += 8;
    else if (wire === 5n) at += 4;
    else throw new Bad();
    if (at > buf.length) throw new Bad();
  }
  return out;
}

const bytesOf = (fs: Field[], no: number): Uint8Array[] => fs.filter((f) => f.no === BigInt(no) && f.value instanceof Uint8Array).map((f) => f.value as Uint8Array);
function messageOf(fs: Field[], no: number): Field[] | null {
  const b = bytesOf(fs, no)[0];
  return b ? fields(b) : null;
}
function stringOf(fs: Field[] | null, no: number): string | null {
  const b = fs && bytesOf(fs, no)[0];
  return b ? utf8Decode(b) : null;
}
function uintOf(fs: Field[], no: number): bigint {
  const f = fs.find((x) => x.no === BigInt(no) && typeof x.value === 'bigint');
  return f ? (f.value as bigint) : 0n;
}
/** A `UUID` message's string. */
const uuidOf = (fs: Field[] | null, no: number): string | null => (fs ? stringOf(messageOf(fs, no), 1) : null);

// ------------------------------------------------------------------ text

/** Trimmed and NFC-normalised (macOS stores names decomposed); blank is null (SONG-R37). */
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v.normalize('NFC') : null;
}

/** ProPresenter's default name, with the copy suffix it adds (SONG-R36). */
const PLACEHOLDER = /^untitled([ _-]*\d+)?$/i;

const firstRealTitle = (...candidates: (string | null)[]): string | null =>
  candidates.map(clean).find((v): v is string => v !== null && !PLACEHOLDER.test(v)) ?? null;

/** Windows-1252's bytes 0x80–0x9F; the rest are Latin-1, the same code points. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const windows1252 = (byte: number): string => (byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80]! : String.fromCharCode(byte));

/**
 * `\uN` escapes as their characters (U+2028 and U+2029, which Cocoa writes for a line break, as one), each followed by
 * the `\ucN` fallback characters it says, which are dropped (`\uc1` unless set).
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
      out += m[0]; // the control word stays, removed with the others
      continue;
    }
    const n = Number(m[2]);
    const code = n < 0 ? n + 65536 : n;
    out += code === 8232 || code === 8233 ? '\n' : String.fromCharCode(code);
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
      if (rtf[i] === '\\') i++;
      else if (rtf[i] === '{') depth++;
      else if (rtf[i] === '}' && --depth === 0) break;
    }
    at = i + 1;
    HEADER_GROUP.lastIndex = at;
  }
  return out + rtf.slice(at);
}

/**
 * A slide's RTF as plain text, as 2.0 makes it (`rtfToPlainText`): the header groups gone, `\'hh` as Windows-1252,
 * the text after the last `\pard` line, `\uN` escapes, control words and braces gone, a backslash at a line's end a
 * line break, spaces at a line's end gone, at most one blank line between lines, trimmed.
 */
function rtfToPlainText(rtf: string): string {
  let text = withoutHeaderGroups(rtf).replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => windows1252(parseInt(hex, 16)));
  const lines = text.split('\n');
  const lastPard = lines.findLastIndex((l) => l.includes('\\pard'));
  text = unicodeEscapes(lines.slice(lastPard + 1).join('\n'));
  text = text.replace(/\\[a-z]+-?[0-9]*\s?/g, '').replace(/[{}]/g, '');
  text = text.replace(/\\\r?\n/g, '\n');
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** The first text element of a cue whose RTF has text (SONG-R38). */
function slideText(cue: Field[]): string | null {
  for (const action of bytesOf(cue, 10)) {
    const m23 = messageOf(fields(action), 23);
    const m2 = m23 && messageOf(m23, 2);
    const slide = m2 && messageOf(m2, 1);
    if (!slide) continue;
    for (const element of bytesOf(slide, 1)) {
      const m1 = messageOf(fields(element), 1);
      const m13 = m1 && messageOf(m1, 13);
      const rtf = m13 && bytesOf(m13, 5)[0];
      if (!rtf?.length) continue;
      const source = utf8Decode(rtf);
      if (!source.startsWith('{\\rtf')) continue;
      const plain = rtfToPlainText(source);
      if (plain) return wellFormed(plain).normalize('NFC');
    }
  }
  return null;
}

/**
 * A `.pro` file as a song (`parseProPresenter`): the title the first real one of the file's own name for the
 * presentation, `fileName` and the CCLI title, else "Untitled" (SONG-R36); one part per slide with text, group by
 * group, labelled with the group's name; an arrangement of groups one of all their parts (SONG-R39); values cut to
 * the limits, and to the first 50 parts and 10 arrangements (SONG-R41, SONG-R8, SONG-R9). Bad when unreadable.
 */
function song(data: Uint8Array, fileName: string | null): ImportedSong | null {
  const p = fields(data);
  const block = messageOf(p, 14);
  const ccliNumber = block ? uintOf(block, 6) : 0n;
  const name = firstRealTitle(stringOf(p, 3), fileName, stringOf(block, 3)) ?? 'Untitled';

  const cues = new Map<string, Field[]>();
  for (const b of bytesOf(p, 13)) {
    const cue = fields(b);
    const id = uuidOf(cue, 1);
    if (id) cues.set(id, cue);
  }
  const parts: ImportedSong['parts'] = [];
  const partsOfGroup = new Map<string, number[]>();
  for (const b of bytesOf(p, 12)) {
    const cueGroup = fields(b);
    const group = messageOf(cueGroup, 1);
    const groupId = uuidOf(group, 1);
    const label = clean(stringOf(group, 2));
    const mine: number[] = [];
    for (const ref of bytesOf(cueGroup, 2)) {
      const cue = cues.get(stringOf(fields(ref), 1) ?? '');
      const text = cue && slideText(cue);
      if (!text) continue;
      mine.push(parts.length);
      parts.push({ labelText: label === null ? null : cutChars(label, MAX.label), content: cutChars(text, MAX.content) });
    }
    if (groupId && mine.length) partsOfGroup.set(groupId, mine);
  }
  if (!parts.length) return null;
  parts.length = Math.min(parts.length, LIMITS.partsPerSong);

  const arrangements: ImportedSong['arrangements'] = [];
  for (const b of bytesOf(p, 11)) {
    const arr = fields(b);
    const partIndexes = bytesOf(arr, 3)
      .map((ref) => stringOf(fields(ref), 1) ?? '')
      .flatMap((key) => partsOfGroup.get(key) ?? [])
      .filter((i) => i < parts.length);
    const named = clean(stringOf(arr, 2));
    if (partIndexes.length) arrangements.push({ name: named === null ? null : cutChars(named, MAX.arrangementName), partIndexes });
  }
  const author = clean(stringOf(block, 1));
  const publisher = clean(stringOf(block, 4));
  return {
    name: cutChars(name, MAX.name),
    author: author === null ? null : cutChars(author, MAX.author),
    publisher: publisher === null ? null : cutChars(publisher, MAX.publisher),
    ccli: ccliNumber ? cutChars(String(Number(ccliNumber)), MAX.ccli) : null,
    parts,
    arrangements: arrangements.slice(0, LIMITS.arrangementsPerSong),
  };
}
