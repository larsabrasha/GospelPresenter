// Trial: round trips of sync push and pull against the deployed Worker, cold and warm.
import { it } from 'vitest';
import { PROTOCOL_VERSION, SCHEMA_VERSION } from '../../../packages/core/src/index.ts';
import { device, setRole, startAdapter, tokenOf } from '../../../apps/server/test/harness.ts';

const pct = (xs: number[], p: number) => Math.round(xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]!);

it('push and pull round trips', async () => {
  const h = await startAdapter('remote');
  const org = 'org-lat-' + crypto.randomUUID();
  await setRole(h, 'anna', org, 'admin');
  const auth = { authorization: `Bearer ${tokenOf(h, org, 'anna')}`, 'content-type': 'application/json' };
  const clientId = 'lat-' + crypto.randomUUID();
  const post = async (path: string, body: unknown) => {
    const t = performance.now();
    const r = await fetch(h.url + path, { method: 'POST', headers: auth, body: JSON.stringify(body) });
    await r.text();
    if (r.status !== 200) throw new Error(`${path} ${r.status}`);
    return performance.now() - t;
  };
  const pull = (cookie: string | null) => post('/api/sync/pull', { protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, clientId, cookie, lastMutationId: 0 });
  // The first request to this organisation's object: it is created and its schema made.
  const coldPull = await pull(null);
  const pulls: number[] = [];
  const pushes: number[] = [];
  for (let i = 1; i <= 20; i++) {
    pushes.push(await post('/api/sync/push', { protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, clientId, mutations: [{ id: i, name: 'createSong', v: 1, args: { id: `L${i}`, name: `Sång ${i}` } }] }));
    pulls.push(await pull(null));
  }
  // A full client sync (push then pull, rebase) as the app does it.
  const d = await device(h, org, 'anna', 'admin');
  await d.client.sync();
  const syncs: number[] = [];
  for (let i = 0; i < 10; i++) {
    await d.client.mutate('createSong', { id: `C${i}`, name: `Klient ${i}` });
    const t = performance.now();
    await d.client.sync();
    syncs.push(performance.now() - t);
  }
  await d.client.close();
  console.log(`[measure] cold first pull (new object) ${Math.round(coldPull)} ms; push 1 mutation p50 ${pct(pushes, 50)} / p90 ${pct(pushes, 90)} ms; pull p50 ${pct(pulls, 50)} / p90 ${pct(pulls, 90)} ms; client sync (push+pull) p50 ${pct(syncs, 50)} / p90 ${pct(syncs, 90)} ms`);
}, 300_000);
