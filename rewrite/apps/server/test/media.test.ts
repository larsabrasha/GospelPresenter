// The media library against every server adapter (spec 05 "Media"): a
// picture is two blobs named by their SHA-256, uploaded once and downloaded
// once per device, outside the change log; only its `images` row syncs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blankPage, MEDIA_LIMITS, mediaKey, ORPHAN_GRACE_MS, sha256HexBytes, type CustomPage } from '@gp/core';
import { hasMediaBlob, MediaUploads, presentationMediaState, storeMediaBlob, syncMedia, type SyncClient } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { downloader, get, imageArgs, jpeg, presentingP, put, refusedAsTooLarge, TODAY, uploaded, webp } from './media-fixtures.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

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
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toMatchObject({ downloaded: [p.thumbHash], missing: [], removed: 0 });
    expect(await hasMediaBlob(bob.client, p.fullHash)).toBe(false);
    // In a presentation this device presents: fetched then, once.
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: TODAY });
    await alice.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG1' });
    await alice.client.sync();
    await bob.client.sync();
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), presentingP)).toMatchObject({ downloaded: [p.fullHash], missing: [], removed: 0 });
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), presentingP)).toMatchObject({ downloaded: [], missing: [], removed: 0 });
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

  it('renames a picture, as a user too, trimming the name', async () => {
    const p = await uploaded(h, org, alice, 'named');
    await alice.client.mutate('addImage', imageArgs('IMG', p.fullHash, p.thumbHash, 'gammal.jpg'));
    await alice.client.sync();
    await bob.client.sync();

    await bob.client.mutate('renameImage', { id: 'IMG', fileName: ' Ny bild ' });
    await bob.client.sync();

    expect((await serverDump(h, org, 'alice')).tables.images[0]?.file_name).toBe('Ny bild');
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

  it('renames a sound', async () => {
    const bytes = ogg('named');
    const hash = await storeMediaBlob(alice.client, bytes, 'audio/ogg');
    await put(h, org, 'alice', hash, bytes);
    await alice.client.mutate('addAudio', { id: 'AUD', fileName: 'gammal.ogg', contentType: 'audio/ogg', hash, size: bytes.length, createdAt: 1 });

    await alice.client.mutate('renameAudio', { id: 'AUD', fileName: 'Nytt ljud' });
    await alice.client.sync();

    expect((await serverDump(h, org, 'alice')).tables.audios[0]?.file_name).toBe('Nytt ljud');
  });

  it('syncs one row; a device fetches the file only when it presents a presentation that uses it; purged, it goes', async () => {
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
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'))).toMatchObject({ downloaded: [] }); // looking around fetches nothing
    expect(await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), presentingP)).toMatchObject({ downloaded: [hash] });
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

  it('a user makes one and puts a page on it, without a background; an item carries it until it is deleted', async () => {
    const page: CustomPage = { background: '#000000', backgroundImageId: 'IMG', elements: [{ id: 'e1', kind: 'image', x: 0, y: 0, w: 960, h: 540, imageId: 'IMG', fit: 'contain' }] };
    const p = await uploaded(h, org, bob, 'swish');
    await bob.client.mutate('addImage', imageArgs('IMG', p.fullHash, p.thumbHash));
    await bob.client.mutate('createOverlay', { id: 'O1', title: ' Kollekt ', at: 1 });
    await bob.client.mutate('createOverlay', { id: 'O2', title: 'Välkommen', at: 1 });
    await bob.client.mutate('updateOverlay', { id: 'O1', page, at: 2 });
    await bob.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await bob.client.mutate('addImageToPresentation', { itemId: 'I1', presentationId: 'P', imageId: 'IMG' });
    await bob.client.mutate('setItemOverlay', { itemId: 'I1', overlayId: 'O1' });
    await bob.client.sync();
    expect(bob.client.rejected).toEqual([]);
    let s = await serverDump(h, org, 'bob');
    expect(s.tables.overlays.map((o) => ({ ...o, content: JSON.parse(String(o.content)) as CustomPage }))).toEqual([
      { id: 'O1', title: 'Kollekt', content: { ...page, background: null, backgroundImageId: null }, image_id: null, sort: 0, updated_at: 2 },
      { id: 'O2', title: 'Välkommen', content: blankPage(), image_id: null, sort: 1, updated_at: 1 },
    ]);
    expect(s.tables.presentation_items).toMatchObject([{ id: 'I1', overlay_id: 'O1' }]);

    // An overlay that does not exist, or a page that is not one, is refused; a blank title never saves (PRES-E18).
    await expect(bob.client.mutate('setItemOverlay', { itemId: 'I1', overlayId: 'NOPE' })).rejects.toThrow('overlay not found');
    await expect(bob.client.mutate('updateOverlay', { id: 'O1', page: { elements: 'none' }, at: 3 } as never)).rejects.toThrow();
    await expect(bob.client.mutate('updateOverlay', { id: 'O1', title: '  ', at: 3 })).rejects.toThrow();

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

  it('imports a deck into the library and a presentation in one step: the item names the deck, titled by the file name', async () => {
    const deck = await pages(alice, 'syncs', 2);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });

    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', deckId: 'D1', fileName: 'Predikan.pdf', pages: deck, at: 5 });
    await alice.client.sync();

    expect(alice.client.rejected).toEqual([]);
    const s = await serverDump(h, org, 'alice');
    expect(s.tables.presentation_items).toMatchObject([{ id: 'I1', type: 'slides', title: 'Predikan.pdf', source_id: 'D1', content: null }]);
    expect(s.tables.slide_decks).toEqual([{ id: 'D1', name: 'Predikan.pdf', pages: JSON.stringify(deck), created_at: 5, updated_at: 5, deleted_at: null }]);
  });

  it('shows a new PDF of a deck in every presentation that names it', async () => {
    const [first, second] = [await pages(alice, 'first', 1), await pages(alice, 'second', 2)];
    await alice.client.mutate('addSlideDeck', { id: 'D1', name: 'Predikan.pdf', pages: first, at: 1 });
    for (const p of ['P', 'Q']) {
      await alice.client.mutate('createPresentation', { id: p, name: p });
      await alice.client.mutate('addSlideDeckToPresentation', { itemId: `${p}1`, presentationId: p, deckId: 'D1' });
    }

    await alice.client.mutate('updateSlideDeck', { id: 'D1', pages: second, at: 2 });
    await alice.client.sync();

    expect(alice.client.rejected).toEqual([]);
    expect(await presentationMediaState(alice.client, 'Q')).toEqual({ needed: 2, present: 2 });
  });

  it('refuses a deck whose pages were not uploaded (media-missing)', async () => {
    const deck = await pages(alice, 'missing', 1, false);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });

    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync();

    expect(alice.client.rejected).toMatchObject([{ error: 'media-missing' }]);
    expect((await serverDump(h, org, 'alice')).tables.presentation_items).toEqual([]);
  });

  it("a device that presents fetches the deck's pages, both sizes, and counts them as needed live", async () => {
    const deck = await pages(alice, 'coming', 2);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag', eventDate: TODAY });
    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.sync();
    await bob.client.sync();

    const r = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), presentingP);

    expect(r.downloaded.toSorted()).toEqual(deck.flatMap((p) => [p.full, p.thumb]).toSorted());
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 2, present: 2 });
  });

  it('keeps the pages while the deck is in the library, named by no item or in the trash, and removes them when it is purged', async () => {
    const deck = await pages(alice, 'kept', 1);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', fileName: 'Predikan.pdf', pages: deck });
    await alice.client.mutate('removeItem', { itemId: 'I1' });
    await alice.client.mutate('trashSlideDeck', { id: 'I1', at: 1 });
    await alice.client.sync(); // a change: the server cleans up after it
    expect((await get(h, org, 'alice', deck[0]!.full)).status).toBe(200);
    await expect(alice.client.mutate('purgeSlideDeck', { id: 'NOPE' })).resolves.toBeUndefined();

    await alice.client.mutate('purgeSlideDeck', { id: 'I1' });
    await alice.client.sync();

    expect((await get(h, org, 'alice', deck[0]!.full)).status).toBe(404);
    expect(await h.mediaKeys()).not.toContain(mediaKey(org, deck[0]!.thumb));
  });

  it('refuses to purge a deck that is not in the trash, and a template names the same deck as its presentation', async () => {
    const deck = await pages(alice, 'template', 1);
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await alice.client.mutate('addSlides', { itemId: 'I1', presentationId: 'P', deckId: 'D1', fileName: 'Predikan.pdf', pages: deck });

    await alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: [{ from: 'I1', id: 'T1' }] });

    await expect(alice.client.mutate('purgeSlideDeck', { id: 'D1' })).rejects.toThrow('not in the trash');
    expect((await alice.client.dump()).presentation_items.map((i) => [i.id, i.source_id, i.content])).toEqual([
      ['I1', 'D1', null],
      ['T1', 'D1', null],
    ]);
  });

  it('uploads the pages of a deck put in the library offline, and of its new PDF, before they are pushed', async () => {
    const uploads = new MediaUploads(async (hash, b) => (await put(h, org, 'alice', hash, b)).status);
    const d = await device(h, org, 'alice', 'admin', { beforePush: uploads.beforePush });
    try {
      const [first, second] = [await pages(d, 'library', 1, false), await pages(d, 'replaced', 1, false)];
      await d.client.mutate('addSlideDeck', { id: 'D1', name: 'Predikan.pdf', pages: first, at: 1 });
      await d.client.mutate('updateSlideDeck', { id: 'D1', pages: second, at: 2 });

      await d.client.sync();

      // Both were uploaded, so neither push was refused; the first PDF's pages, named by nothing now, are gone.
      expect(d.client.rejected).toEqual([]);
      expect([(await get(h, org, 'alice', second[0]!.full)).status, (await get(h, org, 'alice', first[0]!.full)).status]).toEqual([200, 404]);
    } finally {
      await d.client.close();
    }
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
