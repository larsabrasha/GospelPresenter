// Which media files a device keeps (spec 05 "Media", MEDIA-R14): what it presents, what is coming up, and what it was
// asked to keep offline, on every server adapter.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_POLICY, hasMediaBlob, presentationMediaState, setPinned, storeMediaBlob, syncMedia, type MediaPolicy } from '@gp/sync/client';
import { device, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { downloader, imageArgs, jpeg, put, uploaded } from './media-fixtures.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

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

  const policy = (over: Partial<MediaPolicy> = {}): MediaPolicy => ({ ...DEFAULT_MEDIA_POLICY, today: '2026-11-01', ...over });

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

  it('fetches only the thumbnails while nothing is presented or kept, whatever is coming', async () => {
    const soon = await presentation('SOON', '2026-11-02', 'soon');
    const undated = await presentation('UNDATED', null, 'undated');
    await bob.client.sync();

    const r = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());

    expect(r.downloaded.toSorted()).toEqual([soon.thumb, undated.thumb].toSorted());
  });

  it('fetches every file of the presentation it presents, at once', async () => {
    const p = await presentation('P', null, 'open');
    await bob.client.sync();
    await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());

    const r = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ presenting: 'P' }));

    expect(r.downloaded.toSorted()).toEqual([p.full, p.sound].toSorted());
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 2, present: 2 });
  });

  it('keeps what presenting fetched afterwards as cache, within the budget', async () => {
    const p = await presentation('P', null, 'cache');
    await bob.client.sync();
    await syncMedia(bob.client, downloader(h, org, 'bob'), 1000, policy({ presenting: 'P' }));

    const after = await syncMedia(bob.client, async () => null, 2000, policy());

    expect(after.removed).toBe(0);
    expect(await hasMediaBlob(bob.client, p.full)).toBe(true);
  });

  it('with "Spara kommande presentationer offline", keeps the coming seven days, not later, not earlier, not on a device that keeps no data', async () => {
    const soon = await presentation('SOON', '2026-11-08', 'soon');
    const later = await presentation('LATER', '2026-11-09', 'later');
    const past = await presentation('PAST', '2026-10-31', 'past');
    await bob.client.sync();
    await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());

    const memoryOnly = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ keepComing: true, persistent: false }));
    const r = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ keepComing: true }));

    expect(memoryOnly.downloaded).toEqual([]);
    expect(r.downloaded.toSorted()).toEqual([soon.full, soon.sound].toSorted());
    expect(await hasMediaBlob(bob.client, later.full)).toBe(false);
    expect(await hasMediaBlob(bob.client, past.full)).toBe(false);
  });

  it('fetches and keeps a presentation kept offline on this device, whatever its date; not on one that keeps no data', async () => {
    const p = await presentation('KEPT', null, 'kept');
    await bob.client.sync();
    await setPinned(bob.client, 'KEPT', true);
    const memoryOnly = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ persistent: false }));
    expect(memoryOnly.downloaded).toEqual([p.thumb]);
    const kept = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());
    expect(kept.downloaded.toSorted()).toEqual([p.full, p.sound].toSorted());
    // Never dropped for the budget while kept; dropped once it is not.
    expect(await syncMedia(bob.client, async () => null, Date.now(), policy({ budget: 1 }))).toMatchObject({ removed: 0 });
    await setPinned(bob.client, 'KEPT', false);
    expect(await syncMedia(bob.client, async () => null, Date.now(), policy({ budget: 1 }))).toMatchObject({ removed: 2 });
    expect(await hasMediaBlob(bob.client, p.thumb)).toBe(true);
  });

  it("a host's own window fetches nothing, and keeps its own import only until it is uploaded", async () => {
    const p = await presentation('HOST', null, 'host'); // alice's import, pushed: its blobs are on the server
    await alice.client.mutate('createPresentation', { id: 'Q', name: 'Q' });
    const waiting = await storeMediaBlob(alice.client, jpeg('waiting'), 'image/jpeg');
    await alice.client.mutate('addImage', imageArgs('WAIT', waiting, waiting)); // not pushed yet
    const host = policy({ persistent: false, fetch: false, budget: 0, presenting: 'HOST' });

    const r = await syncMedia(alice.client, downloader(h, org, 'alice'), Date.now(), host);

    expect(r.downloaded).toEqual([]);
    expect(r.removed).toBe(3);
    for (const hash of [p.full, p.thumb, p.sound]) expect(await hasMediaBlob(alice.client, hash)).toBe(false);
    expect(await hasMediaBlob(alice.client, waiting)).toBe(true);
  });

  it("fetches every overlay's picture when it presents, and counts it as needed for live", async () => {
    const p = await presentation('P', null, 'with-overlay');
    const o = await uploaded(h, org, alice, 'overlay');
    await alice.client.mutate('addImage', imageArgs('OVL-IMG', o.fullHash, o.thumbHash));
    await alice.client.mutate('createOverlay', { id: 'O', title: 'Kollekt', imageId: 'OVL-IMG' });
    await alice.client.sync();
    expect(alice.client.rejected).toEqual([]);
    await bob.client.sync();
    const nothing = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy());
    expect(nothing.downloaded.toSorted()).toEqual([p.thumb, o.thumbHash].toSorted());
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 3, present: 0 });
    const presenting = await syncMedia(bob.client, downloader(h, org, 'bob'), Date.now(), policy({ presenting: 'P' }));
    expect(presenting.downloaded).toEqual([o.fullHash, p.full, p.sound]);
    expect(await presentationMediaState(bob.client, 'P')).toEqual({ needed: 3, present: 3 });
  });

  it('keeps the cache only within the budget, oldest out first; never what is presented now', async () => {
    const a = await presentation('A', null, 'budget-a');
    const b = await presentation('B', null, 'budget-b');
    await bob.client.sync();
    // Both were presented once, so both are on the device.
    await syncMedia(bob.client, downloader(h, org, 'bob'), 1000, policy({ presenting: 'A' }));
    await syncMedia(bob.client, downloader(h, org, 'bob'), 2000, policy({ presenting: 'B' }));
    // B is presented now; a budget of one byte leaves room for nothing else, so A's files (the older) go, not B's or the thumbnails.
    const r = await syncMedia(bob.client, async () => null, 3000, policy({ budget: 1, presenting: 'B' }));
    expect(r.removed).toBe(2);
    expect(await hasMediaBlob(bob.client, a.full)).toBe(false);
    expect(await hasMediaBlob(bob.client, a.sound)).toBe(false);
    expect(await hasMediaBlob(bob.client, a.thumb)).toBe(true);
    expect(await hasMediaBlob(bob.client, b.full)).toBe(true);
    expect(await hasMediaBlob(bob.client, b.sound)).toBe(true);
  });
});
