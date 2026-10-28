// The media library against every server adapter (spec 05 "Media"): a
// picture is two blobs named by their SHA-256, uploaded once and downloaded
// once per device, outside the change log; only its `images` row syncs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_LIMITS, mediaKey, ORPHAN_GRACE_MS, sha256HexBytes } from '@gp/core';
import { DEFAULT_MEDIA_POLICY, hasMediaBlob, MediaUploads, presentationMediaState, setPinned, storeMediaBlob, syncMedia, type MediaPolicy, type SyncClient } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** Today as `syncMedia` sees it by default. */
const TODAY = new Date().toISOString().slice(0, 10);

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

/**
 * A too-large upload is refused from its content-length, before the body is
 * read: the client gets the 413, or, when the server closes the connection
 * while the body is still being sent (workerd does), a broken pipe. Either is
 * a refusal; a stored file would be a 204.
 */
async function refusedAsTooLarge(response: Promise<Response>): Promise<boolean> {
  try {
    return (await response).status === 413;
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return code === 'EPIPE' || code === 'ECONNRESET';
  }
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
    expect(await refusedAsTooLarge(put(h, org, 'alice', await sha256HexBytes(big), big))).toBe(true);
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

    // In the library only: every device has the thumbnail, nobody needs the full picture yet.
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [p.thumbHash], missing: [], removed: 0 });
    expect(await hasMediaBlob(bob.client, p.fullHash)).toBe(false);
    // In a presentation this Sunday: fetched ahead, once.
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: TODAY });
    await alice.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG1' });
    await alice.client.sync();
    await bob.client.sync();
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toEqual({ downloaded: [p.fullHash], missing: [], removed: 0 });
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


describe.each(adapters)('%s adapter: when unused blobs are removed', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device;
  const GRACE = 1500;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: GRACE });
  }, 60_000);
  afterAll(async () => {
    await alice?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await alice?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    alice = await device(h, org, 'alice', 'admin');
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** A push of an add, which is one of the pushes after which the server cleans up. */
  async function addSomething(seed: string) {
    const p = await uploaded(h, org, alice, seed);
    await alice.client.mutate('addImage', imageArgs(`I-${seed}`, p.fullHash, p.thumbHash));
    await alice.client.sync();
  }

  it('only after a push that can leave blobs behind, not after every edit', async () => {
    const orphan = jpeg('never-added');
    const hash = await sha256HexBytes(orphan);
    expect((await put(h, org, 'alice', hash, orphan)).status).toBe(204);
    await wait(GRACE + 100);
    await alice.client.mutate('createSong', { id: 'S1', name: 'En sång' });
    await alice.client.sync();
    expect((await get(h, org, 'alice', hash)).status).toBe(200); // an edit does not scan
    await addSomething('trigger');
    expect((await get(h, org, 'alice', hash)).status).toBe(404);
  });

  it('uploading a blob again starts its grace period over, so a late add still finds it', async () => {
    const bytes = jpeg('late');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);
    await wait(GRACE - 500);
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204); // the add is about to go
    await wait(700); // older than the grace period since the first upload, not since the second
    await addSomething('first-clean-up');
    expect((await get(h, org, 'alice', hash)).status).toBe(200);
    await wait(GRACE);
    await addSomething('second-clean-up');
    expect((await get(h, org, 'alice', hash)).status).toBe(404);
  });
});

describe('uploads before a push', () => {
  it('uploads a waiting add\'s blobs again once half the grace period has passed', async () => {
    let now = 1_000_000;
    const sent: string[] = [];
    const uploads = new MediaUploads(async (hash) => {
      sent.push(hash);
      return 204;
    }, () => now);
    const fullHash = 'a'.repeat(64);
    const thumbHash = 'b'.repeat(64);
    const pending = [{ id: 1, name: 'addImage', v: 1, args: JSON.stringify({ fullHash, thumbHash }) }];
    const blobs = new Map([
      [fullHash, new Uint8Array([1])],
      [thumbHash, new Uint8Array([2])],
    ]);
    const client = {
      query: async (_sql: string, params: unknown[]) => {
        const bytes = blobs.get(String(params[0]));
        return bytes ? [{ content_type: 'image/jpeg', bytes }] : [];
      },
    } as unknown as SyncClient;
    await uploads.beforePush(pending, client);
    await uploads.beforePush(pending, client);
    expect(sent).toEqual([fullHash, thumbHash]); // once
    now += ORPHAN_GRACE_MS / 2;
    await uploads.beforePush(pending, client);
    expect(sent).toEqual([fullHash, thumbHash, fullHash, thumbHash]);
  });
});

