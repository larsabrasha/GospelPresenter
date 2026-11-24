import { closeSync, openSync, writeSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { zipEnd, zipEntry } from '@gp/core';

// A zip written entry by entry to a file, so an organisation's files never have to fit in memory, with the headers of
// @gp/core's zip.ts and Node's CRC-32. Entries are stored, not compressed: the blobs are pictures and sounds already,
// and the web app reads a stored entry by slicing the file (`readZip` in @gp/core reads both). No ZIP64: a zip past
// 4 GB or 65,535 entries is refused.

const MAX_OFFSET = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;

export class ZipWriter {
  private fd: number;
  private offset = 0;
  private central: Uint8Array[] = [];
  /** The central directory's size so far: it comes after the entries, and its offset must fit too. */
  private centralSize = 0;
  private closed = false;
  readonly names = new Set<string>();

  constructor(path: string) {
    this.fd = openSync(path, 'w');
  }

  private write(b: Uint8Array) {
    writeSync(this.fd, b);
    this.offset += b.length;
  }

  add(name: string, data: Uint8Array) {
    if (this.names.has(name)) return;
    if (this.names.size >= MAX_ENTRIES) throw new Error('more than 65,535 files: too many for one zip');
    const { local, central } = zipEntry(name, crc32(data), data.length, this.offset);
    if (this.offset + local.length + data.length + this.centralSize + central.length + 22 > MAX_OFFSET) throw new Error('the zip would pass 4 GB');
    this.names.add(name);
    this.write(local);
    this.write(data);
    this.central.push(central);
    this.centralSize += central.length;
  }

  /** Closes the file without its directory, after a failure: the caller removes it. */
  abandon() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }

  close() {
    const start = this.offset;
    for (const b of this.central) this.write(b);
    this.write(zipEnd(this.names.size, this.offset - start, start));
    this.closed = true;
    closeSync(this.fd);
  }
}
