// The nightly backup on Cloudflare (backup-r2.ts), against buckets in memory: a night, the files a share a run,
// the thinning, and files the organisation no longer has.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_FORMAT, LEGACY_TABLES, mediaKey, type LegacyRows } from '@gp/core';
import { legacyRowsProblem } from '@gp/core/core';
import { nodeOrgStore, openSqlite } from '@gp/server/node';
import { backupOrg, orgContent, type BackupBucket, type BackupNight } from '../src/backup-r2.ts';

/** A bucket in memory, counting its reads. */
function bucket(start: Record<string, string> = {}) {
  const objects = new Map(Object.entries(start));
  const reads: string[] = [];
  const b: BackupBucket = {
    async get(key) {
      reads.push(key);
      const v = objects.get(key);
      return v === undefined ? null : { body: new Response(v).body!, text: async () => v, httpMetadata: { contentType: 'image/webp' } };
    },
    async put(key, value) {
      objects.set(key, typeof value === 'string' ? value : await new Response(value).text());
    },
    async delete(keys) {
      for (const k of [keys].flat()) objects.delete(k);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
  return { b, objects, reads };
}

const [A, B, C] = ['a', 'b', 'c'].map((x) => x.repeat(64)) as [string, string, string];
const BIBLE = 'd'.repeat(64);

/** An organisation with a picture (two files), a sound and a Bible translation. */
function content(): { rows: LegacyRows; bibleText: (hash: string) => string } {
  const rows = Object.fromEntries(LEGACY_TABLES.map((t) => [t, []])) as unknown as LegacyRows;
  rows.images = [{ id: 'i1', full_hash: A, thumb_hash: B }];
  rows.audios = [{ id: 'a1', hash: C }];
  rows.bibles = [{ id: 'sfb', content_hash: BIBLE }];
  return { rows, bibleText: (hash) => `{"text":"${hash}"}` };
}

const media = () => bucket({ [mediaKey('o1', A)]: 'full', [mediaKey('o1', B)]: 'thumb', [mediaKey('o1', C)]: 'sound' });

function run(backups: BackupBucket, from: BackupBucket, day: string, budget = 15) {
  return backupOrg({ orgId: 'o1', orgName: 'Lundhagskyrkan', users: [{ name: 'Lars', email: 'lars@example.org', role: 'admin', google: [] }], read: async () => content(), media: from, backups, now: new Date(`${day}T01:17:00Z`), budget });
}

describe('the nightly backup on Cloudflare', () => {
  it('writes the night as the export zip has it: manifest, users, rows, and what it needs', async () => {
    const { b, objects } = bucket();

    const r = await run(b, media().b, '2026-11-25');

    expect(r).toMatchObject({ day: '2026-11-25', made: true, removed: [], copied: 3, waiting: 0, gone: [] });
    const night = JSON.parse(objects.get('orgs/o1/nights/2026-11-25.json')!) as BackupNight;
    expect(night).toMatchObject({ format: LEGACY_FORMAT, orgName: 'Lundhagskyrkan', blobs: [A, B, C], bibles: [BIBLE] });
    expect(night.users.map((u) => u.email)).toEqual(['lars@example.org']);
    expect(night.rows.images).toHaveLength(1);
    expect(objects.get(`orgs/o1/bibles/${BIBLE}.json`)).toBe(`{"text":"${BIBLE}"}`);
  });

  it('keeps each file once, by its hash', async () => {
    const { b, objects } = bucket();

    await run(b, media().b, '2026-11-25');

    expect(objects.get(`orgs/o1/files/${A}`)).toBe('full');
    expect([...objects.keys()].filter((k) => k.includes('/files/'))).toHaveLength(3);
  });

  it('copies at most its budget a run, and the next run goes on without writing the night again', async () => {
    const { b } = bucket();
    const from = media();

    const first = await run(b, from.b, '2026-11-25', 2);
    const second = await run(b, from.b, '2026-11-25', 2);

    expect(first).toMatchObject({ made: true, copied: 2, waiting: 1 });
    expect(second).toMatchObject({ made: false, copied: 1, waiting: 0 });
  });

  it('removes the nights the thinning no longer keeps, and the files only they needed', async () => {
    const old = { blobs: ['e'.repeat(64)], bibles: [] };
    const { b, objects } = bucket({
      'orgs/o1/index.json': JSON.stringify({ nights: { '2025-01-01': old } }),
      'orgs/o1/nights/2025-01-01.json': '{}',
      [`orgs/o1/files/${'e'.repeat(64)}`]: 'old picture',
    });

    const r = await run(b, media().b, '2026-11-25');

    expect(r.removed).toEqual(['2025-01-01']);
    expect(objects.has('orgs/o1/nights/2025-01-01.json')).toBe(false);
    expect(objects.has(`orgs/o1/files/${'e'.repeat(64)}`)).toBe(false);
    expect(JSON.parse(objects.get('orgs/o1/index.json')!).nights).toHaveProperty(['2026-11-25']);
  });

  it('reports a file the organisation no longer has, and never asks for it again', async () => {
    const { b } = bucket();
    const from = bucket({ [mediaKey('o1', A)]: 'full', [mediaKey('o1', B)]: 'thumb' });

    const first = await run(b, from.b, '2026-11-25');
    from.reads.length = 0;
    const second = await run(b, from.b, '2026-11-25');

    expect(first.gone).toEqual([C]);
    expect(second).toMatchObject({ copied: 0, waiting: 0, gone: [] });
    expect(from.reads).toEqual([]);
  });

  it("reads an organisation's rows as the import takes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-backup-r2-'));
    const file = openSqlite(join(dir, 'org.sqlite'), 'node:sqlite');
    try {
      const { rows } = await orgContent(nodeOrgStore(file));

      expect(Object.keys(rows).toSorted()).toEqual([...LEGACY_TABLES].toSorted());
      expect(rows.labels.length).toBeGreaterThan(0);
      expect(legacyRowsProblem(rows)).toBeNull();
    } finally {
      file.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