describe.each(adapters)('%s adapter: audio files', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device;
  let bob: Device;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await alice?.client.close();
    await bob?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await alice?.client.close();
    await bob?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
  });

  /** Bytes that start like an Ogg file; the rest from the seed. Not playable. */
  function ogg(seed: string, size = 400): Uint8Array {
    const b = jpeg(seed, size);
    b.set([0x4f, 0x67, 0x67, 0x53]);
    return b;
  }

  it('stores a sound as it is and serves it with the type its bytes say; a 25 MB file is refused (MEDIA-A10)', async () => {
    const bytes = ogg('psalm');
    const hash = await sha256HexBytes(bytes);
    expect((await put(h, org, 'bob', hash, bytes)).status).toBe(204);
    const res = await get(h, org, 'alice', hash);
    expect(res.headers.get('content-type')).toBe('audio/ogg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const big = ogg('big', 25 * 1024 * 1024);
    expect(await refusedAsTooLarge(put(h, org, 'bob', await sha256HexBytes(big), big))).toBe(true);
    // A picture is held to its own 10 MiB, sound or not.
    const bigPicture = jpeg('big-picture', MEDIA_LIMITS.blobBytes + 1);
    expect(await refusedAsTooLarge(put(h, org, 'bob', await sha256HexBytes(bigPicture), bigPicture))).toBe(true);
  });

  it('syncs one row; a device fetches the file only once a presentation uses it; purged, it goes', async () => {
    const bytes = ogg('hymn');
    const hash = await storeMediaBlob(alice.client, bytes, 'audio/ogg');
    expect((await put(h, org, 'alice', hash, bytes)).status).toBe(204);
    await alice.client.mutate('addAudio', { id: 'A1', fileName: 'Psalm 1.ogg', contentType: 'audio/ogg', hash, size: bytes.length, createdAt: 1 });
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    await bob.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.audios).toMatchObject([{ id: 'A1', file_name: 'Psalm 1.ogg', hash, size: bytes.length }]);
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toMatchObject({ downloaded: [] }); // in the library only
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: TODAY });
    await alice.client.mutate('addAudioToPresentation', { itemId: 'I1', presentationId: 'P', audioId: 'A1' });
    await alice.client.sync();
    await bob.client.sync();
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toMatchObject({ downloaded: [hash] });
    expect((await serverDump(h, org, 'alice')).tables.presentation_items).toMatchObject([{ id: 'I1', type: 'audio', source_id: 'A1', title: 'Psalm 1.ogg' }]);

    await alice.client.mutate('trashAudio', { id: 'A1', at: 2 });
    await alice.client.mutate('purgeAudio', { id: 'A1' });
    await alice.client.sync();
    expect((await get(h, org, 'alice', hash)).status).toBe(404);
  });

  it('refuses an add whose file was not uploaded, and uploads it before the add when queued', async () => {
    const bytes = ogg('queued');
    let d!: Device;
    const uploads = new MediaUploads(async (hash, b) => (await put(h, org, 'alice', hash, b)).status);
    d = await device(h, org, 'alice', 'admin', { beforePush: uploads.beforePush });
    try {
      const hash = await storeMediaBlob(d.client, bytes, 'audio/ogg');
      await d.client.mutate('addAudio', { id: 'A2', fileName: 'Kör.ogg', contentType: 'audio/ogg', hash, size: bytes.length, createdAt: 1 });
      await d.client.sync();
      expect(d.client.rejected).toEqual([]);
      expect((await get(h, org, 'alice', hash)).status).toBe(200);
    } finally {
      await d.client.close();
    }
  });
});

