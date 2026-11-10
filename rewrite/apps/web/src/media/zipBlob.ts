import { utf8Encode } from '@gp/core';

// A zip made of Blobs, for an export (orgExport.ts): entries stored, not compressed, as the blobs are pictures, sounds
// and videos already, and the import reads a stored entry by slicing the file. A Blob made of Blobs copies none of
// them, so a video is read only once, a slice at a time, for its checksum. No ZIP64: past 4 GB or 65,535 entries a
// zip is refused (`ZipTooLarge`).

const MAX_OFFSET = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;
/** How much of a Blob is read at a time for its checksum. */
const CHUNK = 8 * 1024 * 1024;

export class ZipTooLarge extends Error {}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 of a Blob, read a slice at a time. */
async function crc32(blob: Blob): Promise<number> {
  let c = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Little-endian header fields: [value, bytes] pairs. */
function header(fields: [number, 2 | 4][]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0));
  let o = 0;
  for (const [v, size] of fields) for (let k = 0; k < size; k++) out[o++] = (v >>> (8 * k)) & 0xff;
  return out;
}

/** The entries as one zip; `progress` after each entry's checksum. */
export async function zipBlob(entries: { name: string; data: Blob }[], progress: (done: number) => void = () => {}): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new ZipTooLarge();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [i, e] of entries.entries()) {
    const name = utf8Encode(e.name) as Uint8Array<ArrayBuffer>;
    const size = e.data.size;
    if (offset + 30 + name.length + size > MAX_OFFSET) throw new ZipTooLarge();
    const crc = await crc32(e.data);
    // Version 2.0, UTF-8 names, stored; time and date 0.
    const common: [number, 2 | 4][] = [[20, 2], [0x0800, 2], [0, 2], [0, 4], [crc, 4], [size, 4], [size, 4], [name.length, 2], [0, 2]];
    const local = header([[0x04034b50, 4], ...common]);
    parts.push(local, name, e.data);
    central.push(header([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), name);
    offset += local.length + name.length + size;
    progress(i + 1);
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + centralSize + 22 > MAX_OFFSET) throw new ZipTooLarge();
  const end = header([[0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [centralSize, 4], [offset, 4], [0, 2]]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
