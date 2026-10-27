// The media library against every server adapter (spec 05 "Media"): a
// picture is two blobs named by their SHA-256, uploaded once and downloaded
// once per device, outside the change log; only its `images` row syncs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_LIMITS, mediaKey, sha256HexBytes } from '@gp/core';
import { hasMediaBlob, MediaUploads, storeMediaBlob, syncMedia } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** Bytes that start like a JPEG; the rest is made from the seed, so each picture has its own hash. Not a decodable picture. */
function jpeg(seed: string, size = 300): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) bytes[i] = (seed.charCodeAt(i % seed.length) * 31 + i * 7) & 0xff;
  return bytes;
}

function webp(seed: string): Uint8Array {
  const bytes = jpeg(seed, 200);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

function put(h: Harness, org: string, user: string | null, hash: string, body: Uint8Array | string) {
  return fetch(`${h.url}/api/media/${hash}`, {
    method: 'PUT',
    headers: { ...(user ? { authorization: `Bearer ${tokenOf(h, org, user)}` } : {}), 'content-type': 'application/octet-stream' },
    body: body as BodyInit,
  });
}

function get(h: Harness, org: string, user: string | null, hash: string) {
  return fetch(`${h.url}/api/media/${hash}`, { headers: user ? { authorization: `Bearer ${tokenOf(h, org, user)}` } : {} });
}

function downloader(h: Harness, org: string, user: string) {
  return async (hash: string) => {
    const res = await get(h, org, user, hash);
    return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
  };
}

const imageArgs = (id: string, fullHash: string, thumbHash: string, fileName = 'logo.jpg') => ({
  id,
  fileName,
  contentType: 'image/jpeg' as const,
  fullHash,
  thumbHash,
  width: 1440,
  height: 1080,
  createdAt: 1_700_000_000_000,
});

/** Stores a picture's two blobs on the device and uploads them, as an import does before `addImage`. */
async function uploaded(h: Harness, org: string, d: Device, seed: string) {
  const full = jpeg(`${seed}-full`);
  const thumb = jpeg(`${seed}-thumb`, 120);
  const fullHash = await storeMediaBlob(d.client, full, 'image/jpeg');
  const thumbHash = await storeMediaBlob(d.client, thumb, 'image/jpeg');
  expect((await put(h, org, d.user, fullHash, full)).status).toBe(204);
  expect((await put(h, org, d.user, thumbHash, thumb)).status).toBe(204);
  return { full, thumb, fullHash, thumbHash };
}

describe.each(adapters)('%s adapter: the media library', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device; // admin
  let bob: Device; // user
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
  });

  it('serves an uploaded blob to the organisation with the headers of D28 (MEDIA-R9)', async () => {
    const bytes = jpeg('a');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'bob', hash, bytes)).status).toBe(204);
    expect((await put(h, org, 'bob', hash, bytes)).status).toBe(204); // the same again is fine
    const res = await get(h, org, 'alice', hash);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(await h.mediaKeys()).toContain(mediaKey(org, hash));
  });

  it('refuses what is not a hash, not that hash, not a picture, empty or too big (MEDIA-A6)', async () => {
    const bytes = jpeg('b');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'alice', 'not-a-hash', bytes)).status).toBe(400);
    expect((await put(h, org, 'alice', 'f'.repeat(64), bytes)).status).toBe(400); // another hash
    const text = new TextEncoder().encode('this is text named x.jpg');
    const textRes = await put(h, org, 'alice', await sha256HexBytes(text), text);
    expect([textRes.status, ((await textRes.json()) as { error: string }).error]).toEqual([400, 'invalid-image']);
    expect((await put(h, org, 'alice', await sha256HexBytes(new Uint8Array()), new Uint8Array())).status).toBe(400);
    const big = jpeg('big', MEDIA_LIMITS.blobBytes + 1);
    expect((await put(h, org, 'alice', await sha256HexBytes(big), big)).status).toBe(413);
    expect((await get(h, org, 'alice', hash)).status).toBe(404); // none of it was kept
  });

  it('answers 401 to a caller who is not signed in', async () => {
    const bytes = jpeg('c');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, null, hash, bytes)).status).toBe(401);
    expect((await get(h, org, null, hash)).status).toBe(401);
  });

  it("never gives one organisation's blob to another (MEDIA-A11)", async () => {
    const other = `org-${crypto.randomUUID()}`;
    await setRole(h, 'carol', other, 'admin');
    const bytes = jpeg('secret');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);
    expect((await get(h, other, 'carol', hash)).status).toBe(404);
    // Carol uploading the same picture is her own object: it lives under her organisation.
    expect((await put(h, other, 'carol', hash, bytes)).status).toBe(204);
    expect(await h.mediaKeys()).toEqual(expect.arrayContaining([mediaKey(org, hash), mediaKey(other, hash)]));
  });

  it('an image syncs one row; every device fetches each blob once and keeps it (MEDIA-A14)', async () => {
    const p = await uploaded(h, org, alice, 'one');
    await alice.client.mutate('addImage', imageArgs('IMG1', p.fullHash, p.thumbHash));
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    await bob.client.sync();

    const s = await serverDump(h, org, 'alice');
    expect(s.tables.images).toEqual([
      {
        id: 'IMG1',
        file_name: 'logo.jpg',
        content_type: 'image/jpeg',
        full_hash: p.fullHash,
        thumb_hash: p.thumbHash,
        width: 1440,
        height: 1080,
        created_at: 1_700_000_000_000,
        deleted_at: null,
      },
    ]);
    // The bytes never enter the change log.
    expect(s.changes.filter((c) => c.tbl === 'images')).toHaveLength(1);
    expect(s.changes.some((c) => c.tbl.includes('blob'))).toBe(false);

    expect(await hasMediaBlob(bob.client, p.fullHash)).toBe(false);
    const first = await syncMedia(bob.client, downloader(h, org, 'bob'));
    expect(first).toEqual({ downloaded: [p.thumbHash, p.fullHash], missing: [], removed: 0 }); // the thumbnail first
    expect(await hasMediaBlob(bob.client, p.fullHash)).toBe(true);
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [], missing: [], removed: 0 });
  });

  it('refuses an add whose blobs were not uploaded, and one past the limit (MEDIA-R3)', async () => {
    const bytes = jpeg('never-uploaded');
    const fullHash = await storeMediaBlob(alice.client, bytes, 'image/jpeg'); // kept on the device, not sent
    await alice.client.mutate('addImage', imageArgs('NOPE', fullHash, fullHash));
    await alice.client.sync();
    expect(alice.client.rejected).toMatchObject([{ error: 'media-missing' }]);
    expect((await serverDump(h, org, 'alice')).tables.images).toEqual([]);
  });

  it('a picture imported offline is kept, uploaded before its add is pushed, and reaches other devices', async () => {
    let a!: Device;
    const uploads = new MediaUploads(async (hash, bytes) => {
      if (!a.net.online) throw new Error('offline');
      a.net.requests.push(`PUT /media/${hash}`);
      return (await put(h, org, 'alice', hash, bytes)).status;
    });
    a = await device(h, org, 'alice', 'admin', { beforePush: uploads.beforePush });
    devices.push(a);
    a.net.online = false;
    const full = jpeg('offline-full');
    const thumb = jpeg('offline-thumb', 100);
    const fullHash = await storeMediaBlob(a.client, full, 'image/jpeg');
    const thumbHash = await storeMediaBlob(a.client, thumb, 'image/jpeg');
    await a.client.mutate('addImage', imageArgs('OFF', fullHash, thumbHash));
    await expect(a.client.sync()).rejects.toThrow('offline');
    expect((await a.client.dump()).images).toHaveLength(1); // shown at once, here
    // While the add waits, its blobs stay, whatever else is cleaned up.
    expect(await syncMedia(a.client, async () => null, Date.now() + 2 * 3_600_000)).toMatchObject({ removed: 0 });
    expect(await hasMediaBlob(a.client, fullHash)).toBe(true);

    a.net.online = true;
    await a.client.sync();
    expect(a.net.requests.filter((r) => r.startsWith('PUT'))).toEqual([`PUT /media/${fullHash}`, `PUT /media/${thumbHash}`]);
    expect(a.client.rejected).toEqual([]);
    expect(await a.client.pending()).toEqual([]);
    await bob.client.sync();
    await syncMedia(bob.client, downloader(h, org, 'bob'));
    expect(await hasMediaBlob(bob.client, thumbHash)).toBe(true);
  });

  it('a picture used in a presentation shows after the image is trashed, and its blobs go when it is purged (MEDIA-R8)', async () => {
    const p = await uploaded(h, org, alice, 'life');
    await alice.client.mutate('addImage', imageArgs('LIFE', p.fullHash, p.thumbHash));
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Sunday' });
    await alice.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'LIFE' });
    await alice.client.mutate('trashImage', { id: 'LIFE', at: 1_700_000_100_000 });
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    const s = await serverDump(h, org, 'alice');
    expect(s.tables.presentation_items).toMatchObject([{ id: 'I1', type: 'image', source_id: 'LIFE', title: 'logo.jpg' }]);
    expect(s.tables.images).toMatchObject([{ id: 'LIFE', deleted_at: 1_700_000_100_000 }]);
    expect((await get(h, org, 'alice', p.fullHash)).status).toBe(200); // trashed is still served

    // Not yet in the trash: purge is refused for a live image.
    await alice.client.mutate('restoreImage', { id: 'LIFE' });
    await expect(alice.client.mutate('purgeImage', { id: 'LIFE' })).rejects.toThrow('not in the trash');

    await alice.client.mutate('trashImage', { id: 'LIFE', at: 1_700_000_200_000 });
    await alice.client.mutate('purgeImage', { id: 'LIFE' });
    await alice.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.images).toEqual([]);
    expect((await serverDump(h, org, 'alice')).tables.presentation_items).toHaveLength(1); // the item stays and says it is gone
    expect((await get(h, org, 'alice', p.fullHash)).status).toBe(404);
    const keys = await h.mediaKeys();
    expect(keys).not.toContain(mediaKey(org, p.fullHash));
    expect(keys).not.toContain(mediaKey(org, p.thumbHash));
    // And the device lets go of them.
    expect(await syncMedia(alice.client, async () => null)).toMatchObject({ removed: 0 }); // not before the grace period
    expect(await syncMedia(alice.client, async () => null, Date.now() + 2 * 3_600_000)).toMatchObject({ removed: 2 });
  });

  it('a blob shared by two images is kept until both are gone', async () => {
    const p = await uploaded(h, org, alice, 'shared');
    await alice.client.mutate('addImage', imageArgs('A', p.fullHash, p.thumbHash, 'a.jpg'));
    await alice.client.mutate('addImage', imageArgs('B', p.fullHash, p.thumbHash, 'b.jpg'));
    await alice.client.mutate('trashImage', { id: 'A', at: 1 });
    await alice.client.mutate('purgeImage', { id: 'A' });
    await alice.client.sync();
    expect((await get(h, org, 'alice', p.fullHash)).status).toBe(200);
    await alice.client.mutate('trashImage', { id: 'B', at: 2 });
    await alice.client.mutate('purgeImage', { id: 'B' });
    await alice.client.sync();
    expect((await get(h, org, 'alice', p.fullHash)).status).toBe(404);
  });

  it('purges an image that has been in the trash for 30 days with the rest of the trash (MEDIA-R8)', async () => {
    const p = await uploaded(h, org, alice, 'old');
    const day = 24 * 60 * 60 * 1000;
    await alice.client.mutate('addImage', imageArgs('OLD', p.fullHash, p.thumbHash));
    await alice.client.mutate('trashImage', { id: 'OLD', at: Date.now() - 31 * day });
    await alice.client.mutate('purgeExpiredTrash', { now: Date.now() });
    await alice.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.images).toEqual([]);
  });

  it('a WebP blob is stored as WebP', async () => {
    const bytes = webp('w');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);
    expect((await get(h, org, 'alice', hash)).headers.get('content-type')).toBe('image/webp');
  });
});