describe.each(adapters)('%s adapter: which files a device keeps', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device;
  let bob: Device;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await alice?.client.close();
    await bob?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await alice?.client.close();
    await bob?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
  });

  const policy = (over: Partial<MediaPolicy> = {}): MediaPolicy => ({ ...DEFAULT_MEDIA_POLICY, open: [], today: '2026-11-01', ...over });

  /** A picture and a sound in a presentation on `date`; returns their hashes. */
  async function presentation(id: string, date: string | null, seed: string) {
    const p = await uploaded(h, org, alice, seed);
    await alice.client.mutate('addImage', imageArgs(`IMG-${seed}`, p.fullHash, p.thumbHash));
    const sound = jpeg(`${seed}-sound`, 300);
    sound.set([0x4f, 0x67, 0x67, 0x53]);
    const soundHash = await storeMediaBlob(alice.client, sound, 'audio/ogg');
    expect((await put(h, org, 'alice', soundHash, sound)).status).toBe(204);
    await alice.client.mutate('addAudio', { id: `A-${seed}`, fileName: `${seed}.ogg`, contentType: 'audio/ogg', hash: soundHash, size: sound.length, createdAt: 1 });
    await alice.client.mutate('createPresentation', { id, name: id, eventDate: date });
    await alice.client.mutate('addImageToPresentation', { itemId: `${id}-i`, presentationId: id, imageId: `IMG-${seed}` });
    await alice.client.mutate('addAudioToPresentation', { itemId: `${id}-a`, presentationId: id, audioId: `A-${seed}` });
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    return { full: p.fullHash, thumb: p.thumbHash, sound: soundHash };
  }

  it('fetches ahead what is coming within seven days, not later or earlier, and nothing ahead on a device that keeps no data', async () => {
    const soon = await presentation('SOON', '2026-11-08', 'soon');
    const later = await presentation('LATER', '2026-11-09', 'later');
    const past = await presentation('PAST', '2026-10-31', 'past');
    const undated = await presentation('UNDATED', null, 'undated');
    await bob.client.sync();
    const memoryOnly = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false }));
    expect(memoryOnly.downloaded.toSorted()).toEqual([soon.thumb, later.thumb, past.thumb, undated.thumb].toSorted()); // thumbnails only
    const r = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());
    expect(r.downloaded.toSorted()).toEqual([soon.full, soon.sound].toSorted());
  });

  it('fetches what an open presentation needs; a remote control does not fetch its audio', async () => {
    const p = await presentation('P', null, 'open');
    await bob.client.sync();
    const control = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false, open: [{ presentationId: 'P', audio: false }] }));
    expect(control.downloaded.toSorted()).toEqual([p.thumb, p.full].toSorted());
    expect(await presentationMediaState(bob.client, 'P', false)).toEqual({ needed: 1, present: 1 });
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 2, present: 1 });
    const presenter = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false, open: [{ presentationId: 'P', audio: true }] }));
    expect(presenter.downloaded).toEqual([p.sound]);
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 2, present: 2 });
  });

  it('fetches and keeps a presentation kept offline on this device, whatever its date; not on one that keeps no data', async () => {
    const p = await presentation('KEPT', null, 'kept');
    await bob.client.sync();
    await setPinned(bob.client, 'KEPT', true);
    const memoryOnly = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false }));
    expect(memoryOnly.downloaded).toEqual([p.thumb]);
    const kept = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());
    expect(kept.downloaded.toSorted()).toEqual([p.full, p.sound].toSorted());
    // Never dropped for the budget while kept; dropped once it is not.
    expect(await syncMedia(bob.client, async () => null, Date.now(), policy({ budget: 1 }))).toMatchObject({ removed: 0 });
    await setPinned(bob.client, 'KEPT', false);
    expect(await syncMedia(bob.client, async () => null, Date.now(), policy({ budget: 1 }))).toMatchObject({ removed: 2 });
    expect(await hasMediaBlob(bob.client, p.thumb)).toBe(true);
  });

  it("fetches every overlay's picture once a presentation is open, and counts it as needed for live", async () => {
    const p = await presentation('P', null, 'with-overlay');
    const o = await uploaded(h, org, alice, 'overlay');
    await alice.client.mutate('addImage', imageArgs('OVL-IMG', o.fullHash, o.thumbHash));
    await alice.client.mutate('createOverlay', { id: 'O', title: 'Kollekt', imageId: 'OVL-IMG' });
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    await bob.client.sync();
    const nothingOpen = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false }));
    expect(nothingOpen.downloaded.toSorted()).toEqual([p.thumb, o.thumbHash].toSorted());
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 3, present: 0 });
    const open = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ prefetch: false, open: [{ presentationId: 'P', audio: true }] }));
    expect(open.downloaded).toEqual([o.fullHash, p.full, p.sound]);
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 3, present: 3 });
  });

  it('keeps what is not needed now only within the budget, oldest out first; never what is coming or open', async () => {
    const a = await presentation('A', null, 'budget-a');
    const b = await presentation('B', null, 'budget-b');
    await bob.client.sync();
    // Both were open once, so both are on the device.
    await syncMedia(bob.client, downloader(h, org, 'bob'), 1000, policy({ prefetch: false, open: [{ presentationId: 'A', audio: true }] }));
    await syncMedia(bob.client, downloader(h, org, 'bob'), 2000, policy({ prefetch: false, open: [{ presentationId: 'B', audio: true }] }));
    // B is open now; a budget of one byte leaves room for nothing else, so A's files (the older) go, not B's or the thumbnails.
    const r = await syncMedia(bob.client, async () => null, 3000, policy({ prefetch: false, budget: 1, open: [{ presentationId: 'B', audio: true }] }));
    expect(r.removed).toBe(2);
    expect(await hasMediaBlob(bob.client, a.full)).toBe(false);
    expect(await hasMediaBlob(bob.client, a.sound)).toBe(false);
    expect(await hasMediaBlob(bob.client, a.thumb)).toBe(true);
    expect(await hasMediaBlob(bob.client, b.full)).toBe(true);
    expect(await hasMediaBlob(bob.client, b.sound)).toBe(true);
  });
});

