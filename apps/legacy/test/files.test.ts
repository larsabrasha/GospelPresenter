// The export's files: pictures that cannot be read, an export that fails, and the zip it writes.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, utf8Decode } from '@gp/core';
import { afterEach, describe, expect, it } from 'vitest';
import { exportOrg } from '../src/export.ts';
import { collectMedia, type ObjectStore } from '../src/media.ts';
import type { OldData } from '../src/old-db.ts';
import { ZipWriter } from '../src/zip-writer.ts';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'gp-legacy-files-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const withImage = (): OldData => ({
  org: { Id: 'o', Name: 'Kyrkan' },
  users: [],
  logins: [],
  labels: [],
  songs: [],
  parts: [],
  arrangements: [],
  versions: [],
  ccli: [],
  presentations: [],
  items: [],
  itemParts: [],
  decks: [],
  bibles: [],
  images: [{ Id: 'img', FileName: 'trasig.jpg', ContentType: 'image/jpeg', CreatedAt: new Date(0), DeletedAt: null }],
  audios: [],
  overlays: [],
  displays: [],
  settings: [],
});

describe('the export’s files', () => {
  it('reports a picture that cannot be read and goes on', async () => {
    const store: ObjectStore = { get: async () => new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) };

    const media = await collectMedia(withImage(), store, async () => {});

    expect(media.images.size).toBe(0);
    expect(media.problems).toEqual([expect.stringMatching(/^picture trasig\.jpg: not a picture that can be read/)]);
  });

  it('leaves no zip behind when the export fails', async () => {
    const out = join(tempDir(), 'kyrkan.zip');
    const store: ObjectStore = {
      get: async () => {
        throw new Error('connection reset');
      },
    };

    await expect(exportOrg(withImage(), store, out)).rejects.toThrow('connection reset');
    expect([existsSync(out), existsSync(`${out}.partial`)]).toEqual([false, false]);
  });

  it('writes no zip the import would refuse, and names the row', async () => {
    const out = join(tempDir(), 'kyrkan.zip');
    const data: OldData = {
      ...withImage(),
      images: [],
      presentations: [
        { Id: 'p-1', Name: 'Gudstjänst', UpdatedAt: new Date(0), IsTemplate: false, Description: null, DeletedAt: null, LastUsedAt: null, ScheduledDayOfWeek: null, ScheduledTime: null, EventDate: null, EventTime: null, EventLocation: null, ThemeId: null },
      ],
      items: [{ Id: 'it-1', PresentationId: 'p-1', SourceId: null, Type: 1, Title: 'Joh 3', ArrangementId: null, SortOrder: 0 }],
      itemParts: [{ PresentationItemId: 'it-1', Content: `<sup>16</sup>${'a'.repeat(10_001)}`, SortOrder: 0 }],
    };

    await expect(exportOrg(data, { get: async () => null }, out)).rejects.toThrow('the import would refuse presentation_items it-1: a Bible passage that does not read');
    expect(existsSync(out)).toBe(false);
  });

  it('writes a zip core reads back, each entry once', async () => {
    const out = join(tempDir(), 'test.zip');
    const zip = new ZipWriter(out);
    zip.add('a.txt', new TextEncoder().encode('första'));
    zip.add('a.txt', new TextEncoder().encode('andra'));
    zip.add('b/c.json', new TextEncoder().encode('{}'));
    zip.close();

    const entries = readZip(new Uint8Array(readFileSync(out)));

    expect(await Promise.all(entries.map(async (e) => [e.name, utf8Decode(await e.read())]))).toEqual([
      ['a.txt', 'första'],
      ['b/c.json', '{}'],
    ]);
  });
});
