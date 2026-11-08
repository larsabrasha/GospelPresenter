// Several organisations (spec 01 `/admin/organizations` and the switcher, decided on 2026-10-31): a Superadmin in
// superadminläge makes, renames and deletes them and visits any without being a member; a user can be a member of
// several and switches.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, type Me, type OrgRow, type SignInResponse, type UserRow } from '@gp/core';
import { sha256 } from '../src/crypto.ts';
import { Accounts, migrateGlobal } from '../src/global/index.ts';
import { authRoutes } from '../src/auth/index.ts';
import { nodeGlobalSql, openSqlite } from '../src/node.ts';

async function server() {
  const sql = nodeGlobalSql(openSqlite(':memory:', 'node:sqlite'));
  await migrateGlobal(sql);
  const accounts = new Accounts(sql);
  const dropped: string[] = [];
  const app = authRoutes({ accounts, setupToken: null, clientAddress: () => '10.0.0.1', google: null, passkeys: null, dropOrgData: async (id) => void dropped.push(id) });
  const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
  if (setup === 'setup-done') throw new Error('setup');
  await linkGoogle(accounts, setup.inviteToken, 'anna');
  // Anna's session is in superadminläge.
  const anna = (await accounts.members.createSession(setup.userId, setup.orgId, 'test', null, undefined, Date.now() + ACCOUNT_LIMITS.superModeMs)).token;

  /** A request as the holder of `token`. */
  const call = async <T = Record<string, unknown>>(token: string | null, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  /** Someone invited to `orgId` who made their account with Google, or an account `id` that accepts: their id and a session. */
  const member = async (orgId: string, name: string, role: 'user' | 'admin' = 'user', id?: string) => {
    const inv = await accounts.invitations.create(orgId, { email: `${name.toLowerCase()}@x.se`, role, mailed: false, byUserId: setup.userId });
    if (typeof inv === 'string') throw new Error(inv);
    const r = id
      ? await accounts.invitations.accept(await sha256(inv.token), id)
      : await accounts.signIn.signInWithGoogle({ sub: `sub-${name}`, email: null, name }, await sha256(inv.token));
    if (typeof r === 'string') throw new Error(r);
    return { id: r.userId, token: (await accounts.members.createSession(r.userId, orgId, 'test')).token };
  };
  const newOrg = async (name: string) => String((await call(anna, 'POST', '/api/orgs', { name })).body.id);
  return { accounts, call, member, newOrg, dropped, anna, home: setup.orgId, annaId: setup.userId };
}

async function linkGoogle(accounts: Accounts, inviteToken: string, name: string) {
  const r = await accounts.signIn.acceptInvite(await sha256(inviteToken), { provider: 'google', subject: `sub-${name}`, name });
  if (typeof r === 'string') throw new Error(r);
}

describe('a Superadmin and the organisations', () => {
  it('lists them by name with their number of members', async () => {
    const s = await server();
    await s.newOrg('Annexet');

    const r = await s.call<OrgRow[]>(s.anna, 'GET', '/api/orgs');

    expect(r.body.map((o) => [o.name, o.members])).toEqual([
      ['Annexet', 0],
      ['Lilla Kyrkan', 1],
    ]);
  });

  it('renames one', async () => {
    const s = await server();
    const id = await s.newOrg('Annexet');

    await s.call(s.anna, 'PATCH', `/api/orgs/${id}`, { name: 'Stora Kyrkan' });

    expect((await s.call<OrgRow[]>(s.anna, 'GET', '/api/orgs')).body.map((o) => o.name)).toContain('Stora Kyrkan');
  });

  it('visits one it is not a member of, as Superadmin, without showing among its users', async () => {
    const s = await server();
    const id = await s.newOrg('Annexet');

    const r = await s.call<SignInResponse>(s.anna, 'POST', '/api/auth/switch', { orgId: id });

    expect([r.body.me.orgName, r.body.me.role]).toEqual(['Annexet', 'superAdmin']);
    expect((await s.call<UserRow[]>(r.body.token, 'GET', '/api/users')).body).toEqual([]);
  });

  it('refuses an admin the organisations', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo', 'admin');

    expect([(await s.call(bo.token, 'GET', '/api/orgs')).status, (await s.call(bo.token, 'POST', '/api/orgs', { name: 'Egen' })).status]).toEqual([403, 403]);
  });
});

describe('superadminläge', () => {
  it('takes the Superadmin home when turned off after its hour in an organisation they are no member of', async () => {
    const s = await server();
    const annex = await s.newOrg('Annexet');
    const visiting = (await s.call<SignInResponse>(s.anna, 'POST', '/api/auth/switch', { orgId: annex })).body;
    await s.accounts.sql.run('UPDATE sessions SET super_until = 1 WHERE id = ?', [visiting.me.sessionId]);

    const off = await s.call<{ token: string; me: Me }>(visiting.token, 'POST', '/api/auth/superadmin', { on: false });

    expect([(await s.call(visiting.token, 'GET', '/api/auth/me')).status, off.body.me.orgId, off.body.me.role]).toEqual([401, s.home, 'admin']);
  });
});

