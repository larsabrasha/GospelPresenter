// The live hub on its own, with a runtime that misbehaves the way a Durable
// Object may while a socket closes: it still lists the socket, and refuses
// a new attachment on it.
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { LiveServerMessage, LiveSessionInfo } from '@gp/core';
import { LiveHub, type LiveSocket } from '../src/live-hub.ts';
import { ownState } from './live-window.ts';

const require = createRequire(import.meta.url);

function store() {
  const { DatabaseSync: Db } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  const db = new Db(':memory:');
  db.exec('CREATE TABLE displays (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL)');
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
    expect(timers.map((t) => t.ms)).toEqual([15_000, 15_000]);

    timers[0]!.fn(); // A, from the first drop: does nothing
    hub.message(owner, JSON.stringify({ type: 'own', state: ownState('S1', { outputs: ['K1'], pointer: { itemId: 'I1', partIndex: 1, black: false, overlayId: null, rev: 2 } }) }));
    expect(bound()).toEqual(['K1']);
    timers[1]!.fn(); // B: the screen is off
    expect(bound()).toEqual([]);
  });
});
