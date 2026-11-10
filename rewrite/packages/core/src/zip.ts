import { utf8Encode } from './platform.ts';

// A zip's parts, stored entries only (no compression, no ZIP64), shared by every zip the app writes: `makeZip` here,
// the web app's export of Blobs (apps/web/src/media/zipBlob.ts) and 1.x's export to a file (apps/legacy). Each writes
// the entries its own way; the bytes of the headers and the checksum are the same.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** A CRC-32 over bytes given a part at a time. */
export class Crc32 {
  private c = 0xffffffff;
  update(bytes: Uint8Array): this {
    let c = this.c;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
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
