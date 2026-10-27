// Paired screens against every server adapter (spec 04 §5, §8; LIVE-R24,
// R28): a TV shows a code, an operator pairs it by the code or a QR token, and
// it follows the session like a public output until it is let go; a saved
// screen is online while its page is open.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiveServerMessage, PublicSlide } from '@gp/core';
import { api, device, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';
import { Viewer } from './sse-viewer.ts';
import { SCREEN_GRACE_MS } from '../src/live-hub.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const slide = (text: string): PublicSlide => ({ kind: 'song', text, verses: null, image: null, credits: null, themeId: 'classic', overlay: null });
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
    owner.send({ type: 'own', state: ownState('S1', { outputs: [first.body.id], slide: slide('Härlig är jorden') }) });
    expect(await screen.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });
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
    owner.send({ type: 'own', state: ownState('S1', { outputs: [used.body.id], slide: slide('Härlig är jorden') }) });
    expect(await screen.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });
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
    owner.send({ type: 'own', state: ownState('S1', { outputs: ['K1'], slide: slide('Härlig är jorden') }) });
    expect(await page.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });

    // Not in local workerd: there a closed stream is never noticed, not even when a ping is written (README, "Not done yet").
    if (adapterName === 'workers') return;
    // A blink: the stream drops and the TV comes back within SCREEN_GRACE_MS, still switched on.
    page.close();
    const back = track(await Viewer.open(h, 'kyrksam', undefined, 'display'));
    expect(await back.next((e) => e.type === 'slide')).toEqual({ type: 'slide', slide: slide('Härlig är jorden') });
    await latest(owner, (m) => m.online.includes('K1') && m.sessions[0]?.outputs[0]?.id === 'K1');

    // Closed for good: still online through the grace, then off.
    const closedAt = Date.now();
    back.close();
    await latest(owner, (m) => !m.online.includes('K1') && m.sessions[0]?.outputs.length === 0, SCREEN_GRACE_MS + 5000);
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(SCREEN_GRACE_MS - 500);
  }, SCREEN_GRACE_MS + 15_000);
});
