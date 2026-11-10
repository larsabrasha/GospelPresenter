import { Crc32, zipEnd, zipEntry } from '@gp/core';

// A zip made of Blobs, for an export (orgExport.ts): entries stored, not compressed, as the blobs are pictures, sounds
// and videos already, and the import reads a stored entry by slicing the file. A Blob made of Blobs copies none of
// them, so a video is read only once, a slice at a time, for its checksum. No ZIP64: past 4 GB or 65,535 entries a
// zip is refused (`ZipTooLarge`).

const MAX_OFFSET = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;
/** How much of a Blob is read at a time for its checksum. */
const CHUNK = 8 * 1024 * 1024;

export class ZipTooLarge extends Error {}

/** The CRC-32 of a Blob, read a slice at a time. */
async function crc32(blob: Blob): Promise<number> {
  const crc = new Crc32();
  for (let at = 0; at < blob.size; at += CHUNK) crc.update(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
  return crc.value();
}

/** The entries as one zip; `progress` after each entry's checksum. */
export async function zipBlob(entries: { name: string; data: Blob }[], progress: (done: number) => void = () => {}): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new ZipTooLarge();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [i, e] of entries.entries()) {
    const size = e.data.size;
    const headers = zipEntry(e.name, await crc32(e.data), size, offset);
    if (offset + headers.local.length + size > MAX_OFFSET) throw new ZipTooLarge();
    parts.push(headers.local, e.data);
    central.push(headers.central);
    offset += headers.local.length + size;
    progress(i + 1);
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + centralSize + 22 > MAX_OFFSET) throw new ZipTooLarge();
  const end = zipEnd(entries.length, centralSize, offset);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
