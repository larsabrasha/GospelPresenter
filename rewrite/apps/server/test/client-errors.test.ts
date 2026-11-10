// An error a client caught nothing for, sent to the server's log (docs/cloudflare.md, "Logs"), on every adapter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientErrorReport } from '@gp/core';
import { api, setRole, startAdapter, tokenOf, type AdapterName, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

const report: ClientErrorReport = { message: "TypeError: Cannot read properties of undefined (reading 'id')", stack: 'at Presentations (Presentations.tsx:12:3)', where: '/', version: 'f88d45a' };

describe.each(adapters)('%s adapter: client errors', (adapterName) => {
  let h: Harness;
  const logged: Record<string, unknown>[] = [];

  beforeAll(async () => {
    h = await startAdapter(adapterName, { log: (e) => logged.push(e) });
    await setRole(h, 'alice', 'org-1', 'user');
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('takes a signed-in member’s report', async () => {
    const r = await api(h, 'POST', '/api/client-errors', { user: 'alice', org: 'org-1', body: report });

    expect(r.status).toBe(200);
  });

  it.runIf(adapterName !== 'workers')('writes the report to the log with who sent it', async () => {
    await api(h, 'POST', '/api/client-errors', { user: 'alice', org: 'org-1', body: report });

    expect(logged.at(-1)).toMatchObject({ event: 'client-error', orgId: 'org-1', userId: 'alice', ...report });
  });

  it('refuses a report from no session', async () => {
    const r = await api(h, 'POST', '/api/client-errors', { body: report });

    expect(r.status).toBe(401);
  });

  it('refuses more than thirty in a quarter of an hour from one user, so nobody floods the log', async () => {
    await setRole(h, 'flood', 'org-1', 'user');
    const sent: number[] = [];
    for (let i = 0; i < 31; i++) sent.push((await api(h, 'POST', '/api/client-errors', { user: 'flood', org: 'org-1', body: report })).status);

    expect(sent).toEqual([...Array<number>(30).fill(200), 429]);
  });

  it('refuses a report longer than the limits', async () => {
    const r = await api(h, 'POST', '/api/client-errors', { user: 'alice', org: 'org-1', body: { ...report, message: 'x'.repeat(501) } });

    expect(r.status).toBe(400);
  });
});

describe.each(adapters.filter((a) => a !== 'workers'))('%s adapter: an error nothing caught on the server', (adapterName) => {
  let h: Harness;
  const logged: Record<string, unknown>[] = [];
  beforeAll(async () => {
    h = await startAdapter(adapterName, { log: (e) => logged.push(e) });
    await setRole(h, 'alice', 'org-1', 'user');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('is written to the log with where it happened, and answered as an error of the server', async () => {
    const r = await fetch(`${h.url}/api/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${tokenOf(h, 'org-1', 'alice')}`, 'content-type': 'application/json' }, body: '{not json' });

    expect([r.status, logged.find((e) => e.event === 'server-error')]).toMatchObject([500, { event: 'server-error', method: 'POST', path: '/api/sync/push' }]);
  });
});
