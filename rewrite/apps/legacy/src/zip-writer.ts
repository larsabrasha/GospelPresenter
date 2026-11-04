import { closeSync, openSync, writeSync } from 'node:fs';
import { crc32 } from 'node:zlib';

// A zip written entry by entry to a file, so an organisation's files never have to fit in memory. Entries are
// stored, not compressed: the blobs are pictures and sounds already, and the web app reads a stored entry by
// slicing the file (`readZip` in @gp/core reads both). No ZIP64: a zip past 4 GB or 65,535 entries is refused.

const MAX_OFFSET = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;

export class ZipWriter {
  private fd: number;
  private offset = 0;
  private central: Buffer[] = [];
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
    const nameBytes = Buffer.from(name, 'utf8');
    const after = this.offset + 30 + nameBytes.length + data.length;
    if (after + this.centralSize + 46 + nameBytes.length + 22 > MAX_OFFSET) throw new Error('the zip would pass 4 GB');
    this.names.add(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const at = this.offset;
    this.write(local);
    this.write(nameBytes);
    this.write(data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(at, 42);
    this.central.push(entry, nameBytes);
    this.centralSize += entry.length + nameBytes.length;
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
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.names.size, 8);
    end.writeUInt16LE(this.names.size, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    this.closed = true;
    closeSync(this.fd);
  }
}
