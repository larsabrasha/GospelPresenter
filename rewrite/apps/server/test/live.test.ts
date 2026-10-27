// Remote control against every server adapter (spec 04 §2, ADR 0004): the
// owner reports, a controller's command reaches the owner only, and losing
// the owner freezes the session until it reports again or someone ends it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setRole, startAdapter, type AdapterName, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const state = ownState;

describe.each(adapters)('%s adapter: live sessions and remote control', (adapterName) => {
  let h: Harness;
  let org: string;
  const open: Window[] = [];
  const win = async (user: string, inOrg = org) => {
    const w = await Window.open(h, inOrg, user);
    open.push(w);
    return w;
  };

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);
  afterAll(async () => {
    for (const w of open.splice(0)) w.close();
    await h?.close();
  });
  beforeEach(async () => {
    for (const w of open.splice(0)) w.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    await setRole(h, 'bo', org, 'user');
  });

  it('an owner reports; every member sees the session; a command reaches the owner and its echo settles it (LIVE-A23, A33)', async () => {
    const owner = await win('anna');
    const phone = await win('bo');
    owner.send({ type: 'own', state: state('S1') });
    const [seen] = await phone.sessions((s) => s.length === 1);
    expect(seen).toEqual({
      id: 'S1',
      presentationId: 'P',
      presentationName: 'Söndag',
      deviceName: 'Datorn i kyrksalen',
      remote: true,
      ownerOnline: true,
      pointer: { itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 1 },
      outputs: [],
      audio: null,
    });

    phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 2, black: false } });
    expect(await owner.next((m) => m.type === 'command')).toEqual({ type: 'command', sessionId: 'S1', change: { itemId: 'I1', partIndex: 2, black: false } });
    // An overlay toggle names the overlay; the owner decides what it does (LIVE-R15).
    phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 0, black: false, overlayId: 'O1' } });
    expect(await owner.next((m) => m.type === 'command')).toMatchObject({ change: { overlayId: 'O1' } });
    // The phone gets no command, only the owner's echo.
    owner.send({ type: 'own', state: state('S1', { pointer: { itemId: 'I1', partIndex: 2, black: false, overlayId: null, rev: 2 } }) });
    const [echoed] = await phone.sessions((s) => s[0]?.pointer.partIndex === 2);
    expect(echoed!.pointer.rev).toBe(2);
    expect(phone.messages.some((m) => m.type === 'command')).toBe(false);
  });

  it('refuses a command while remote control is off (LIVE-A22), and lets it through once it is on', async () => {
    const owner = await win('anna');
    const phone = await win('bo');
    owner.send({ type: 'own', state: state('S1', { remote: false }) });
    await phone.sessions((s) => s.length === 1);
    phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } });
    expect(await phone.error()).toBe('remote-off');
    owner.send({ type: 'own', state: state('S1', { remote: true }) });
    await phone.sessions((s) => s[0]?.remote === true);
    phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } });
    expect(await owner.next((m) => m.type === 'command')).toMatchObject({ change: { partIndex: 1 } });
  });

  it('a lost owner freezes the session: no commands; only then may another member end it; the owner can come back (LIVE-R50)', async () => {
    const owner = await win('anna');
    const phone = await win('bo');
    owner.send({ type: 'own', state: state('S1') });
    await phone.sessions((s) => s[0]?.ownerOnline === true);

    // While the owner is there, nobody else ends it.
    phone.send({ type: 'end', sessionId: 'S1' });
    expect(await phone.error()).toBe('not-owner');

    owner.close();
    const [frozen] = await phone.sessions((s) => s[0]?.ownerOnline === false);
    expect(frozen!.pointer.partIndex).toBe(0); // what was showing stays
    phone.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } });
    expect(await phone.error()).toBe('owner-offline');

    // The owner reconnects and reports again: it is live and drivable.
    const back = await win('anna');
    back.send({ type: 'own', state: state('S1') });
    await phone.sessions((s) => s[0]?.ownerOnline === true);
    back.close();
    await phone.sessions((s) => s[0]?.ownerOnline === false);
    phone.send({ type: 'end', sessionId: 'S1' });
    expect(await phone.sessions((s) => s.length === 0)).toEqual([]);
  });

  it('takes a report with the largest slide a song part can have', async () => {
    const owner = await win('anna');
    const text = 'Härlig är jorden\n'.repeat(300).slice(0, 5000);
    owner.send({ type: 'own', state: state('S1', { slide: { kind: 'song', text, verses: null, image: null, credits: 'x'.repeat(500), themeId: 'classic', overlay: null } }) });
    const [s] = await owner.sessions((x) => x.length === 1);
    expect(s!.id).toBe('S1');
    expect(owner.messages.some((m) => m.type === 'error')).toBe(false);
  });

  it('an audio command reaches the owner, and the owner\'s audio reaches everyone (spec 04 §1b, LIVE-A32)', async () => {
    const owner = await win('anna');
    const phone = await win('bo');
    owner.send({ type: 'own', state: state('S1') });
    await phone.sessions((x) => x.length === 1);
    phone.send({ type: 'audio', sessionId: 'S1', command: { action: 'play', itemId: 'A1' } });
    expect(await owner.next((m) => m.type === 'audio-command')).toEqual({ type: 'audio-command', sessionId: 'S1', command: { action: 'play', itemId: 'A1' } });
    expect(phone.messages.some((m) => m.type === 'audio-command')).toBe(false); // it plays only on the presenting computer
    owner.send({ type: 'own', state: state('S1', { audio: { itemId: 'A1', playing: true, position: 1.5, duration: 30, fading: false } }) });
    const [s] = await phone.sessions((x) => x[0]?.audio?.playing === true);
    expect(s!.audio).toEqual({ itemId: 'A1', playing: true, position: 1.5, duration: 30, fading: false });
    // Like any command, refused while remote control is off.
    owner.send({ type: 'own', state: state('S1', { remote: false }) });
    await phone.sessions((x) => x[0]?.remote === false);
    phone.send({ type: 'audio', sessionId: 'S1', command: { action: 'fade', itemId: 'A1' } });
    expect(await phone.error()).toBe('remote-off');
  });

  it('the owner ends its own session', async () => {
    const owner = await win('anna');
    owner.send({ type: 'own', state: state('S1') });
    await owner.sessions((s) => s.length === 1);
    owner.send({ type: 'end', sessionId: 'S1' });
    expect(await owner.sessions((s) => s.length === 0)).toEqual([]);
  });

  it('another member cannot take a session over by naming its id', async () => {
    const owner = await win('anna');
    const other = await win('bo');
    owner.send({ type: 'own', state: state('S1') });
    await other.sessions((s) => s.length === 1);
    other.send({ type: 'own', state: state('S1', { presentationName: 'Kapad' }) });
    expect(await other.error()).toBe('not-owner');
    other.send({ type: 'set', sessionId: 'S1', change: { itemId: null, partIndex: 0, black: true } });
    // The command went to Anna, not to Bo: Bo owns nothing.
    expect(await owner.next((m) => m.type === 'command')).toMatchObject({ change: { black: true } });
  });

  it("never shows one organisation's sessions to another (LIVE-A26)", async () => {
    const other = `org-${crypto.randomUUID()}`;
    await setRole(h, 'carol', other, 'admin');
    const owner = await win('anna');
    owner.send({ type: 'own', state: state('S1') });
    await owner.sessions((s) => s.length === 1);
    const stranger = await win('carol', other);
    expect(stranger.messages).toEqual([{ type: 'sessions', sessions: [] }]);
    stranger.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } });
    expect(await stranger.error()).toBe('not-found');
  });

  it('refuses what is not a message, and a socket without a session', async () => {
    const w = await win('anna');
    w.ws.send('not json');
    expect(await w.error()).toBe('invalid-message');
    w.send({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: -1, black: false } });
    expect(await w.error()).toBe('invalid-message');
    const anonymous = new WebSocket(h.url.replace(/^http/, 'ws') + '/api/live/socket');
    const refused = await new Promise<boolean>((resolve) => {
      anonymous.addEventListener('open', () => resolve(false));
      anonymous.addEventListener('error', () => resolve(true));
    });
    expect(refused).toBe(true);
  });
});
