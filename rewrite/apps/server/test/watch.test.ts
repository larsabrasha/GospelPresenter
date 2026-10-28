// Public outputs against every server adapter (spec 04 §6, §7): an admin
// makes one, the owner of a session sends to it, and anyone with the code
// follows over SSE, anonymously, seeing only what is on screen.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISPLAY_CODE_ALPHABET, type PublicSlide } from '@gp/core';
import { randomViewer, Viewer } from './sse-viewer.ts';
import { storeMediaBlob } from '@gp/sync/client';
import { device, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const slide = (text: string, over: Partial<PublicSlide> = {}): PublicSlide => ({ kind: 'song', text, verses: null, image: null, credits: 'Anna', themeId: 'midnight', overlay: null, ...over });

describe.each(adapters)('%s adapter: public outputs', (adapterName) => {
  let h: Harness;
  let org: string;
  let admin: Device;
  const open: { close(): void }[] = [];
  const track = <T extends { close(): void }>(x: T) => (open.push(x), x);

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);
  afterAll(async () => {
    for (const x of open.splice(0)) x.close();
    await admin?.client.close();
    await h?.close();
  });
  beforeEach(async () => {
    for (const x of open.splice(0)) x.close();
    await admin?.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    await setRole(h, 'bo', org, 'user');
    admin = await device(h, org, 'anna', 'admin');
  });

  /** An admin makes a public output; the push registers its code. */
  async function output(id: string, code: string, name = 'Kyrkkaffet') {
    await admin.client.mutate('createDisplay', { id, name, code, kind: 'public' });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
  }

  it('an unknown code is 404, a missing viewer id 400; a new output shows its name and the waiting screen (LIVE-R35, R14)', async () => {
    expect((await Viewer.open(h, 'zzzzzzz')).status).toBe(404);
    await output('D1', 'abcdefg');
    expect((await fetch(`${h.url}/api/watch/abcdefg/stream`)).status).toBe(400);
    const v = track(await Viewer.open(h, 'abcdefg'));
    expect(v.status).toBe(200);
    await v.next((e) => e.type === 'idle');
    expect(v.events[0]).toEqual({ type: 'meta', orgName: expect.any(String), outputName: 'Kyrkkaffet' });
  });

  it('follows what the owner shows while it sends to the output; black is the waiting screen; ending is too', async () => {
    await output('D1', 'bcdefgh');
    const v = track(await Viewer.open(h, 'bcdefgh'));
    await v.next((e) => e.type === 'idle');
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('Härlig är jorden') }) });
    expect(await v.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });
    // The viewer is counted where the operators see it.
    const [s] = await owner.sessions((x) => x[0]?.outputs[0]?.viewers === 1);
    expect(s!.outputs).toEqual([{ id: 'D1', viewers: 1 }]);

    const n = v.events.length;
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: null }) });
    await v.next((e) => e.type === 'idle', n);
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('Pilgrimsfärd') }) });
    await v.next((e) => e.type === 'slide' && e.slide.text === 'Pilgrimsfärd', n);

    // The owner drops out: the session freezes and the viewers keep what they had (LIVE-R50).
    const bo = track(await Window.open(h, org, 'bo'));
    owner.close();
    await bo.sessions((x) => x[0]?.ownerOnline === false);
    expect(v.last()).toMatchObject({ type: 'slide', slide: { text: 'Pilgrimsfärd' } });
    // Ended: the waiting screen.
    bo.send({ type: 'end', sessionId: 'S1' });
    await v.next((e) => e.type === 'idle', v.events.length - 1);
    expect(v.last()).toEqual({ type: 'idle' });
  });

  it('one session per output: another must take it over (LIVE-R23)', async () => {
    await output('D1', 'cdefghj');
    const first = track(await Window.open(h, org, 'anna'));
    const second = track(await Window.open(h, org, 'bo'));
    first.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('Ett') }) });
    await second.sessions((x) => x.some((s) => s.outputs.length === 1));
    second.send({ type: 'own', state: ownState('S2', { outputs: ['D1'], slide: slide('Två') }) });
    expect(await second.error()).toBe('output-taken');
    const v = track(await Viewer.open(h, 'cdefghj'));
    await v.next((e) => e.type === 'slide' && e.slide.text === 'Ett');

    second.send({ type: 'own', state: ownState('S2', { outputs: ['D1'], takeOver: ['D1'], slide: slide('Två') }) });
    await v.next((e) => e.type === 'slide' && e.slide.text === 'Två');
    const sessions = await first.sessions((x) => x.find((s) => s.id === 'S2')?.outputs.length === 1);
    expect(sessions.find((s) => s.id === 'S1')!.outputs).toEqual([]);
  });

  /** A JPEG-looking blob, uploaded and recorded on the admin's device; returns its hash. */
  async function blob(seed: number): Promise<{ hash: string; bytes: Uint8Array }> {
    const bytes = new Uint8Array(200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    bytes[100] = seed;
    const hash = await storeMediaBlob(admin.client, bytes, 'image/jpeg');
    const put = await fetch(`${h.url}/api/media/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${tokenOf(h, org, 'anna')}` }, body: bytes });
    expect(put.status).toBe(204);
    return { hash, bytes };
  }

  /** A picture in the library; in presentation P too when `inP`. */
  async function picture(id: string, seed: number, inP: boolean) {
    const full = await blob(seed);
    const thumb = await blob(seed + 100);
    await admin.client.mutate('addImage', { id, fileName: `${id}.jpg`, contentType: 'image/jpeg', fullHash: full.hash, thumbHash: thumb.hash, width: 10, height: 10, createdAt: 1 });
    if (inP) await admin.client.mutate('addImageToPresentation', { itemId: `item-${id}`, presentationId: 'P', imageId: id });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    return full;
  }

  it('serves a picture only while it is on the output, and only one of the shown presentation (LIVE-R32, MEDIA-R10)', async () => {
    await output('D1', 'defghjk');
    await admin.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    const shownPicture = await picture('IN', 42, true);
    const libraryOnly = await picture('OUT', 43, false);
    const image = (hash: string) => fetch(`${h.url}/api/watch/defghjk/image/${hash}`);
    expect((await image(shownPicture.hash)).status).toBe(404); // not on screen
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('', { kind: 'media', image: shownPicture.hash }) }) });
    await owner.sessions((x) => x[0]?.outputs.length === 1);
    const shown = await image(shownPicture.hash);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toBe('image/jpeg');
    expect(shown.headers.get('cache-control')).toBe('private, max-age=3600'); // never in a shared cache
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(shownPicture.bytes);
    // Another picture of the organisation is not reachable through the output.
    expect((await image(libraryOnly.hash)).status).toBe(404);
    // Not even when a report names it: it is in no item of the presentation the session shows.
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('', { kind: 'media', image: libraryOnly.hash }) }) });
    await owner.sessions((x) => x[0]?.pointer.rev === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect((await image(libraryOnly.hash)).status).toBe(404);
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: null }) });
    await new Promise((r) => setTimeout(r, 200));
    expect((await image(shownPicture.hash)).status).toBe(404);
  });

  it('serves a page of a slide deck in the shown presentation while it is on the output (D29)', async () => {
    await output('D1', 'hjkmnpq');
    await admin.client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    const page = await blob(44);
    const thumb = await blob(144);
    await admin.client.mutate('addSlides', { itemId: 'deck', presentationId: 'P', fileName: 'Predikan.pdf', pages: [{ full: page.hash, thumb: thumb.hash }] });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    const owner = track(await Window.open(h, org, 'anna'));

    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('', { kind: 'media', image: page.hash }) }) });
    await owner.sessions((x) => x[0]?.outputs.length === 1);

    const shown = await fetch(`${h.url}/api/watch/hjkmnpq/image/${page.hash}`);
    expect(shown.status).toBe(200);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(page.bytes);
  });

  it('a new code disconnects the viewers and the old code stops working; so does deleting (spec 04 §7)', async () => {
    await output('D1', 'efghjkm');
    const v = track(await Viewer.open(h, 'efghjkm'));
    await v.next((e) => e.type === 'idle');
    await admin.client.mutate('newDisplayCode', { id: 'D1', code: 'fghjkmn' });
    await admin.client.sync();
    await v.waitEnded();
    expect((await Viewer.open(h, 'efghjkm')).status).toBe(404);
    const again = track(await Viewer.open(h, 'fghjkmn'));
    await again.next((e) => e.type === 'idle');
    await admin.client.mutate('deleteDisplay', { id: 'D1' });
    await admin.client.sync();
    await again.waitEnded();
    expect((await Viewer.open(h, 'fghjkmn')).status).toBe(404);
  });

  it('a reconnecting viewer replaces its old stream and is counted once (LIVE-R36)', async () => {
    await output('D1', 'ghjkmnp');
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('Ett') }) });
    const id = randomViewer();
    const first = track(await Viewer.open(h, 'ghjkmnp', id));
    await first.next((e) => e.type === 'slide');
    const second = track(await Viewer.open(h, 'ghjkmnp', id));
    await second.next((e) => e.type === 'slide');
    await first.waitEnded();
    const [s] = await owner.sessions((x) => x[0]?.outputs[0]?.viewers === 1);
    expect(s!.outputs[0]!.viewers).toBe(1);
  });

  it('only an admin makes, renews or deletes an output (LIVE-R30)', async () => {
    const bo = await device(h, org, 'bo', 'user');
    try {
      await expect(bo.client.mutate('createDisplay', { id: 'D9', name: 'X', code: 'hjkmnpq', kind: 'public' })).rejects.toThrow(/may not ManageRemoteDisplays/);
    } finally {
      await bo.client.close();
    }
  });
});

