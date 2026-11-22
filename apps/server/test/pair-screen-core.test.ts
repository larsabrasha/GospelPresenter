// The core's "Anslut tillfällig skärm" (`pairScreenStepView`, crates/gp-core/src/pair_screen.rs) against this server, as
// the native shells run it: its requests done as the signed-in member, its timers fired at once. A TV that scans the QR
// token is taken in and switched on; a TV's code typed is taken in; a wrong one is counted; a closed dialog lets its
// token go, so the TV cannot use it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PairEffect, PairEvent, PairStep } from '@gp/rust-core';
import { nodeRustCore } from '@gp/rust-core/node';
import { api, setRole, startAdapter, type Harness } from './harness.ts';
import { ownState, Window } from './live-window.ts';

type Start = { id: string; pin?: string; paired?: true };

describe('pairScreenStepView against the server', () => {
  let h: Harness;
  let org: string;
  let owner: Window;
  const core = nodeRustCore();
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    owner?.close();
    await h?.close();
  });
  beforeEach(async () => {
    owner?.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'anna', org, 'admin');
    owner = await Window.open(h, org, 'anna');
    owner.send({ type: 'own', state: ownState('S1') });
    await owner.sessions((s) => s.length === 1);
  });

  const tv = (body: object = {}) => api<Start>(h, 'POST', '/api/screen', { body });

  /** The dialog after `event`, its requests done against the server one after another; the screens it switched on. */
  async function run(state: PairStep['state'] | null, event: PairEvent, on: string[]): Promise<PairStep> {
    let step = core.pure<PairStep>('pairScreenStepView', state ? { state, event } : { init: { sessionId: 'S1', base: h.url }, event });
    for (const e of step.effects as PairEffect[]) {
      if (e.type === 'output') on.push(e.id);
      if (e.type !== 'request') continue;
      const answer = await api(h, e.method, e.path, { user: 'anna', org, body: e.body ?? undefined });
      step = await run(step.state, { type: 'answer', request: e.request, token: e.token ?? null, body: answer.body }, on);
    }
    return step;
  }

  it('takes in and switches on a TV that scanned the QR code', async () => {
    const on: string[] = [];
    const opened = await run(null, { type: 'open' }, on);
    const token = new URL(opened.link!).searchParams.get('token')!;
    const scanned = await tv({ token });

    const polled = await run(opened.state, { type: 'timer', name: 'poll' }, on);

    expect([polled.state.paired?.id, on]).toEqual([scanned.body.id, [scanned.body.id]]);
  });

  it("takes in a TV by the code it shows", async () => {
    const on: string[] = [];
    const shown = await tv();
    const opened = await run(null, { type: 'open' }, on);

    const claimed = await run(opened.state, { type: 'submit', pin: shown.body.pin! }, on);

    expect(claimed.state.paired?.id).toBe(shown.body.id);
  });

  it('counts a wrong code', async () => {
    const shown = await tv();
    const opened = await run(null, { type: 'open' }, []);

    const claimed = await run(opened.state, { type: 'submit', pin: shown.body.pin === '1000' ? '1001' : '1000' }, []);

    expect([claimed.state.wrong, claimed.state.paired]).toEqual([1, null]);
  });

  it('lets its token go when closed, so a TV cannot use it after', async () => {
    const opened = await run(null, { type: 'open' }, []);
    const token = new URL(opened.link!).searchParams.get('token')!;

    await run(opened.state, { type: 'close' }, []);

    expect((await tv({ token })).body).toEqual({ error: 'token-invalid' });
  });
});
