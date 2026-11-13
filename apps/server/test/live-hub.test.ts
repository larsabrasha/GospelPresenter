// The live hub on its own, with a runtime that misbehaves the way a Durable
// Object may while a socket closes: it still lists the socket, and refuses
// a new attachment on it.
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ABANDONED_SESSION_MS, SCREEN_IDLE_MS, SESSION_IDLE_MS, type LiveServerMessage, type LiveSessionInfo, type WatchEvent } from '@gp/core';
import { LiveHub, type LiveSocket } from '../src/live-hub.ts';
import { ownState } from './live-window.ts';

const require = createRequire(import.meta.url);

function store() {
  const { DatabaseSync: Db } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  const db = new Db(':memory:');
  db.exec('CREATE TABLE displays (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL)');
  db.exec('CREATE TABLE org_settings (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  return { query: (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[] };
}

function socket(id: string, userId: string): LiveSocket & { got: LiveServerMessage[]; refuseAttachment: boolean } {
  let owns: string[] = [];
  const s = {
    id,
    userId,
    role: 'admin' as const,
    got: [] as LiveServerMessage[],
    refuseAttachment: false,
    get owns() {
      return owns;
    },
    set owns(v: string[]) {
      if (s.refuseAttachment) throw new Error('WebSocket is closing');
      owns = v;
    },
    send(m: string) {
      s.got.push(JSON.parse(m) as LiveServerMessage);
    },
  };
  return s;
}

const lastSessions = (s: { got: LiveServerMessage[] }): LiveSessionInfo[] =>
  (s.got.filter((m) => m.type === 'sessions').at(-1) as Extract<LiveServerMessage, { type: 'sessions' }>).sessions;

describe('live hub', () => {
  it('freezes a session when its owner closes, even if the runtime still lists the socket and refuses to change it', () => {
    const owner = socket('a', 'anna');
    const phone = socket('b', 'bo');
    const listed = [owner, phone];
    const hub = new LiveHub(store(), () => listed);
    hub.message(owner, JSON.stringify({ type: 'own', state: ownState('S1') }));
    expect(lastSessions(phone)[0]!.ownerOnline).toBe(true);

    owner.refuseAttachment = true;
    hub.closed(owner); // still in `listed`, as during a Durable Object's webSocketClose
    expect(lastSessions(phone)[0]!.ownerOnline).toBe(false);

    // A command now is refused as the owner being away, not sent into the closing socket.
    const before = owner.got.length;
    hub.message(phone, JSON.stringify({ type: 'set', sessionId: 'S1', change: { itemId: 'I1', partIndex: 1, black: false } }));
    expect(phone.got.at(-1)).toEqual({ type: 'error', error: 'owner-offline' });
    expect(owner.got.length).toBe(before);
  });

  it('a saved screen that comes back and drops again gets a whole new grace; only the newest switch-off counts', () => {
    const db = store();
    db.query(`INSERT INTO displays (id, name, code, kind) VALUES ('K1', 'Kyrksal', 'kyrksam', 'screen')`);
    const timers: { fn: () => void; ms: number }[] = [];
    const owner = socket('a', 'anna');
    const hub = new LiveHub(db, () => [owner], Date.now, () => undefined, (fn, ms) => timers.push({ fn, ms }));
    const page = () => ({ send: () => undefined, close: () => undefined });
    const meta = { orgName: 'Kyrkan', outputName: 'Kyrksal' };
    const bound = () => lastSessions(owner)[0]!.outputs.map((o) => o.id);

    const first = page();
    hub.watch('K1', 'kyrksam', 'v1', first, meta);
    hub.message(owner, JSON.stringify({ type: 'own', state: ownState('S1', { outputs: ['K1'] }) }));
    expect(bound()).toEqual(['K1']);
    hub.unwatch('K1', 'v1', first); // a blink: switch-off A pending
    const second = page();
    hub.watch('K1', 'kyrksam', 'v1', second, meta); // back
    hub.unwatch('K1', 'v1', second); // dropped again: switch-off B pending
    const grace = timers.filter((t) => t.ms === 15_000); // the others check for idle screens (LIVE-R43)
    expect(grace).toHaveLength(2);

    grace[0]!.fn(); // A, from the first drop: does nothing
    hub.message(owner, JSON.stringify({ type: 'own', state: ownState('S1', { outputs: ['K1'], pointer: { itemId: 'I1', partIndex: 1, black: false, overlayId: null, rev: 2 } }) }));
    expect(bound()).toEqual(['K1']);
    grace[1]!.fn(); // B: the screen is off
    expect(bound()).toEqual([]);
  });
});

/** A hub on a clock the test moves, with the timers it asked for, and a saved screen K1 whose page is open. */
function idleSetup() {
  const db = store();
  db.query(`INSERT INTO displays (id, name, code, kind) VALUES ('K1', 'Kyrksal', 'kyrksam', 'screen')`);
  const clock = { now: 1_000_000 };
  const timers: { fn: () => void; ms: number }[] = [];
  const owner = socket('a', 'anna');
  const phone = socket('b', 'bo');
  const listed = [owner, phone];
  const hub = new LiveHub(db, () => listed, () => clock.now, () => undefined, (fn, ms) => timers.push({ fn, ms }));
  const page: WatchEvent[] = [];
  hub.watch('K1', 'kyrksam', 'v1', { send: (e) => page.push(e), close: () => undefined }, { orgName: 'Kyrkan', outputName: 'Kyrksal' }, true);
  const report = (over: Parameters<typeof ownState>[1] = {}) => hub.message(owner, JSON.stringify({ type: 'own', state: ownState('S1', { outputs: ['K1'], ...over }) }));
  const bound = () => lastSessions(owner)[0]?.outputs.map((o) => o.id) ?? [];
  /** Moves the clock to just past the newest timer's moment and runs it. */
  const runLatestTimer = () => {
    const t = timers.at(-1)!;
    clock.now += t.ms;
    t.fn();
  };
  return { hub, clock, timers, owner, phone, listed, page, report, bound, runLatestTimer };
}

const pointer = (partIndex: number, rev: number) => ({ itemId: 'I1', partIndex, black: false, overlayId: null, rev });

describe('live hub: idle limits', () => {
  it('lets a saved screen go when its session has not changed slide for 4 hours, and the screen shows its name (LIVE-R43)', () => {
    const { report, bound, runLatestTimer, page, owner } = idleSetup();
    report();
    expect(bound()).toEqual(['K1']);

    runLatestTimer();

    expect(bound()).toEqual([]);
    expect(page.at(-1)).toEqual({ type: 'idle' });
    expect(owner.got).toContainEqual({ type: 'released', sessionId: 'S1', outputs: ['K1'] });
  });

  it('counts a slide change as activity, so the screen stays bound 4 hours from it (LIVE-R43)', () => {
    const { report, bound, clock, timers } = idleSetup();
    report();
    clock.now += SCREEN_IDLE_MS - 60_000;
    report({ pointer: pointer(1, 2) });

    clock.now += 120_000;
    timers.at(-1)!.fn();

    expect(bound()).toEqual(['K1']);
  });

  it('does not count a report without a slide change as activity (LIVE-R43)', () => {
    const { report, bound, clock, runLatestTimer } = idleSetup();
    report();
    clock.now += 60_000;
    report({ remote: false });

    runLatestTimer();

    expect(bound()).toEqual([]);
  });

  it('does not bind a let-go screen again from the next report, but does once the owner switched it off and on (LIVE-R43)', () => {
    const { report, bound, runLatestTimer, owner } = idleSetup();
    report();
    runLatestTimer();

    report({ pointer: pointer(1, 2) });
    expect(bound()).toEqual([]);
    expect(owner.got.at(-2)).toEqual({ type: 'released', sessionId: 'S1', outputs: ['K1'] });

    report({ pointer: pointer(1, 2), outputs: [] });
    report({ pointer: pointer(1, 2) });
    expect(bound()).toEqual(['K1']);
  });

  it('lets a temporary screen go after 4 hours without a slide change: its TV starts again (LIVE-R43)', () => {
    const { hub, report, runLatestTimer, owner } = idleSetup();
    report({ outputs: [] });
    hub.addScreen('T1', 'S1', 'anna');
    const tv: WatchEvent[] = [];
    hub.watch('T1', 'T1', 'tv', { send: (e) => tv.push(e), close: () => undefined }, { orgName: 'Kyrkan', outputName: 'Tillfällig skärm (1)' }, true);
    report({ outputs: ['T1'] });

    runLatestTimer();

    expect(tv.at(-1)).toEqual({ type: 'unpaired' });
    expect(hub.screen('T1')).toBeNull();
    expect(owner.got).toContainEqual({ type: 'released', sessionId: 'S1', outputs: ['T1'] });
  });

  it('ends a session whose owner, though online, has not reported for 4 hours, and brings it back with its next report (LIVE-R42)', () => {
    const { report, clock, phone, hub } = idleSetup();
    report({ outputs: [] });
    clock.now += SESSION_IDLE_MS + 1;

    hub.opened(phone);
    expect(lastSessions(phone)).toEqual([]);

    report({ outputs: [], pointer: pointer(1, 2) });
    expect(lastSessions(phone).map((s) => s.id)).toEqual(['S1']);
  });

  it('keeps an online session that reported within 4 hours (LIVE-R42)', () => {
    const { report, clock, phone, hub } = idleSetup();
    report({ outputs: [] });
    clock.now += SESSION_IDLE_MS - 1;

    hub.opened(phone);

    expect(lastSessions(phone).map((s) => s.id)).toEqual(['S1']);
  });

  it('shows a saved screen its name, not black, when its session expired (LIVE-R50)', () => {
    const { report, clock, owner, phone, listed, hub, page } = idleSetup();
    report({ pointer: pointer(1, 2) });
    hub.closed(owner);
    listed.splice(listed.indexOf(owner), 1);
    clock.now += ABANDONED_SESSION_MS + 1;

    hub.opened(phone);

    expect(page.at(-1)).toEqual({ type: 'idle' });
  });

  it('draws a saved screen black when its session was stopped (Display.razor)', () => {
    const { report, owner, hub, page } = idleSetup();
    report({ pointer: pointer(1, 2) });

    hub.message(owner, JSON.stringify({ type: 'end', sessionId: 'S1' }));

    expect(page.at(-1)).toEqual({ type: 'canvas', canvas: null, now: expect.any(Number) });
  });
});
