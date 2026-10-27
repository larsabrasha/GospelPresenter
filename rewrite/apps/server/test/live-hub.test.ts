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
});