describe('switching', () => {
  it('keeps the old session for the tabs that sync the old organisation', async () => {
    const s = await server();
    const annex = await s.newOrg('Annexet');

    await s.call(s.anna, 'POST', '/api/auth/switch', { orgId: annex });

    expect((await s.call<Me>(s.anna, 'GET', '/api/auth/me')).body.orgName).toBe('Lilla Kyrkan');
  });

  it('is not a fresh sign-in', async () => {
    const s = await server();
    const annex = await s.newOrg('Annexet');
    const [old] = await s.accounts.sql.all('SELECT created_at FROM sessions');

    const r = await s.call<SignInResponse>(s.anna, 'POST', '/api/auth/switch', { orgId: annex });

    expect(await s.accounts.sql.all('SELECT created_at FROM sessions WHERE id = ?', [r.body.me.sessionId])).toEqual([old]);
  });
});

describe('a user in several organisations', () => {
  it('joins a second one by accepting its invitation, with the role given there', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');

    await s.member(annex, 'Bo', 'admin', bo.id);

    expect(await s.accounts.members.member(bo.id, annex)).toMatchObject({ id: bo.id, role: 'admin', hostOnly: false });
  });

  it('is not made a member by an invitation alone', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');
    const visiting = (await s.call<SignInResponse>(s.anna, 'POST', '/api/auth/switch', { orgId: annex })).body.token;

    const r = await s.call(visiting, 'POST', '/api/invitations', { email: 'bo@x.se', role: 'user' });

    expect(r.status).toBe(200);
    expect(await s.accounts.members.member(bo.id, annex)).toBeNull();
  });

  it('sees both organisations in the switcher and switches to the other', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');
    await s.member(annex, 'Bo', 'admin', bo.id);

    const orgs = await s.call<{ name: string }[]>(bo.token, 'GET', '/api/auth/orgs');
    const r = await s.call<SignInResponse>(bo.token, 'POST', '/api/auth/switch', { orgId: annex });

    expect(orgs.body.map((o) => o.name)).toEqual(['Annexet', 'Lilla Kyrkan']);
    expect([r.body.me.orgName, r.body.me.role]).toEqual(['Annexet', 'admin']);
  });

  it('is refused an organisation they are not a member of', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');

    expect((await s.call(bo.token, 'POST', '/api/auth/switch', { orgId: annex })).status).toBe(403);
  });

  it('signs in next time to the organisation they last switched to', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');
    await s.member(annex, 'Bo', 'user', bo.id);
    await s.call(bo.token, 'POST', '/api/auth/switch', { orgId: annex });

    expect(await s.accounts.signIn.signedInAs(bo.id)).toEqual({ userId: bo.id, orgId: annex });
  });

  it('is removed from one organisation and stays a member of the other', async () => {
    const s = await server();
    const bo = await s.member(s.home, 'Bo');
    const annex = await s.newOrg('Annexet');
    await s.member(annex, 'Bo', 'user', bo.id);

    await s.call(s.anna, 'DELETE', `/api/users/${bo.id}`);

    expect([await s.accounts.members.member(bo.id, s.home), await s.accounts.members.member(bo.id, annex)]).toEqual([null, expect.objectContaining({ id: bo.id, role: 'user' })]);
  });
});

describe('deleting an organisation', () => {
  it('deletes its members who are in no other organisation, keeps the others, and drops its data', async () => {
    const s = await server();
    const annex = await s.newOrg('Annexet');
    const bo = await s.member(annex, 'Bo');
    const cia = await s.member(annex, 'Cia');
    await s.member(s.home, 'Cia', 'user', cia.id);

    const r = await s.call(s.anna, 'DELETE', `/api/orgs/${annex}`);

    expect(r.status).toBe(200);
    expect(await s.accounts.sql.all('SELECT name FROM users ORDER BY name')).toEqual([{ name: 'Anna' }, { name: 'Cia' }]);
    expect(await s.accounts.members.member(cia.id, s.home)).toMatchObject({ id: cia.id, role: 'user' });
    expect(s.dropped).toEqual([annex]);
    expect((await s.call(bo.token, 'GET', '/api/auth/me')).status).toBe(401);
  });

  it("is refused while it is a Superadmin's only organisation", async () => {
    const s = await server();

    expect((await s.call(s.anna, 'DELETE', `/api/orgs/${s.home}`)).body).toEqual({ error: 'super-admin-home' });
  });

  it('ends the sessions of a Superadmin visiting it, who then signs in to their own', async () => {
    const s = await server();
    const annex = await s.newOrg('Annexet');
    const visiting = (await s.call<SignInResponse>(s.anna, 'POST', '/api/auth/switch', { orgId: annex })).body.token;

    await s.call(s.anna, 'DELETE', `/api/orgs/${annex}`);

    expect((await s.call(visiting, 'GET', '/api/auth/me')).status).toBe(401);
    expect(await s.accounts.signIn.signedInAs(s.annaId)).toEqual({ userId: s.annaId, orgId: s.home });
  });
});
