// The core's sync driver (`syncStepView`, crates/gp-core/src/sync_driver.rs) where it reads the device's database:
// the requests it hands the shell. Its rules alone are its Rust tests; push and pull against a server, the sync tests
// of apps/server and crates/gp-core/parity/sync/check.mjs.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type MutatorCtx } from '@gp/core';
import { Core, type Rows } from '../../src/core.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

interface Effect {
  type: string;
  path?: string;
  body?: string;
}
interface Step {
  state: unknown;
  effects: Effect[];
}

/** A device's database, opened for sync as the shells open it, and the driver's first state. */
async function device() {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = new Core();
  core.runSync('migrateOrgSchema', rows);
  await core.run('syncOpen', { clientId: 'device-1' }, admin, rows);
  const step = (state: unknown, event: object) => core.view<Step>('syncStepView', { state, event }, rows);
  const { state } = await core.view<Step>('syncStepView', { init: {} }, rows);
  return { db, core, rows, step, state };
}

const posted = (s: Step) => {
  const post = s.effects.find((e) => e.type === 'post');
  return post && { path: post.path, body: JSON.parse(post.body!) as Record<string, unknown> };
};

describe('syncStepView', () => {
  it('pushes the queue with each change as the core queued it', async () => {
    const d = await device();
    await d.core.run('syncMutate', { mutator: 'createPresentation', args: '{"id":"p1","name":"Söndag"}' }, admin, d.rows);

    const s = await d.step(d.state, { type: 'sync' });

    expect(posted(s)).toEqual({
      path: '/api/sync/push',
      body: { protocol: 1, schemaVersion: SCHEMA_VERSION, clientId: 'device-1', mutations: [{ id: 1, name: 'createPresentation', v: 1, args: { id: 'p1', name: 'Söndag' } }] },
    });
  });

  it('pulls at once when the queue is empty', async () => {
    const d = await device();

    const s = await d.step(d.state, { type: 'sync' });

    expect(posted(s)).toEqual({ path: '/api/sync/pull', body: { protocol: 1, schemaVersion: SCHEMA_VERSION, clientId: 'device-1', cookie: null, lastMutationId: 0 } });
  });

  it('pulls the page after one with more from its cookie', async () => {
    const d = await device();
    const first = await d.step(d.state, { type: 'sync' });

    const s = await d.step(first.state, { type: 'answer', status: 200, body: { cookie: 'c7', lastMutationId: 0, more: true, patch: [], results: [], clear: false } });

    expect([s.effects[0]?.type, posted(s)?.body.cookie]).toEqual(['keepPage', 'c7']);
  });

  it("reads a native shell's answer from its text", async () => {
    const d = await device();
    const first = await d.step(d.state, { type: 'sync' });

    const s = await d.step(first.state, { type: 'answer', status: 426, text: '{"error":"update-required","minimumProtocol":2}' });

    expect((s.state as { stopped: string }).stopped).toBe('update-required');
  });

  it('sends the protocol the shell was opened with', async () => {
    const d = await device();
    const { state } = await d.core.view<Step>('syncStepView', { init: { protocol: 0 } }, d.rows);

    const s = await d.step(state, { type: 'sync' });

    expect(posted(s)?.body.protocol).toBe(0);
  });
});
