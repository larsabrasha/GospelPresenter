// The export against a real 1.x database: opt-in, as it needs a PostgreSQL to load the schema into, e.g.
//   docker run -d --name gp-legacy-pg -e POSTGRES_USER=gp -e POSTGRES_PASSWORD=gp -e POSTGRES_DB=gp -p 55432:5432 postgres:17
//   GP_LEGACY_PG=postgres://gp:gp@localhost:55432/gp pnpm --filter @gp/legacy test
// The database's public schema is dropped and made again from fixtures/schema-1x.sql and seed-1x.sql.
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_ENTRIES, LEGACY_FORMAT, legacyManifestSchema, readZip, sniffStoredImage, utf8Decode, type LegacyRows } from '@gp/core';
import { Client } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportOrg, type ExportReport } from '../src/export.ts';
import { sha256Hex, type ObjectStore } from '../src/media.ts';
import { readOrg } from '../src/old-db.ts';

const URL = process.env.GP_LEGACY_PG;
const fixture = (name: string) => readFileSync(new globalThis.URL(`fixtures/${name}`, import.meta.url), 'utf8');

const picture = (width: number, height: number, format: 'png' | 'jpeg' | 'webp') =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .toFormat(format)
    .toBuffer()
    .then((b) => new Uint8Array(b));

describe.skipIf(!URL)('the export from a 1.x database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-legacy-'));
  const out = join(dir, 'export.zip');
  let report: ExportReport;
  let entries: Map<string, Uint8Array>;
  const rows = <T extends keyof LegacyRows>(t: T) => JSON.parse(utf8Decode(entries.get(LEGACY_ENTRIES.rows(t))!)) as LegacyRows[T];

  beforeAll(async () => {
    const client = new Client({ connectionString: URL });
    await client.connect();
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(fixture('schema-1x.sql'));
    await client.query(fixture('seed-1x.sql'));
    await client.end();

    const objects = new Map<string, Uint8Array>([
      ['org/org-1/images/img-1/full', await picture(2400, 1350, 'png')],
      ['org/org-1/images/img-1/thumb', await picture(400, 225, 'png')],
      ['org/org-1/images/img-2/full', await picture(1600, 900, 'jpeg')],
      ['org/org-1/images/img-2/thumb', await picture(400, 225, 'jpeg')],
      ['org/org-1/audios/aud-1/file', new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])],
      ['org/org-1/overlays/ov-1/image', await picture(800, 600, 'png')],
      ['org/org-1/slides/deck-1/page-0.webp', await picture(1920, 1080, 'webp')],
      ['org/org-1/slides/deck-1/page-1.webp', await picture(1920, 1080, 'webp')],
    ]);
    const store: ObjectStore = { get: async (key) => objects.get(key) ?? null };

    report = await exportOrg(await readOrg(URL!, 'org-1'), store, out);
    const zip = readZip(new Uint8Array(readFileSync(out)));
    entries = new Map(await Promise.all(zip.map(async (e) => [e.name, await e.read()] as const)));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a manifest of the format the import reads, with the organisation’s name', () => {
    const manifest = legacyManifestSchema.parse(JSON.parse(utf8Decode(entries.get(LEGACY_ENTRIES.manifest)!)));

    expect(manifest).toMatchObject({ format: LEGACY_FORMAT, orgName: 'Testkyrkan' });
  });

  it('moves only the chosen organisation’s rows', () => {
    expect(rows('songs').map((s) => s.id)).toEqual(['song-1', 'song-2']);
  });

  it('reads a date and a time of day as text, and a timestamp as milliseconds', () => {
    const [p] = rows('presentations').filter((r) => r.id === 'pres-1');

    expect(p).toMatchObject({ event_date: '2026-11-08', time: '11:00', updated_at: Date.parse('2026-10-02T09:30:00Z') });
  });

  it('names every blob by the SHA-256 of its bytes', () => {
    const blobs = [...entries].filter(([name]) => name.startsWith('blobs/'));

    expect(blobs.length).toBeGreaterThan(0);
    for (const [name, bytes] of blobs) expect(name).toBe(LEGACY_ENTRIES.blob(sha256Hex(bytes)));
  });

  it('stores a PNG picture as WebP fitting 1920×1080, and keeps a JPEG that fits as it was', () => {
    const images = rows('images');
    const png = images.find((i) => i.id === 'img-1')!;
    const jpeg = images.find((i) => i.id === 'img-2')!;

    expect(png).toMatchObject({ content_type: 'image/webp', width: 1920, height: 1080 });
    expect(sniffStoredImage(entries.get(LEGACY_ENTRIES.blob(String(png.full_hash)))!)).toBe('image/webp');
    expect(jpeg).toMatchObject({ content_type: 'image/jpeg', deleted_at: Date.parse('2026-10-30T08:00:00Z') });
  });

  it('reports a picture whose file is gone and leaves it out', () => {
    expect(rows('images').some((i) => i.id === 'img-lost')).toBe(false);
    expect(report.problems).toEqual(['picture borta.jpg: no file']);
  });

  it('writes each translation’s text under its hash', () => {
    const [bible] = rows('bibles');

    expect(bible).toMatchObject({ id: 'bible:sv1917', verse_count: 3 });
    expect(entries.has(LEGACY_ENTRIES.bible(String(bible!.content_hash)))).toBe(true);
  });

  it('writes the users with their Google subjects', () => {
    const users = JSON.parse(utf8Decode(entries.get(LEGACY_ENTRIES.users)!));

    expect(users).toEqual([
      { name: 'Anna Admin', email: 'anna@example.com', role: 'admin', google: ['google-sub-anna'] },
      { name: 'bo@example.com', email: 'bo@example.com', role: 'user', google: [] },
    ]);
  });

  it('keeps the running order, leaving out the item whose song was purged', () => {
    const items = rows('presentation_items').filter((i) => i.presentation_id === 'pres-1');

    expect(items.map((i) => [i.type, i.sort])).toEqual([
      ['song', 0],
      ['bible', 1],
      ['image', 2],
      ['audio', 3],
      ['custom', 4],
    ]);
    expect(report.skipped).toEqual([{ presentationId: 'pres-1', title: 'Rensad sång', reason: 'no-song' }]);
  });
});