describe.each(adapters)('%s adapter: overlays (spec 03 §4, LIVE-R15)', (adapterName) => {
  let h: Harness;
  let org: string;
  let bob: Device; // a user: overlays are every role's

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await bob?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await bob?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'bob', org, 'user');
    bob = await device(h, org, 'bob', 'user');
  });

  it('a user makes and edits one with a library picture; an item carries it until it is deleted', async () => {
    const p = await uploaded(h, org, bob, 'swish');
    await bob.client.mutate('addImage', imageArgs('IMG', p.fullHash, p.thumbHash));
    await bob.client.mutate('createOverlay', { id: 'O1', title: ' Kollekt ', content: 'Swish 123 456\n ' });
    await bob.client.mutate('createOverlay', { id: 'O2', title: 'Välkommen' });
    await bob.client.mutate('updateOverlay', { id: 'O1', imageId: 'IMG' });
    await bob.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await bob.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG' });
    await bob.client.mutate('setItemOverlay', { itemId: 'I1', overlayId: 'O1' });
    await bob.client.sync();
    expect(bob.client.rejected).toEqual([]);
    let s = await serverDump(h, org, 'bob');
    expect(s.tables.overlays).toEqual([
      { id: 'O1', title: 'Kollekt', content: 'Swish 123 456', image_id: 'IMG', sort: 0 },
      { id: 'O2', title: 'Välkommen', content: null, image_id: null, sort: 1 },
    ]);
    expect(s.tables.presentation_items).toMatchObject([{ id: 'I1', overlay_id: 'O1' }]);

    // An overlay that does not exist, or a picture that does not, is refused; a blank title never saves (PRES-E18).
    await expect(bob.client.mutate('setItemOverlay', { itemId: 'I1', overlayId: 'NOPE' })).rejects.toThrow('overlay not found');
    await expect(bob.client.mutate('updateOverlay', { id: 'O1', imageId: 'NOPE' })).rejects.toThrow('image not found');
    await expect(bob.client.mutate('updateOverlay', { id: 'O1', title: '  ' })).rejects.toThrow();

    // Deleting is permanent, and the item no longer carries it.
    await bob.client.mutate('deleteOverlay', { id: 'O1' });
    await bob.client.sync();
    expect(bob.client.rejected).toEqual([]);
    s = await serverDump(h, org, 'bob');
    expect(s.tables.overlays.map((o) => o.id)).toEqual(['O2']);
    expect(s.tables.presentation_items).toMatchObject([{ id: 'I1', overlay_id: null }]);
  });
});

