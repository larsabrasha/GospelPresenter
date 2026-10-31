// Paired screens against every server adapter (spec 04 §5, §8; LIVE-R24,
// R28): a TV shows a code, an operator pairs it by the code or a QR token, and
// it follows the session like a public output until it is let go; a saved
// screen is online while its page is open.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { storeMediaBlob } from '@gp/sync/client';
import type { Canvas, LiveServerMessage, PublicSlide } from '@gp/core';
import { api, device, setRole, startAdapter, tokenOf, type AdapterName, type Device, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';
import { Viewer } from './sse-viewer.ts';
import { SCREEN_GRACE_MS } from '../src/live-hub.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const slide = (text: string): PublicSlide => ({ kind: 'song', text, verses: null, image: null, credits: null, themeId: 'classic', overlay: null });
/** What a screen draws for `text` (spec 04 §5): the projector's canvas. */
const canvas = (text: string, over: Partial<Canvas> = {}): Canvas => ({ slide: { kind: 'song', text, verses: null, image: null, credits: 'Anna' }, themeId: 'midnight', overlay: null, ...over });
type Sessions = Extract<LiveServerMessage, { type: 'sessions' }>;
const isSessions = (m: LiveServerMessage): m is Sessions => m.type === 'sessions';
type Start = { id: string; pin?: string; expiresAt?: number; paired?: true };

/** Waits until the newest sessions list a window got, so far or later, satisfies `match`. */
async function latest(w: Window, match: (m: Sessions) => boolean, timeoutMs = 5000): Promise<Sessions> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const m = w.messages.filter(isSessions).at(-1);
    if (m && match(m)) return m;
    if (Date.now() > deadline) throw new Error(`no matching sessions list; last ${JSON.stringify(m)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe.each(adapters)('%s adapter: paired screens', (adapterName) => {
  let h: Harness;
  let org: string;
  let admin: Device;
  const open: { close(): void }[] = [];
  const track = <T extends { close(): void }>(x: T) => (open.push(x), x);
  const tv = (body: object = {}) => api<Start>(h, 'POST', '/api/screen', { body });
  const claim = (pin: string, sessionId = 'S1') => api<{ screen?: { id: string; n: number }; error?: string }>(h, 'POST', '/api/live/screens/claim', { user: 'anna', org, body: { pin, sessionId } });

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
    admin = await device(h, org, 'anna', 'admin');
  });

  it('a TV gets a four-digit code, the same one again for its id; the operator types it and the TV follows the session (LIVE-A17)', async () => {
    const first = await tv();
    expect(first.status).toBe(200);
    expect(first.body.pin).toMatch(/^\d{4}$/);
    expect(Number(first.body.pin)).toBeGreaterThanOrEqual(1000);
    expect(first.body.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await tv({ id: first.body.id })).body).toEqual(first.body);
    // Not paired yet: there is no stream for it.
    expect((await Viewer.open(h, first.body.id, undefined, 'screen')).status).toBe(404);

    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    expect(await claim(first.body.pin === '1000' ? '1001' : '1000')).toMatchObject({ status: 400, body: { error: 'pin-invalid' } });
    const paired = await claim(first.body.pin!);
    expect(paired).toEqual({ status: 200, body: { screen: { id: first.body.id, n: 1 } } });
    expect((await claim(first.body.pin!)).body).toEqual({ error: 'pin-invalid' }); // single use
    const listed = await latest(owner, (m) => m.screens.length === 1);
    expect(listed.screens).toEqual([{ id: first.body.id, n: 1 }]);
    expect((await tv({ id: first.body.id })).body).toEqual({ id: first.body.id, paired: true });

    const screen = track(await Viewer.open(h, first.body.id, undefined, 'screen'));
    expect(screen.status).toBe(200);
    await screen.next((e) => e.type === 'idle');
    owner.send({ type: 'own', state: ownState('S1', { outputs: [first.body.id], slide: slide('Härlig är jorden'), canvas: canvas('Härlig är jorden') }) });
    expect(await screen.next((e) => e.type === 'canvas')).toEqual({ type: 'canvas', now: expect.any(Number), canvas: canvas('Härlig är jorden') });
    await latest(owner, (m) => m.online.includes(first.body.id) && m.sessions[0]?.outputs[0]?.id === first.body.id);

    // ✕: the session lets it go; the TV is told, and starts again with a new code.
    owner.send({ type: 'own', state: ownState('S1', { outputs: [], slide: null }) });
    await screen.next((e) => e.type === 'unpaired');
    await screen.waitEnded();
    await latest(owner, (m) => m.screens.length === 0);
    const again = await tv({ id: first.body.id });
    expect(again.body.pin).toMatch(/^\d{4}$/);
    expect(again.body.id).not.toBe(first.body.id);
    expect((await Viewer.open(h, first.body.id, undefined, 'screen')).status).toBe(404);
  });

  it('pairs by QR token once; the dialog learns which screen used it (LIVE-A18)', async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const { body: made } = await api<{ token: string; expiresAt: number }>(h, 'POST', '/api/live/screens/token', { user: 'anna', org });
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const status = () => api<{ screen: { id: string; n: number } | null }>(h, 'GET', `/api/live/screens/token/${made.token}?session=S1`, { user: 'anna', org });
    expect((await status()).body).toEqual({ screen: null });

    const used = await tv({ token: made.token });
    expect(used.body).toEqual({ id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), paired: true });
    expect((await tv({ token: made.token })).body).toEqual({ error: 'token-invalid' }); // single use
    expect((await status()).body).toEqual({ screen: { id: used.body.id, n: 1 } });
    expect((await status()).body).toEqual({ screen: null }); // told once; the token is gone
    const screen = track(await Viewer.open(h, used.body.id, undefined, 'screen'));
    await screen.next((e) => e.type === 'idle');

    // Ending the session lets its screens go (LIVE-R24).
    owner.send({ type: 'end', sessionId: 'S1' });
    await screen.next((e) => e.type === 'unpaired');
  });

  it('a closed dialog drops its token; another organisation cannot learn about a token; pairing needs a live session and a signed-in member', async () => {
    const { body: made } = await api<{ token: string }>(h, 'POST', '/api/live/screens/token', { user: 'anna', org });
    await api(h, 'DELETE', `/api/live/screens/token/${made.token}`, { user: 'anna', org });
    expect((await tv({ token: made.token })).body).toEqual({ error: 'token-invalid' });

    const other = `org-${crypto.randomUUID()}`;
    await setRole(h, 'carol', other, 'admin');
    const { body: mine } = await api<{ token: string }>(h, 'POST', '/api/live/screens/token', { user: 'anna', org });
    await tv({ token: mine.token });
    expect((await api(h, 'GET', `/api/live/screens/token/${mine.token}?session=S1`, { user: 'carol', org: other })).body).toEqual({ screen: null });

    const { body: start } = await tv();
    expect((await claim(start.pin!, 'S9')).body).toEqual({ error: 'not-live' });
    expect((await api(h, 'POST', '/api/live/screens/token', {})).status).toBe(401);
  });

  it('a dialog that closes or renews after a TV used its token, before it asked, takes that screen in; a display edit meanwhile keeps its stream', async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const { body: made } = await api<{ token: string }>(h, 'POST', '/api/live/screens/token', { user: 'anna', org });
    const used = await tv({ token: made.token });
    const screen = track(await Viewer.open(h, used.body.id, undefined, 'screen'));
    await screen.next((e) => e.type === 'idle');
    // Not in live_screens yet, and no displays row: an edit to the outputs leaves its stream alone.
    await admin.client.mutate('createDisplay', { id: 'D9', name: 'Kyrkkaffet', code: 'bcdefgh', kind: 'public' });
    await admin.client.sync();
    const dropped = await api<{ screen: { id: string; n: number } | null }>(h, 'DELETE', `/api/live/screens/token/${made.token}?session=S1`, { user: 'anna', org });
    expect(dropped.body).toEqual({ screen: { id: used.body.id, n: 1 } });
    owner.send({ type: 'own', state: ownState('S1', { outputs: [used.body.id], slide: slide('Härlig är jorden'), canvas: canvas('Härlig är jorden') }) });
    expect(await screen.next((e) => e.type === 'canvas')).toEqual({ type: 'canvas', now: expect.any(Number), canvas: canvas('Härlig är jorden') });
    expect(screen.ended).toBe(false);

    // Without a live session to take it in, the TV starts again.
    const { body: other } = await api<{ token: string }>(h, 'POST', '/api/live/screens/token', { user: 'anna', org });
    const lost = await tv({ token: other.token });
    const lostScreen = track(await Viewer.open(h, lost.body.id, undefined, 'screen'));
    await lostScreen.next((e) => e.type === 'idle');
    expect((await api(h, 'DELETE', `/api/live/screens/token/${other.token}?session=S9`, { user: 'anna', org })).body).toEqual({ screen: null });
    await lostScreen.next((e) => e.type === 'unpaired');
  });

  it("pairs only for the caller's own session", async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    await setRole(h, 'bert', org, 'admin');
    const { body: start } = await tv();
    const r = await api<{ error?: string }>(h, 'POST', '/api/live/screens/claim', { user: 'bert', org, body: { pin: start.pin, sessionId: 'S1' } });
    expect(r.body).toEqual({ error: 'not-live' });
  });

  it('a saved screen is online while its page is open, can be switched on only then, and goes off when the page closes (LIVE-A20, A21)', async () => {
    await admin.client.mutate('createDisplay', { id: 'K1', name: 'Kyrksal', code: 'kyrksam', kind: 'screen' });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    // A screen's code is no public output, and the other way round.
    expect((await Viewer.open(h, 'kyrksam')).status).toBe(404);
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['K1'], slide: slide('Före') }) });
    await owner.sessions((s) => s.length === 1 && s[0]!.outputs.length === 0); // offline: not bound

    const page = track(await Viewer.open(h, 'kyrksam', undefined, 'display'));
    expect(page.status).toBe(200);
    expect(page.events[0] ?? (await page.next((e) => e.type === 'meta'))).toEqual({ type: 'meta', orgName: expect.any(String), outputName: 'Kyrksal' });
    await latest(owner, (m) => m.online.includes('K1'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['K1'], slide: slide('Härlig är jorden'), canvas: canvas('Härlig är jorden') }) });
    expect(await page.next((e) => e.type === 'canvas')).toEqual({ type: 'canvas', now: expect.any(Number), canvas: canvas('Härlig är jorden') });

    // Not in local workerd: there a closed stream is never noticed, not even when a ping is written (docs/not-done-yet.md).
    if (adapterName === 'workers') return;
    // A blink: the stream drops and the TV comes back within SCREEN_GRACE_MS, still switched on.
    page.close();
    const back = track(await Viewer.open(h, 'kyrksam', undefined, 'display'));
    expect(await back.next((e) => e.type === 'canvas')).toEqual({ type: 'canvas', now: expect.any(Number), canvas: canvas('Härlig är jorden') });
    await latest(owner, (m) => m.online.includes('K1') && m.sessions[0]?.outputs[0]?.id === 'K1');

    // Closed for good: still online through the grace, then off.
    const closedAt = Date.now();
    back.close();
    await latest(owner, (m) => !m.online.includes('K1') && m.sessions[0]?.outputs.length === 0, SCREEN_GRACE_MS + 5000);
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(SCREEN_GRACE_MS - 500);
  }, SCREEN_GRACE_MS + 15_000);

  // ------------------------------------------------------------ what a screen draws (spec 04 §5: as /live)

  /** A paired temporary screen of session S1, which `owner` presents; returns its id. */
  async function pairedScreen(owner: Window): Promise<string> {
    const { body: start } = await tv();
    expect((await claim(start.pin!)).status).toBe(200);
    await latest(owner, (m) => m.screens.length === 1);
    return start.id;
  }

  /** A public output, D1, at `code`. */
  async function publicOutput(code: string) {
    await admin.client.mutate('createDisplay', { id: 'D1', name: 'Kyrkkaffet', code, kind: 'public' });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
  }

  /** A JPEG-looking picture in the library, its blob uploaded; returns the image id and its full blob's hash. */
  async function picture(id: string, seed: number): Promise<string> {
    const bytes = new Uint8Array(200);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    bytes[100] = seed;
    const hash = await storeMediaBlob(admin.client, bytes, 'image/jpeg');
    const put = await fetch(`${h.url}/api/media/${hash}`, { method: 'PUT', headers: { authorization: `Bearer ${tokenOf(h, org, 'anna')}` }, body: bytes });
    expect(put.status).toBe(204);
    await admin.client.mutate('addImage', { id, fileName: `${id}.jpg`, contentType: 'image/jpeg', fullHash: hash, thumbHash: hash, width: 10, height: 10, createdAt: 1 });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    return hash;
  }

  it('a screen gets the canvas while a public output of the same session gets only the public slide', async () => {
    await publicOutput('pqrstuv');
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const screen = track(await Viewer.open(h, id, undefined, 'screen'));
    const viewer = track(await Viewer.open(h, 'pqrstuv'));
    const shown = canvas('Härlig är jorden', { overlay: { text: 'Välkommen', image: 'a'.repeat(64) } });

    owner.send({ type: 'own', state: ownState('S1', { outputs: [id, 'D1'], slide: slide('Härlig är jorden'), canvas: shown }) });

    expect(await screen.next((e) => e.type === 'canvas')).toEqual({ type: 'canvas', now: expect.any(Number), canvas: shown });
    expect(await viewer.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });
    expect(viewer.events.some((e) => e.type === 'canvas')).toBe(false);
  });

  it("a screen draws an older owner's public slide when the report has no canvas", async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const screen = track(await Viewer.open(h, id, undefined, 'screen'));

    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: { ...slide('Före'), overlay: 'Välkommen' }, canvas: null }) });

    const e = await screen.next((x) => x.type === 'canvas');
    expect(e).toEqual({ type: 'canvas', now: expect.any(Number), canvas: { slide: { kind: 'song', text: 'Före', verses: null, image: null, credits: null }, themeId: 'classic', overlay: { text: 'Välkommen', image: null } } });
  });

  it('a bound screen draws black when the session is black, rather than waiting', async () => {
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const screen = track(await Viewer.open(h, id, undefined, 'screen'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: slide('Före'), canvas: canvas('Före') }) });
    await screen.next((e) => e.type === 'canvas');
    const from = screen.events.length;

    owner.send({ type: 'own', state: ownState('S1', { outputs: [id], slide: null, canvas: null }) });

    expect(await screen.next((e) => e.type === 'canvas' || e.type === 'idle', from)).toEqual({ type: 'canvas', now: expect.any(Number), canvas: null });
  });

  it('a saved screen draws black when its session ends, and waits with its name when it is switched off (Display.razor)', async () => {
    await admin.client.mutate('createDisplay', { id: 'K2', name: 'Foajé', code: 'fajesky', kind: 'screen' });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const page = track(await Viewer.open(h, 'fajesky', undefined, 'display'));
    expect(page.status).toBe(200);
    await latest(owner, (m) => m.online.includes('K2'));
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['K2'], slide: slide('Före'), canvas: canvas('Före') }) });
    await page.next((e) => e.type === 'canvas' && e.canvas !== null);
    owner.send({ type: 'own', state: ownState('S1', { outputs: [], slide: slide('Före'), canvas: canvas('Före') }) });
    await page.next((e) => e.type === 'idle');
    const off = page.events.length;
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['K2'], slide: slide('Före'), canvas: canvas('Före') }) });
    await page.next((e) => e.type === 'canvas' && e.canvas !== null, off);
    const from = page.events.length;

    owner.send({ type: 'end', sessionId: 'S1' });

    expect(await page.next((e) => e.type === 'canvas' || e.type === 'idle', from)).toEqual({ type: 'canvas', now: expect.any(Number), canvas: null });
  });

  it("serves the overlay's picture to a screen only while that overlay is switched on, and never to a public output (LIVE-R34)", async () => {
    await publicOutput('qrstuvw');
    const shownHash = await picture('IMG1', 51);
    await admin.client.mutate('createOverlay', { id: 'O1', title: 'Välkommen', imageId: 'IMG1' });
    await admin.client.sync();
    expect(admin.client.rejected).toEqual([]);
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const fromScreen = (hash: string) => fetch(`${h.url}/api/screen/${id}/image/${hash}`).then((r) => r.status);
    const fromPublic = (hash: string) => fetch(`${h.url}/api/watch/qrstuvw/image/${hash}`).then((r) => r.status);
    const on = { itemId: 'I1', partIndex: 0, black: false, overlayId: 'O1', rev: 2 };

    owner.send({ type: 'own', state: ownState('S1', { pointer: on, outputs: [id, 'D1'], slide: slide('A'), canvas: canvas('A', { overlay: { text: null, image: shownHash } }) }) });
    await owner.sessions((s) => s[0]?.pointer.rev === 2 && s[0].outputs.length === 2);

    expect(await fromScreen(shownHash)).toBe(200);
    expect(await fromPublic(shownHash)).toBe(404);
  });

  it("refuses a picture a screen's canvas names when it is not the switched-on overlay's", async () => {
    const otherHash = await picture('IMG3', 53);
    await admin.client.mutate('createOverlay', { id: 'O2', title: 'Text', content: 'Hej' });
    await admin.client.sync();
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const on = { itemId: 'I1', partIndex: 0, black: false, overlayId: 'O2', rev: 2 };

    owner.send({ type: 'own', state: ownState('S1', { pointer: on, outputs: [id], slide: slide('A'), canvas: canvas('A', { overlay: { text: 'Hej', image: otherHash } }) }) });
    await owner.sessions((s) => s[0]?.pointer.rev === 2 && s[0].outputs.length === 1);

    expect((await fetch(`${h.url}/api/screen/${id}/image/${otherHash}`)).status).toBe(404);
  });

  it('serves the overlay picture to a screen no longer once the overlay is switched off', async () => {
    const hash = await picture('IMG4', 54);
    await admin.client.mutate('createOverlay', { id: 'O3', title: 'Bild', imageId: 'IMG4' });
    await admin.client.sync();
    const owner = track(await Window.open(h, org, 'anna'));
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
    const id = await pairedScreen(owner);
    const named = canvas('A', { overlay: { text: null, image: hash } });
    owner.send({ type: 'own', state: ownState('S1', { pointer: { itemId: 'I1', partIndex: 0, black: false, overlayId: 'O3', rev: 2 }, outputs: [id], slide: slide('A'), canvas: named }) });
    await owner.sessions((s) => s[0]?.pointer.rev === 2 && s[0].outputs.length === 1);

    // A changed client that keeps naming the picture after switching the overlay off.
    owner.send({ type: 'own', state: ownState('S1', { pointer: { itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 3 }, outputs: [id], slide: slide('A'), canvas: named }) });
    await owner.sessions((s) => s[0]?.pointer.rev === 3);

    expect((await fetch(`${h.url}/api/screen/${id}/image/${hash}`)).status).toBe(404);
  });
});
