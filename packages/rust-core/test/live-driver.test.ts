// The core's live socket (`liveStepView`, crates/gp-core/src/live_driver.rs): what a device reports while it presents,
// what it takes of a controller's command, which outputs it lets go, and what it shows of a session it drives, as the
// web's LiveLink, owner.ts and RemoteControl decide them. Against a device's database, where the reports read it.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import type { Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

interface Effect {
  type: string;
  message?: { type: string; state?: Record<string, unknown>; sessionId?: string; change?: Record<string, unknown> };
  name?: string;
  ms?: number;
  change?: Record<string, unknown>;
  pointer?: Record<string, unknown>;
}
interface Step {
  state: Record<string, unknown>;
  effects: Effect[];
}

/** A device with a presentation of two items, its live socket opened. */
async function device() {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, rows);
  await core.run('createPresentation', { id: 'P', name: 'Söndag' }, admin, rows);
  for (const id of ['i1', 'i2']) await core.run('addHeaderToPresentation', { itemId: id, presentationId: 'P', title: id }, admin, rows);
  const step = (state: unknown, event: object) => core.view<Step>('liveStepView', { state, event: { now: 1000, ...event } }, rows);
  const after = async (events: object[], from?: unknown) => {
    let s: Step = { state: from as Record<string, unknown>, effects: [] };
    for (const e of events) s = await step(s.state, e);
    return s;
  };
  const { state } = await core.view<Step>('liveStepView', { init: { sessionId: 's1', deviceName: 'Mac' } }, rows);
  const online = (await after([{ type: 'start' }, { type: 'socketOpened' }], state)).state;
  return { step, after, state, online };
}

const pointer = (itemId: string | null, partIndex = 0) => ({ presentationId: 'P', itemId, partIndex, black: false, overlayId: null, rev: 1 });
const sent = (s: Step) => s.effects.filter((e) => e.type === 'send').map((e) => e.message!);
const sessions = (list: object[], extra: object = {}) => ({ type: 'message', message: { type: 'sessions', sessions: list, online: [], screens: [], ...extra } });

describe('liveStepView, the socket', () => {
  it('opens the socket once started', async () => {
    const { step, state } = await device();

    const out = await step(state, { type: 'start' });

    expect(out.effects).toEqual([{ type: 'openSocket' }]);
  });

  it('tries a closed socket again at once, then after 2 s', async () => {
    const { after, online } = await device();

    const first = await after([{ type: 'socketClosed' }], online);
    const second = await after([{ type: 'socketClosed' }], first.state);

    expect([first.effects, second.effects]).toEqual([[{ type: 'timer', name: 'reconnect', ms: 0 }], [{ type: 'timer', name: 'reconnect', ms: 2000 }]]);
  });

  it('closes a socket that heard nothing for 30 s', async () => {
    const { step, online } = await device();

    const out = await step(online, { type: 'timer', name: 'ping', now: 1000 + 31_000 });

    expect(out.effects).toEqual([{ type: 'closeSocket' }]);
  });

  it('pings a socket that was heard lately', async () => {
    const { step, online } = await device();

    const out = await step(online, { type: 'timer', name: 'ping', now: 1000 + 20_000 });

    expect(sent(out)).toEqual([{ type: 'ping' }]);
  });
});

