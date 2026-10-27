// Public outputs against every server adapter (spec 04 §6, §7): an admin
// makes one, the owner of a session sends to it, and anyone with the code
// follows over SSE, anonymously, seeing only what is on screen.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256HexBytes, type PublicSlide, type WatchEvent } from '@gp/core';
import { storeMediaBlob } from '@gp/sync/client';
import { device, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** An anonymous viewer's stream, keeping every event it got. */
class Viewer {
  events: WatchEvent[] = [];
  ended = false;
  private constructor(
    readonly status: number,
    private abort: AbortController,
  ) {}

  static async open(h: Harness, code: string, viewerId = randomViewer()): Promise<Viewer> {
    const abort = new AbortController();
    const res = await fetch(`${h.url}/api/watch/${code}/stream?v=${viewerId}`, { signal: abort.signal });
    const v = new Viewer(res.status, abort);
    if (res.status !== 200) return v;
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    void (async () => {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let at: number;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const data = block.split('\n').find((l) => l.startsWith('data:'));
            if (data) v.events.push(JSON.parse(data.slice(5).trim()) as WatchEvent);
          }
        }
      } catch {
        // aborted
      }
      v.ended = true;
    })();
    return v;
  }

  async next(match: (e: WatchEvent) => boolean, from = 0): Promise<WatchEvent> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const found = this.events.slice(from).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no matching event; got ${JSON.stringify(this.events)}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  last(): WatchEvent | undefined {
    return this.events.filter((e) => e.type !== 'meta').at(-1);
  }

  async waitEnded() {
    const deadline = Date.now() + 5000;
    while (!this.ended) {
      if (Date.now() > deadline) throw new Error('the stream did not end');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  close() {
    this.abort.abort();
  }
}

const randomViewer = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

const slide = (text: string, over: Partial<PublicSlide> = {}): PublicSlide => ({ kind: 'song', text, verses: null, image: null, credits: 'Anna', themeId: 'midnight', ...over });

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

  it('serves a picture only while it is on the output (LIVE-R32, MEDIA-R10)', async () => {
    await output('D1', 'defghjk');
    const bytes = new Uint8Array(200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    bytes[100] = 42;
    const hash = await storeMediaBlob(admin.client, bytes, 'image/jpeg');
    const put = await fetch(`${h.url}/api/media/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${tokenOf(h, org, 'anna')}` }, body: bytes });
    expect(put.status).toBe(204);
    const image = () => fetch(`${h.url}/api/watch/defghjk/image/${hash}`);
    expect((await image()).status).toBe(404); // not on screen
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: slide('', { kind: 'media', image: hash }) }) });
    await owner.sessions((x) => x[0]?.outputs.length === 1);
    const shown = await image();
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(bytes);
    // Another picture of the organisation is not reachable through the output.
    const other = new Uint8Array(bytes);
    other[101] = 7;
    const otherHash = await sha256HexBytes(other);
    expect((await fetch(`${h.url}/api/watch/defghjk/image/${otherHash}`)).status).toBe(404);
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['D1'], slide: null }) });
    await new Promise((r) => setTimeout(r, 200));
    expect((await image()).status).toBe(404);
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
