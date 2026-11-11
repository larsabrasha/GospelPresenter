// Sheet music, recordings and links on a song (spec 02 "Song material"), against every server adapter: a PDF or an
// audio file is a blob as a picture is, only its row syncs; a link is a row alone. A device fetches a file when it is
// opened, never by itself.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { storeMediaBlob, syncMedia } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { downloader, get, put } from './media-fixtures.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** Bytes that start as a PDF; the rest is made from the seed, so each has its own hash. */
function pdf(seed: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n% ${seed}\n%%EOF\n`);
}

describe.each(adapters)('%s adapter: a song\'s material', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device;
  let bob: Device;
  const devices: Device[] = [];

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);

  afterAll(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    await h?.close();
  });

  beforeEach(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
    devices.push(alice, bob);
    await alice.client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
  });

  it('keeps a PDF as it is, serves it only as a download that runs nothing, and syncs its row', async () => {
    // Arrange
    const bytes = pdf('piano');
    const hash = await storeMediaBlob(alice.client, bytes, 'application/pdf');
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);

    // Act
    await alice.client.mutate('addSongFile', { id: 'M1', songId: 'S1', title: 'Piano', contentType: 'application/pdf', hash, size: bytes.length, createdAt: 1 });
    await alice.client.sync();

    // Assert
    expect(alice.client.rejected).toEqual([]);
    expect((await serverDump(h, org, 'alice')).tables.song_materials).toMatchObject([{ id: 'M1', song_id: 'S1', kind: 'file', title: 'Piano', hash, content_type: 'application/pdf', sort: 0 }]);
    const res = await get(h, org, 'bob', hash);
    expect([res.status, res.headers.get('content-type'), res.headers.get('content-disposition'), res.headers.get('content-security-policy')]).toEqual([200, 'application/pdf', 'attachment', 'sandbox']);
  });

  it('does not fetch a song\'s file to a device by itself', async () => {
    // Arrange
    const bytes = pdf('gitarr');
    const hash = await storeMediaBlob(alice.client, bytes, 'application/pdf');
    await put(h, org, 'alice', hash, bytes);
    await alice.client.mutate('addSongFile', { id: 'M1', songId: 'S1', title: 'Gitarr', contentType: 'application/pdf', hash, size: bytes.length, createdAt: 1 });
    await alice.client.sync();
    await bob.client.sync();

    // Act
    const fetched = await syncMedia(bob.client, downloader(h, org, 'bob'));

    // Assert
    expect(fetched.downloaded).toEqual([]);
  });

  it('adds links after the files, in order, and refuses what is not a web address', async () => {
    // Arrange
    const ok = { songId: 'S1', createdAt: 1 };

    // Act
    await alice.client.mutate('addSongLink', { ...ok, id: 'L1', title: 'Spotify', url: 'https://open.spotify.com/track/abc' });
    await alice.client.mutate('addSongLink', { ...ok, id: 'L2', title: 'YouTube', url: 'https://www.youtube.com/watch?v=x' });
    const bad = alice.client.mutate('addSongLink', { ...ok, id: 'L3', title: 'Skript', url: 'javascript:alert(1)' });

    // Assert
    await expect(bad).rejects.toThrow();
    await alice.client.sync();
    const rows = (await serverDump(h, org, 'alice')).tables.song_materials as { id: string; sort: number; url: string }[];
    expect(rows.map((r) => [r.id, r.sort])).toEqual([
      ['L1', 0],
      ['L2', 1],
    ]);
  });

  it('refuses a file whose bytes this device has but never uploaded', async () => {
    // Arrange
    const bytes = pdf('missing');
    const hash = await storeMediaBlob(alice.client, bytes, 'application/pdf');

    // Act
    await alice.client.mutate('addSongFile', { id: 'M2', songId: 'S1', title: 'Saknas', contentType: 'application/pdf', hash, size: bytes.length, createdAt: 1 });
    await alice.client.sync();

    // Assert
    expect(alice.client.rejected.map((r) => r.error)).toEqual(['media-missing']);
  });

  it('renames and removes material, and a purged song takes its material with it', async () => {
    // Arrange
    await alice.client.mutate('addSongLink', { id: 'L1', songId: 'S1', title: 'Spotify', url: 'https://open.spotify.com/track/abc', createdAt: 1 });
    await alice.client.mutate('addSongLink', { id: 'L2', songId: 'S1', title: 'YouTube', url: 'https://youtu.be/x', createdAt: 1 });

    // Act
    await alice.client.mutate('renameSongMaterial', { id: 'L1', title: 'Originalet' });
    await alice.client.mutate('removeSongMaterial', { id: 'L2' });
    await alice.client.sync();
    const kept = (await serverDump(h, org, 'alice')).tables.song_materials;
    await alice.client.mutate('trashSong', { id: 'S1', at: 2 });
    await alice.client.mutate('purgeSong', { id: 'S1' });
    await alice.client.sync();

    // Assert
    expect(kept).toMatchObject([{ id: 'L1', title: 'Originalet' }]);
    expect((await serverDump(h, org, 'alice')).tables.song_materials).toEqual([]);
  });
});
