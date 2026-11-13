// A library picture edited and taken back to its original (MEDIA-R19), against every server adapter: the first edit
// keeps the original, a later one replaces the edit and keeps the same original, going back restores it, and the
// blobs no picture names any more go.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { storeMediaBlob } from '@gp/sync/client';
import { device, serverDump, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { get, imageArgs, jpeg, put, uploaded } from './media-fixtures.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const EDIT = { straighten: 2, rotate: 90 as const, flip: false, crop: { x: 0, y: 0.125, w: 1, h: 0.75 } };

describe.each(adapters)('%s adapter: editing a picture', (adapterName) => {
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
  });

  /** An edited picture's blobs, uploaded as an import's are. */
  async function editedBlobs(seed: string) {
    const full = jpeg(`${seed}-full`);
    const thumb = jpeg(`${seed}-thumb`, 100);
    const fullHash = await storeMediaBlob(alice.client, full, 'image/jpeg');
    const thumbHash = await storeMediaBlob(alice.client, thumb, 'image/jpeg');
    expect((await put(h, org, 'alice', fullHash, full)).status).toBe(204);
    expect((await put(h, org, 'alice', thumbHash, thumb)).status).toBe(204);
    return { fullHash, thumbHash };
  }

  it('keeps the original at the first edit, shows the edit everywhere, and keeps the same original at the next', async () => {
    const original = await uploaded(h, org, alice, 'photo');
    await alice.client.mutate('addImage', imageArgs('PIC', original.fullHash, original.thumbHash));
    const first = await editedBlobs('first');
    await alice.client.mutate('editImage', { id: 'PIC', ...first, width: 810, height: 1080, edit: EDIT });
    await alice.client.sync();
    await bob.client.sync();
    expect(alice.client.rejected).toEqual([]);
    expect((await bob.client.dump()).images).toMatchObject([
      { id: 'PIC', full_hash: first.fullHash, width: 810, height: 1080, original_full_hash: original.fullHash, original_thumb_hash: original.thumbHash, original_width: 1440, original_height: 1080 },
    ]);
    expect(JSON.parse(String((await bob.client.dump()).images[0]?.edit))).toEqual(EDIT);

    // A second edit is made from the original again: the original stays, the first edit's blobs go.
    const second = await editedBlobs('second');
    await alice.client.mutate('editImage', { id: 'PIC', ...second, width: 1440, height: 810, edit: { ...EDIT, rotate: 0 as const } });
    await alice.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.images).toMatchObject([{ full_hash: second.fullHash, original_full_hash: original.fullHash }]);
    expect((await get(h, org, 'alice', first.fullHash)).status).toBe(404);
    expect((await get(h, org, 'alice', original.fullHash)).status).toBe(200);
  });

  it('goes back to the original however long ago it was edited, and lets the edit go', async () => {
    const original = await uploaded(h, org, alice, 'back');
    await alice.client.mutate('addImage', imageArgs('PIC', original.fullHash, original.thumbHash));
    const edited = await editedBlobs('edited');
    await alice.client.mutate('editImage', { id: 'PIC', ...edited, width: 810, height: 1080, edit: EDIT });
    await alice.client.sync();

    await bob.client.sync();
    await bob.client.mutate('revertImage', { id: 'PIC' });
    await bob.client.sync();
    expect((await serverDump(h, org, 'alice')).tables.images).toMatchObject([
      { full_hash: original.fullHash, thumb_hash: original.thumbHash, width: 1440, height: 1080, original_full_hash: null, edit: null },
    ]);
    expect((await get(h, org, 'alice', edited.fullHash)).status).toBe(404);
    // Again is nothing: it is the original.
    await bob.client.mutate('revertImage', { id: 'PIC' });
    await bob.client.sync();
    expect(bob.client.rejected).toEqual([]);
  });

  it('refuses an edit whose blobs were not uploaded', async () => {
    const original = await uploaded(h, org, alice, 'refused');
    await alice.client.mutate('addImage', imageArgs('PIC', original.fullHash, original.thumbHash));
    await alice.client.sync();
    await expect(alice.client.mutate('editImage', { id: 'PIC', fullHash: 'a'.repeat(64), thumbHash: 'b'.repeat(64), width: 10, height: 10, edit: EDIT })).rejects.toThrow('not been uploaded');
  });
});