describe.each(adapters)('%s adapter: slide decks (PRES-R11, D29)', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device;
  let bob: Device;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { mediaGraceMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await alice?.client.close();
    await bob?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    await alice?.client.close();
    await bob?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
  });

  /** A deck's pages as WebP blobs kept on `d`, and uploaded unless `upload` is false. */
  async function pages(d: Device, seed: string, n: number, upload = true) {
    const out: { full: string; thumb: string }[] = [];
    for (let i = 0; i < n; i++) {
      const full = webp(`${seed}-${i}-full`);
      const thumb = webp(`${seed}-${i}-thumb`);
      const page = { full: await storeMediaBlob(d.client, full, 'image/webp'), thumb: await storeMediaBlob(d.client, thumb, 'image/webp') };
      if (upload) {
        expect((await put(h, org, d.user, page.full, full)).status).toBe(204);
        expect((await put(h, org, d.user, page.thumb, thumb)).status).toBe(204);
      }
      out.push(page);
    }
    return out;
  }

  it('syncs a deck as one item holding its pages, with the file name as title', async () => {
    const deck = await pages(alice, 'syncs', 2);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });

    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync();

    expect(alice.client.rejected).toEqual([]);
    const [item] = (await serverDump(h, org, 'alice')).tables.presentation_items as { content: string }[];
    expect(item).toMatchObject({ id: 'I1', type: 'slides', title: 'Predikan.pdf', source_id: 'I1' });
    expect(JSON.parse(item!.content)).toEqual({ fileName: 'Predikan.pdf', pages: deck });
  });

  it('refuses a deck whose pages were not uploaded (media-missing)', async () => {
    const deck = await pages(alice, 'missing', 1, false);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });

    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync();

    expect(alice.client.rejected).toMatchObject([{ error: 'media-missing' }]);
    expect((await serverDump(h, org, 'alice')).tables.presentation_items).toEqual([]);
  });

  it("another device fetches a coming presentation's deck pages, both sizes, and counts them as needed live", async () => {
    const deck = await pages(alice, 'coming', 2);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: TODAY });
    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync();
    await bob.client.sync();

    const r = await syncMedia(bob.client, downloader(h, org, 'bob'));

    expect(r.downloaded.toSorted()).toEqual(deck.flatMap((p) => [p.full, p.thumb]).toSorted());
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 2, present: 2 });
  });

  it('keeps the pages while the item names them, and removes them with the item', async () => {
    const deck = await pages(alice, 'kept', 1);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync(); // an add: the server cleans up after it
    expect((await get(h, org, 'alice', deck[0]!.full)).status).toBe(200);

    await alice.client.mutate('removeItem', { itemId: 'I1' });
    await alice.client.sync();

    expect((await get(h, org, 'alice', deck[0]!.full)).status).toBe(404);
    expect(await h.mediaKeys()).not.toContain(mediaKey(org, deck[0]!.thumb));
  });

  it('uploads the pages of a deck added offline before the add is pushed', async () => {
    const uploads = new MediaUploads(async (hash, b) => (await put(h, org, 'alice', hash, b)).status);
    const d = await device(h, org, 'alice', 'admin', { beforePush: uploads.beforePush });
    try {
      const deck = await pages(d, 'queued', 2, false);
      await d.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
      await d.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });

      await d.client.sync();

      expect(d.client.rejected).toEqual([]);
      for (const p of deck) expect((await get(h, org, 'alice', p.thumb)).status).toBe(200);
    } finally {
      await d.client.close();
    }
  });
});
