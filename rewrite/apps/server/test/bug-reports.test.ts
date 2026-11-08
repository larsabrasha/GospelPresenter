// "Rapportera fel" (docs/bug-reports.md): anyone signed in reports, and only they; a Superadmin in superadminläge reads,
// marks and deletes.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, type BugReport, type BugReportRow, type MyBugReport, type MyBugReportRow } from '@gp/core';
import type { Mail } from '../src/mail.ts';
import { sha256 } from '../src/crypto.ts';
import { Accounts, migrateGlobal } from '../src/global/index.ts';
import { authRoutes } from '../src/auth/index.ts';
import { nodeGlobalSql, openSqlite } from '../src/node.ts';

const SHOT = 'data:image/jpeg;base64,/9j/4AAQ';
const REPORT = { text: 'Bilden blev svart', shot: SHOT, state: { page: '/presentations/P1', steps: [{ secondsBefore: 3, kind: 'press', what: 'Starta presentation' }] } };

async function server(now?: () => number) {
  const sql = nodeGlobalSql(openSqlite(':memory:', 'node:sqlite'));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql, { now });
  const mails: Mail[] = [];
  const mail = { appUrl: 'https://gp.test', mailer: { send: async (m: Mail) => void mails.push(m) } };
  const app = authRoutes({ accounts, setupToken: null, clientAddress: () => '10.0.0.1', google: null, passkeys: null, mail });
  const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  await linkGoogle(accounts, setup.inviteToken, 'anna');
  const anna = (await accounts.members.createSession(setup.userId, setup.orgId, 'test', null, undefined, (now ?? Date.now)() + ACCOUNT_LIMITS.superModeMs)).token;
  const call = async <T = Record<string, unknown>>(token: string | null, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  const user = async (name: string, role: 'user' | 'admin' = 'user') => {
    const inv = await accounts.invitations.create(setup.orgId, { email: `${name.toLowerCase()}@x.se`, role, mailed: true, byUserId: setup.userId });
    if (typeof inv === 'string') throw new Error(inv);
    const r = await accounts.invitations.createAccount(await sha256(inv.token), { name, login: { provider: 'google', subject: `sub-${name}`, name }, googleEmail: null });
    if (typeof r === 'string') throw new Error(r);
    return (await accounts.members.createSession(r.userId, setup.orgId, 'test')).token;
  };
  return { call, user, anna, mails };
}

async function linkGoogle(accounts: Accounts, inviteToken: string, name: string) {
  const r = await accounts.signIn.acceptInvite(await sha256(inviteToken), { provider: 'google', subject: `sub-${name}`, name });
  if (typeof r === 'string') throw new Error(r);
}

describe('a bug report', () => {
  it('is kept with who sent it and from which organisation, for a Superadmin', async () => {
    const s = await server();
    const bo = await s.user('Bo');

    const { body } = await s.call<{ id: string }>(bo, 'POST', '/api/reports', REPORT);

    const r = (await s.call<BugReport>(s.anna, 'GET', `/api/reports/${body.id}`)).body;
    expect([r.text, r.userName, r.userEmail, r.orgName, r.role, r.shot, r.state, r.done]).toEqual(['Bilden blev svart', 'Bo', 'bo@x.se', 'Lilla Kyrkan', 'user', SHOT, REPORT.state, false]);
  });

  it('is listed newest first', async () => {
    let now = Date.now();
    const s = await server(() => now);
    await s.call(s.anna, 'POST', '/api/reports', { ...REPORT, text: 'Först' });
    now += 1000;
    await s.call(s.anna, 'POST', '/api/reports', { ...REPORT, text: 'Sedan', shot: null });

    const list = (await s.call<BugReportRow[]>(s.anna, 'GET', '/api/reports')).body;

    expect(list.map((r) => [r.text, r.hasShot])).toEqual([
      ['Sedan', false],
      ['Först', true],
    ]);
  });

  it('is refused without a session', async () => {
    const s = await server();

    expect((await s.call(null, 'POST', '/api/reports', REPORT)).status).toBe(401);
  });

  it('is refused without text', async () => {
    const s = await server();

    expect((await s.call(s.anna, 'POST', '/api/reports', { ...REPORT, text: '  ' })).status).toBe(400);
  });

  it('is refused with something other than a picture as its screenshot', async () => {
    const s = await server();

    expect((await s.call(s.anna, 'POST', '/api/reports', { ...REPORT, shot: 'data:text/html;base64,PGI+' })).status).toBe(400);
  });

  it('is hidden from an admin who is no Superadmin', async () => {
    const s = await server();
    const cia = await s.user('Cia', 'admin');

    expect((await s.call(cia, 'GET', '/api/reports')).status).toBe(403);
  });

  it('can be marked done', async () => {
    const s = await server();
    const { body } = await s.call<{ id: string }>(s.anna, 'POST', '/api/reports', REPORT);

    await s.call(s.anna, 'PATCH', `/api/reports/${body.id}`, { done: true });

    expect((await s.call<BugReportRow[]>(s.anna, 'GET', '/api/reports')).body[0]!.done).toBe(true);
  });

  it('can be deleted', async () => {
    const s = await server();
    const { body } = await s.call<{ id: string }>(s.anna, 'POST', '/api/reports', REPORT);

    await s.call(s.anna, 'DELETE', `/api/reports/${body.id}`);

    expect((await s.call(s.anna, 'GET', `/api/reports/${body.id}`)).status).toBe(404);
  });
});

