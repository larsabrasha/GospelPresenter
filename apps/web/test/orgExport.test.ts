import { describe, expect, it } from 'vitest';
import { readZip, utf8Decode } from '@gp/core';
import type { DbStatus } from '../src/db/protocol.ts';
import { exportOrg, OrgExportError } from '../src/media/orgExport.ts';
import { zipBlob } from '../src/media/zipBlob.ts';

const synced: DbStatus = { storage: 'opfs', connected: true, syncing: false, pending: 0, updateRequired: false, authError: null, rejected: [] };

/** A device's database as the export reads it: no rows, and the sync's status after a sync now. */
const deviceWith = (status: DbStatus) => ({ query: async () => [], syncNow: async () => status });

describe('the export of an organisation', () => {
  it.each([
    ['changes still to send', { ...synced, pending: 2 }],
    ['a server that wants a newer app', { ...synced, updateRequired: true }],
    ['a session the server refuses', { ...synced, authError: 'unauthenticated' as const }],
  ])('refuses a device with %s: what it has may not be what the server has', async (_case, status) => {
    const run = exportOrg(deviceWith(status), 'Lilla Kyrkan', () => {});

    await expect(run).rejects.toEqual(new OrgExportError('not-synced'));
  });
});

describe('a zip made of Blobs', () => {
  it('reads back, entry by entry, as the import reads it', async () => {
    const zip = await zipBlob([
      { name: 'manifest.json', data: new Blob(['{"format":8}']) },
      { name: 'blobs/åäö', data: new Blob([new Uint8Array([1, 2, 3])]) },
    ]);

    const entries = await Promise.all(readZip(new Uint8Array(await zip.arrayBuffer())).map(async (e) => [e.name, await e.read()] as const));

    expect(entries.map(([name, data]) => [name, name.endsWith('.json') ? utf8Decode(data) : [...data]])).toEqual([
      ['manifest.json', '{"format":8}'],
      ['blobs/åäö', [1, 2, 3]],
    ]);
  });
});