describe('the global index of codes', () => {
  it('a push that saved an output but failed to register its code registers it when the client sends it again', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { startNodeServer, openSqlite } = await import('@gp/server/node');
    const dataDir = mkdtempSync(join(tmpdir(), 'gp-watch-'));
    const s = await startNodeServer({ dataDir, debug: true, log: () => undefined });
    const h: Harness = { name: 'node', url: s.url, mediaKeys: async () => [], close: () => s.close() };
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    const d = await device(h, org, 'anna', 'admin');
    try {
      // The global index fails while the push runs (as a D1 error would).
      const global = openSqlite(join(dataDir, 'global.sqlite'), 'better-sqlite3');
      global.exec('ALTER TABLE watch_codes RENAME TO watch_codes_away');
      await d.client.mutate('createDisplay', { id: 'D1', name: 'Kyrkkaffet', code: 'jkmnpqr', kind: 'public' });
      await expect(d.client.sync()).rejects.toThrow();
      global.exec('ALTER TABLE watch_codes_away RENAME TO watch_codes');
      global.close();
      expect((await fetch(`${h.url}/api/watch/jkmnpqr/exists`)).status).toBe(404);
      // The output itself was saved; the same push again registers its code.
      await d.client.sync();
      expect(d.client.rejected).toEqual([]);
      expect((await fetch(`${h.url}/api/watch/jkmnpqr/exists`)).status).toBe(200);
    } finally {
      await d.client.close();
      await h.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe.each(adapters)('%s adapter: guessing codes', (adapterName) => {
  // A server of its own: the address this test locks is the one every other test uses.
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('20 unknown codes from one address, and the next request from it is refused for 15 minutes, a real code included', async () => {
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    const admin = await device(h, org, 'anna', 'admin');
    try {
      await admin.client.mutate('createDisplay', { id: 'D1', name: 'Kyrkkaffet', code: 'qrstuvw', kind: 'public' });
      await admin.client.sync();
      expect((await fetch(`${h.url}/api/watch/qrstuvw/exists`)).status).toBe(200); // a real code does not count
      for (let i = 0; i < 20; i++) {
        const code = `zzzzz${DISPLAY_CODE_ALPHABET[i]}${DISPLAY_CODE_ALPHABET[i]}`; // 20 codes nobody has
        expect((await fetch(`${h.url}/api/watch/${code}/exists`)).status).toBe(404);
      }
      const locked = await fetch(`${h.url}/api/watch/qrstuvw/exists`);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(800);
      expect((await fetch(`${h.url}/api/watch/qrstuvw/stream?v=0123456789abcdef`)).status).toBe(429);
    } finally {
      await admin.client.close();
    }
  });
});