describe('a bug report\'s thread', () => {
  /** Bo's report, which the Superadmin Anna answers. */
  async function answered() {
    let now = Date.now();
    const s = await server(() => (now += 1000));
    const bo = await s.user('Bo');
    const { body } = await s.call<{ id: string }>(bo, 'POST', '/api/reports', REPORT);
    await s.call(s.anna, 'POST', `/api/reports/${body.id}/messages`, { text: 'Vilken dator var det?' });
    return { s, bo, id: body.id };
  }

  it('shows the Superadmin\'s answer to the one who reported, with who wrote it', async () => {
    const { s, bo, id } = await answered();

    const r = (await s.call<MyBugReport>(bo, 'GET', `/api/my-reports/${id}`)).body;

    expect(r.messages.map((m) => [m.fromAdmin, m.userName, m.text])).toEqual([[true, 'Anna', 'Vilken dator var det?']]);
  });

  it('counts the answer as unread until the one who reported opens the report', async () => {
    const { s, bo, id } = await answered();
    const before = (await s.call<{ unread: number }>(bo, 'GET', '/api/my-reports/unread')).body.unread;

    await s.call(bo, 'GET', `/api/my-reports/${id}`);

    expect([before, (await s.call<{ unread: number }>(bo, 'GET', '/api/my-reports/unread')).body.unread]).toEqual([1, 0]);
  });

  it('mails the answer to the one who reported, with a link to the thread', async () => {
    const { s, id } = await answered();

    expect(s.mails.map((m) => [m.to, m.subject, m.text.includes('Vilken dator var det?'), m.text.includes(`https://gp.test/my-reports/${id}`)])).toEqual([['bo@x.se', 'Svar på din felrapport', true, true]]);
  });

  it('shows the answer back to a Superadmin as unread in the list', async () => {
    const { s, bo, id } = await answered();
    await s.call(s.anna, 'GET', `/api/reports/${id}`);

    await s.call(bo, 'POST', `/api/my-reports/${id}/messages`, { text: 'Kyrkans Mac' });

    expect((await s.call<BugReportRow[]>(s.anna, 'GET', '/api/reports')).body[0]!.unread).toBe(1);
  });

  it('opens a report marked done again when the one who reported answers', async () => {
    const { s, bo, id } = await answered();
    await s.call(s.anna, 'PATCH', `/api/reports/${id}`, { done: true });

    await s.call(bo, 'POST', `/api/my-reports/${id}/messages`, { text: 'Det hände igen' });

    expect((await s.call<BugReport>(s.anna, 'GET', `/api/reports/${id}`)).body.done).toBe(false);
  });

  it('is closed to another user, who can neither read nor answer it', async () => {
    const { s, id } = await answered();
    const cia = await s.user('Cia');

    const statuses = [(await s.call(cia, 'GET', `/api/my-reports/${id}`)).status, (await s.call(cia, 'POST', `/api/my-reports/${id}/messages`, { text: 'Hej' })).status];

    expect(statuses).toEqual([404, 404]);
  });

  it('lists only the user\'s own reports in Mina felrapporter', async () => {
    const { s, bo } = await answered();
    await s.call(s.anna, 'POST', '/api/reports', { ...REPORT, text: 'Annas eget' });

    const mine = (await s.call<MyBugReportRow[]>(bo, 'GET', '/api/my-reports')).body;

    expect(mine.map((r) => [r.text, r.unread])).toEqual([['Bilden blev svart', 1]]);
  });

  it('is answered only by a Superadmin on the Superadmins\' side', async () => {
    const { s, bo, id } = await answered();

    expect((await s.call(bo, 'POST', `/api/reports/${id}/messages`, { text: 'Svar' })).status).toBe(403);
  });
});
