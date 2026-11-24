import { MutationError } from './mutation.ts';
import { utf8Decode, utf8Encode } from './platform.ts';
import { inflate } from './inflate.ts';

// A zip's parts, stored entries only (no compression, no ZIP64), shared by every zip the app writes: `makeZip` here,
// the web app's export of Blobs (apps/web/src/media/zipBlob.ts) and 1.x's export to a file (apps/legacy). Each writes
// the entries its own way; the bytes of the headers and the checksum are the same.

/** As 32-bit integers, not doubles: a video of 2 GB goes through this loop byte by byte. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** A CRC-32 over bytes given a part at a time. */
export class Crc32 {
  private c = 0xffffffff;
  update(bytes: Uint8Array): this {
    let c = this.c;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
    this.c = c;
    return this;
  }
  value(): number {
    return (this.c ^ 0xffffffff) >>> 0;
  }
}

/** Little-endian header fields: [value, bytes] pairs. */
function header(fields: [number, 2 | 4][]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0));
  let o = 0;
  for (const [v, size] of fields) for (let k = 0; k < size; k++) out[o++] = (v >>> (8 * k)) & 0xff;
  return out;
}

/**
 * A stored entry's two headers: `local` goes before its bytes at `offset`, `central` (with its name) in the directory
 * at the end. Version 2.0, UTF-8 names, no time.
 */
export function zipEntry(name: string, crc: number, size: number, offset: number): { local: Uint8Array<ArrayBuffer>; central: Uint8Array<ArrayBuffer> } {
  const n = utf8Encode(name) as Uint8Array<ArrayBuffer>;
  const common: [number, 2 | 4][] = [[20, 2], [0x0800, 2], [0, 2], [0, 4], [crc, 4], [size, 4], [size, 4], [n.length, 2], [0, 2]];
  const join = (h: Uint8Array) => {
    const out = new Uint8Array(h.length + n.length);
    out.set(h);
    out.set(n, h.length);
    return out;
  };
  return {
    local: join(header([[0x04034b50, 4], ...common])),
    central: join(header([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]])),
  };
}

/** The end of a zip: `count` entries, whose directory of `centralSize` bytes starts at `centralOffset`. */
export function zipEnd(count: number, centralSize: number, centralOffset: number): Uint8Array<ArrayBuffer> {
  return header([[0x06054b50, 4], [0, 2], [0, 2], [count, 2], [count, 2], [centralSize, 4], [centralOffset, 4], [0, 2]]);
}

/** A zip of the given files, in memory: for tests and fixtures, and the libraries' downloads of several files. */
export function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const e = zipEntry(f.name, new Crc32().update(f.data).value(), f.data.length, offset);
    parts.push(e.local, f.data);
    central.push(e.central);
    offset += e.local.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const all = [...parts, ...central, zipEnd(files.length, centralSize, offset)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** A zip's entry as its central directory names it: its name, size, method (0 stored, 8 DEFLATE) and where its bytes are. */
export interface ZipEntry {
  name: string;
  size: number;
  method: number;
  compressed: number;
  local: number;
}

const refuse = (code: string): never => {
  throw new MutationError(code);
};

/** A little-endian number at `o`; past the end, the bytes read as 0. */
const le = (d: Uint8Array, o: number, n: number) => {
  let v = 0;
  for (let k = 0; k < n; k++) v += (d[o + k] ?? 0) * 2 ** (8 * k);
  return v;
};

/**
 * The entries of a zip in memory, from its central directory (no ZIP64): a translation's zip (files-bible-import.ts),
 * and the tests and tools that check a zip the app wrote. Refused as `not-zip` where there is no directory.
 */
export function readZip(data: Uint8Array): ZipEntry[] {
  const len = data.length;
  let end = -1;
  if (len >= 22) for (let i = len - 22; i >= Math.max(0, len - 22 - 65_535) && end < 0; i--) if (le(data, i, 4) === 0x06054b50) end = i;
  if (end < 0) refuse('not-zip');
  const count = le(data, end + 10, 2);
  let p = le(data, end + 16, 4);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > len || le(data, p, 4) !== 0x02014b50) refuse('not-zip');
    const nameLength = le(data, p + 28, 2);
    const name = utf8Decode(data.subarray(Math.min(p + 46, len), Math.min(p + 46 + nameLength, len)));
    entries.push({ name, size: le(data, p + 24, 4), method: le(data, p + 10, 2), compressed: le(data, p + 20, 4), local: le(data, p + 42, 4) });
    p += 46 + nameLength + le(data, p + 30, 2) + le(data, p + 32, 2);
  }
  return entries;
}

/** An entry's bytes: stored, or DEFLATE; another method or a damaged stream is refused as `compression`. */
export function zipEntryBytes(data: Uint8Array, e: ZipEntry): Uint8Array {
  if (le(data, e.local, 4) !== 0x04034b50) refuse('not-zip');
  const start = Math.min(e.local + 30 + le(data, e.local + 26, 2) + le(data, e.local + 28, 2), data.length);
  const raw = data.subarray(start, Math.min(start + e.compressed, data.length));
  if (e.method === 0) return raw;
  if (e.method !== 8) refuse('compression');
  try {
    return inflate(raw);
  } catch {
    return refuse('compression');
  }
}