describe('liveStepView, the owner', () => {
  it('reports the presentation, its name and the pointer while presenting', async () => {
    const { step, online } = await device();

    const out = await step(online, { type: 'follow', pointer: pointer('i1') });

    expect(sent(out)[0]).toMatchObject({ type: 'own', state: { sessionId: 's1', presentationId: 'P', presentationName: 'Söndag', deviceName: 'Mac', pointer: { itemId: 'i1', partIndex: 0 } } });
  });

  it('does not send the same report twice', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'follow', pointer: pointer('i1') }, { type: 'changed' }], online);

    expect(sent(out)).toEqual([]);
  });

  it('sends the whole state again on a reconnect', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'follow', pointer: pointer('i1') }, { type: 'socketClosed' }, { type: 'socketOpened' }], online);

    expect(sent(out).map((m) => m.type)).toEqual(['own']);
  });

  it('ends the session when it stops presenting', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'follow', pointer: pointer('i1') }, { type: 'follow', pointer: null }], online);

    expect(sent(out)).toEqual([{ type: 'end', sessionId: 's1' }]);
  });

  it('applies a controller command for an item that is there', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'follow', pointer: pointer('i1') }, { type: 'message', message: { type: 'command', sessionId: 's1', change: { itemId: 'i2', partIndex: 0, black: false } } }], online);

    expect(out.effects).toEqual([{ type: 'apply', change: { itemId: 'i2', partIndex: 0, black: false } }]);
  });

  it('refuses a command for an item no longer there', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'follow', pointer: pointer('i1') }, { type: 'message', message: { type: 'command', sessionId: 's1', change: { itemId: 'gone', partIndex: 0, black: false } } }], online);

    expect(out.effects).toEqual([]);
  });

  it('refuses a command while not presenting', async () => {
    const { step, online } = await device();

    const out = await step(online, { type: 'message', message: { type: 'command', sessionId: 's1', change: { itemId: 'i2', partIndex: 0, black: false } } });

    expect(out.effects).toEqual([]);
  });

  it('switches off the outputs the server released', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'output', id: 'o1', on: true }, { type: 'message', message: { type: 'released', sessionId: 's1', outputs: ['o1'] } }], online);

    expect(out.state.chosen).toEqual([]);
  });

  it('lets go of an output another session sends to after the server refused it', async () => {
    const { after, online } = await device();
    const other = { id: 's2', outputs: [{ id: 'o1' }] };

    const out = await after([{ type: 'output', id: 'o1', on: true }, sessions([other]), { type: 'message', message: { error: 'output-taken' } }], online);

    expect(out.state.chosen).toEqual([]);
  });

  it('keeps an output it asked to take over though another session sends to it', async () => {
    const { after, online } = await device();
    const other = { id: 's2', outputs: [{ id: 'o1' }] };

    const out = await after([{ type: 'output', id: 'o1', on: true, take: true }, sessions([other]), { type: 'message', message: { error: 'output-taken' } }], online);

    expect(out.state.chosen).toEqual(['o1']);
  });

  it('stops asking to take over an output once the server lists it as its own', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'output', id: 'o1', on: true, take: true }, sessions([{ id: 's1', outputs: [{ id: 'o1' }] }])], online);

    expect(out.state.takeOver).toEqual([]);
  });

  it('switches off a temporary screen no longer paired', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'output', id: 't1', on: true }, sessions([], { screens: [{ id: 't1', n: 1 }] }), sessions([], { screens: [] })], online);

    expect(out.state.chosen).toEqual([]);
  });

  it('keeps a screen chosen that it has not seen yet', async () => {
    const { after, online } = await device();

    const out = await after([{ type: 'output', id: 't1', on: true }, sessions([], { screens: [] })], online);

    expect(out.state.chosen).toEqual(['t1']);
  });
});

describe('liveStepView, the sessions a member may drive', () => {
  it('lists a session elsewhere that allows remote control', async () => {
    const { step, online } = await device();

    const out = await step(online, sessions([{ id: 's9', remote: true, ownerOnline: true, outputs: [] }]));

    expect((out.state.controllable as { id: string }[]).map((s) => s.id)).toEqual(['s9']);
  });

  it('leaves out a session that does not allow it, one whose owner is gone, and its own', async () => {
    const { step, online } = await device();
    const list = [{ id: 's8', remote: false, outputs: [] }, { id: 's9', remote: true, ownerOnline: false, outputs: [] }, { id: 's1', remote: true, outputs: [] }];

    const out = await step(online, sessions(list));

    expect(out.state.controllable).toEqual([]);
  });
});

describe('liveStepView, a session driven from here', () => {
  const elsewhere = (p: object) => ({ id: 's9', presentationId: 'P', pointer: { itemId: 'i1', partIndex: 0, black: false, overlayId: null, rev: 3, ...p }, outputs: [] });

  it('shows a click at once and sends it as an absolute command', async () => {
    const { after, online } = await device();

    const out = await after([sessions([elsewhere({})]), { type: 'control', sessionId: 's9' }, { type: 'set', change: { itemId: 'i2', partIndex: 1 } }], online);

    expect(sent(out)).toEqual([{ type: 'set', sessionId: 's9', change: { itemId: 'i2', partIndex: 1, black: false } }]);
    expect(out.effects.find((e) => e.type === 'mirror')?.pointer).toMatchObject({ itemId: 'i2', partIndex: 1 });
  });

  it('says once that a command was not confirmed in 2 s', async () => {
    const { after, online } = await device();
    const set = { type: 'set', change: { itemId: 'i2', partIndex: 1 } };

    const out = await after([sessions([elsewhere({})]), { type: 'control', sessionId: 's9' }, set, { type: 'timer', name: 'unconfirmed' }, set, { type: 'timer', name: 'unconfirmed' }], online);
    const first = await after([sessions([elsewhere({})]), { type: 'control', sessionId: 's9' }, set, { type: 'timer', name: 'unconfirmed' }], online);

    expect(first.effects.map((e) => e.type)).toContain('unconfirmed');
    expect(out.effects.map((e) => e.type)).not.toContain('unconfirmed');
  });

  it('takes the owner echo as confirming the command', async () => {
    const { after, online } = await device();

    const out = await after([sessions([elsewhere({})]), { type: 'control', sessionId: 's9' }, { type: 'set', change: { itemId: 'i2', partIndex: 1 } }, sessions([elsewhere({ itemId: 'i2', partIndex: 1 })]), { type: 'timer', name: 'unconfirmed' }], online);

    expect(out.effects.map((e) => e.type)).not.toContain('unconfirmed');
  });

  it('says the session is lost once the server no longer lists it', async () => {
    const { after, online } = await device();

    const out = await after([sessions([elsewhere({})]), { type: 'control', sessionId: 's9' }, sessions([])], online);

    expect(out.effects).toEqual([{ type: 'lost' }]);
  });
});
