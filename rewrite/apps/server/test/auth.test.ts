// Sign-in, sessions and membership over HTTP, against Node (both drivers)
// and Workers (D1 + Durable Objects in workerd). Security first: every way a
// request should be refused is tried. Pairing is Node-only (the desktop host)
// and has its own describe block at the end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SCHEMA_VERSION, type Me, type PairStatus, type SignInResponse, type UserRow } from '@gp/core';
import { SyncClient, httpTransport, socketProtocols } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { startNodeServer, type RunningServer } from '@gp/server/node';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, pokeUrl, setRole, startAdapter, type AdapterName, type Harness, type ServerDump } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];
const SETUP_TOKEN = 'gpst_the-setup-token-for-tests';
const PASSWORD = 'correct horse battery';

const pull = (clientId = 'c1') => ({ protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, clientId, cookie: null, lastMutationId: 0 });
const push = (clientId: string, mutations: { id: number; name: string; v: number; args: unknown }[]) => ({
  protocol: PROTOCOL_VERSION,
  schemaVersion: SCHEMA_VERSION,
  clientId,
  mutations,
});

/** Whether a poke socket with these subprotocols is accepted. */
function socketOpens(url: string, protocols: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, protocols);
    ws.addEventListener('open', () => {
      ws.close();
      resolve(true);
    });
    ws.addEventListener('error', () => resolve(false));
  });
}

describe.each(adapters)('%s adapter', (adapterName) => {
  let h: Harness;
  let admin: SignInResponse; // the SuperAdmin from setup
  const as = (r: { token: string }) => ({ token: r.token });

  beforeAll(async () => {
    h = await startAdapter(adapterName, { setupToken: SETUP_TOKEN });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  const dumpOf = async (who: { token: string }) => (await api<ServerDump>(h, 'GET', '/debug/dump', as(who))).body;

  /** An admin-made user who accepted their invite and signed in. */
  async function member(name: string, role: 'user' | 'admin' | 'superAdmin', by = admin) {
    const email = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@x.se`;
    const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/users', { ...as(by), body: { name, email, role } });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const accepted = await api<SignInResponse>(h, 'POST', '/auth/invites/accept', {
      body: { token: created.body.inviteToken, password: PASSWORD, deviceName: name },
    });
    expect(accepted.status).toBe(200);
    return { ...accepted.body, id: created.body.id, email };
  }

  // ------------------------------------------------------------ first run (runs first: no user may exist yet)

  it('AUTH-A1/D19: setup needs the setup token, happens once, and makes a SuperAdmin', async () => {
    expect(await api(h, 'GET', '/auth/state')).toEqual({ status: 200, body: { setupRequired: true } });
    const body = { name: 'Anna', orgName: 'Lilla Kyrkan', email: 'Anna@X.se', password: PASSWORD, deviceName: 'Mac' };
    expect((await api(h, 'POST', '/auth/setup', { body: { ...body, setupToken: 'gpst_guess' } })).body).toEqual({ error: 'setup-token' });
    expect((await api(h, 'POST', '/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN, password: 'short' } })).body).toEqual({
      error: 'invalid-request',
    });
    const r = await api<SignInResponse>(h, 'POST', '/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN } });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^gpdt_[\w-]{43}$/);
    expect(r.body.me).toMatchObject({ name: 'Anna', email: 'anna@x.se', role: 'superAdmin', orgName: 'Lilla Kyrkan' });
    admin = r.body;

    expect((await api(h, 'POST', '/auth/setup', { body: { ...body, email: 'eve@x.se', setupToken: SETUP_TOKEN } })).status).toBe(409);
    expect(await api(h, 'GET', '/auth/state')).toEqual({ status: 200, body: { setupRequired: false } });
    expect((await api<Me>(h, 'GET', '/auth/me', as(admin))).body).toEqual(admin.me);
  });

  // ------------------------------------------------------------ unauthenticated

  it('unauthenticated: no token, a forged token or a user id as token gets 401 everywhere', async () => {
    const forged = 'gpdt_' + 'A'.repeat(43);
    for (const token of [undefined, forged, admin.me.userId, `${admin.token}x`]) {
      expect((await api(h, 'POST', '/sync/pull', { token, body: pull() })).status, String(token)).toBe(401);
      expect((await api(h, 'POST', '/sync/push', { token, body: push('c1', []) })).status).toBe(401);
      expect((await api(h, 'GET', '/auth/me', { token })).status).toBe(401);
      expect((await api(h, 'GET', '/users', { token })).status).toBe(401);
    }
    // A poke socket without credentials, or with a forged token, is refused.
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', ['gp.v1'])).toBe(false);
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', socketProtocols({ token: forged }))).toBe(false);
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', socketProtocols({ token: admin.token }))).toBe(true);
  });

  // ------------------------------------------------------------ sign-in

  it('sign-in: an invited user sets a password, then signs in with it; wrong ones are refused alike', async () => {
    const bo = await member('Bo', 'user');
    expect(bo.me).toMatchObject({ name: 'Bo', role: 'user', orgId: admin.me.orgId });
    const signIn = (email: string, password: string) => api<SignInResponse>(h, 'POST', '/auth/signin', { body: { email, password, deviceName: 'iPad' } });
    const ok = await signIn(bo.email.toUpperCase(), PASSWORD); // the email's case does not matter
    expect(ok.status).toBe(200);
    expect(ok.body.token).not.toBe(bo.token);
    expect(await signIn(bo.email, 'wrong password')).toEqual({ status: 401, body: { error: 'wrong-credentials' } });
    expect(await signIn('nobody@x.se', PASSWORD)).toEqual({ status: 401, body: { error: 'wrong-credentials' } });
  });

  it('sign-in: after 5 wrong passwords the account is locked, even for the right one (429)', async () => {
    const cy = await member('Cy', 'user');
    for (let i = 0; i < 5; i++) {
      expect((await api(h, 'POST', '/auth/signin', { body: { email: cy.email, password: `wrong ${i}` } })).status).toBe(401);
    }
    const locked = await api<{ error: string; retryAfter: number }>(h, 'POST', '/auth/signin', { body: { email: cy.email, password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('too-many-attempts');
    expect(locked.body.retryAfter).toBeGreaterThan(50);
    // The session made before keeps working: a lock stops guessing, it signs no one out.
    expect((await api(h, 'GET', '/auth/me', as(cy))).status).toBe(200);
  });

  it('replayed: a signed-out token and a used invite are refused', async () => {
    const di = await member('Di', 'user');
    expect((await api(h, 'POST', '/auth/signout', as(di))).status).toBe(200);
    expect((await api(h, 'GET', '/auth/me', as(di))).status).toBe(401);
    expect((await api(h, 'POST', '/sync/pull', { ...as(di), body: pull() })).status).toBe(401);

    const created = await api<{ inviteToken: string }>(h, 'POST', '/users', { ...as(admin), body: { name: 'Ed', email: 'ed@x.se', role: 'user' } });
    const accept = () => api(h, 'POST', '/auth/invites/accept', { body: { token: created.body.inviteToken, password: PASSWORD } });
    expect((await accept()).status).toBe(200);
    expect(await accept()).toEqual({ status: 400, body: { error: 'invite-invalid' } });
    expect((await api(h, 'POST', '/auth/invites/lookup', { body: { token: created.body.inviteToken } })).body).toEqual({ state: 'invalid' });
  });

  // ------------------------------------------------------------ roles and membership

  it('PERM-A2: a User cannot list, create, change or remove users', async () => {
    const fa = await member('Fa', 'user');
    expect(await api(h, 'GET', '/users', as(fa))).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect((await api(h, 'POST', '/users', { ...as(fa), body: { name: 'X', email: 'x@x.se', role: 'user' } })).status).toBe(403);
    expect((await api(h, 'PATCH', `/users/${fa.id}`, { ...as(fa), body: { role: 'admin' } })).status).toBe(403);
    expect((await api(h, 'DELETE', `/users/${admin.me.userId}`, as(fa))).status).toBe(403);
    expect((await api(h, 'POST', `/users/${fa.id}/invites`, as(fa))).status).toBe(403);
  });

  it('PERM-R4/R5/R6, D20: an Admin cannot make or touch a SuperAdmin; nobody changes their own role or removes themselves', async () => {
    const gu = await member('Gu', 'admin');
    const refused = (r: { status: number; body: unknown }) => r.body;
    expect(refused(await api(h, 'POST', '/users', { ...as(gu), body: { name: 'S', email: 's@x.se', role: 'superAdmin' } }))).toEqual({
      error: 'super-admin-only',
    });
    expect(refused(await api(h, 'PATCH', `/users/${admin.me.userId}`, { ...as(gu), body: { role: 'user' } }))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'DELETE', `/users/${admin.me.userId}`, as(gu)))).toEqual({ error: 'super-admin-only' });
    // A new invite would let the Admin set the SuperAdmin's password.
    expect(refused(await api(h, 'POST', `/users/${admin.me.userId}/invites`, as(gu)))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'PATCH', `/users/${gu.id}`, { ...as(gu), body: { role: 'superAdmin' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'PATCH', `/users/${admin.me.userId}`, { ...as(admin), body: { role: 'admin' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'DELETE', `/users/${gu.id}`, as(gu)))).toEqual({ error: 'own-account' });
    expect(await api(h, 'POST', '/users', { ...as(gu), body: { name: 'Anna 2', email: 'anna@x.se', role: 'user' } })).toEqual({
      status: 409,
      body: { error: 'email-taken' },
    });
    // What the Admin may do: list, and manage Users and Admins.
    const users = await api<UserRow[]>(h, 'GET', '/users', as(gu));
    expect(users.body.find((u) => u.id === admin.me.userId)).toMatchObject({ role: 'superAdmin', active: true, invite: null });
  });

  it('demoted: the role is read on every request; the next pull starts over and admin APIs are refused', async () => {
    const ha = await member('Ha', 'admin');
    expect((await api(h, 'GET', '/users', as(ha))).status).toBe(200);
    const first = await api<{ cookie: string }>(h, 'POST', '/sync/pull', { ...as(ha), body: pull('ha-1') });
    expect(first.status).toBe(200);

    expect((await api(h, 'PATCH', `/users/${ha.id}`, { ...as(admin), body: { role: 'user' } })).status).toBe(200);
    expect((await api<Me>(h, 'GET', '/auth/me', as(ha))).body.role).toBe('user');
    expect((await api(h, 'GET', '/users', as(ha))).status).toBe(403);
    const next = await api<{ clear: boolean }>(h, 'POST', '/sync/pull', { ...as(ha), body: { ...pull('ha-1'), cookie: first.body.cookie } });
    expect(next.body.clear).toBe(true); // the role is part of the pull cookie's scope
    const listed = await api<UserRow[]>(h, 'GET', '/users', as(admin));
    expect(listed.body.find((u) => u.id === ha.id)?.role).toBe('user'); // ORG-A8
  });

  it('removed: a removed member\'s sessions stop at once, and their device stops syncing but keeps its edits', async () => {
    const io = await member('Io', 'user');
    const client = await SyncClient.open(await openWaSqlite(), {
      transport: httpTransport({ baseUrl: h.url, token: io.token }),
      ctx: { userId: io.id, role: 'user' },
    });
    await client.mutate('createSong', { id: `S-${io.id}`, name: 'Before' });
    await client.sync();
    await client.mutate('createSong', { id: `S2-${io.id}`, name: 'After removal' });

    expect((await api(h, 'DELETE', `/users/${io.id}`, as(admin))).status).toBe(200);
    expect((await api(h, 'POST', '/sync/push', { ...as(io), body: push(client.id, []) })).status).toBe(401);
    await client.sync();
    expect(client.authError).toBe('unauthenticated');
    expect(await client.pending()).toHaveLength(1); // kept, unsynced (D23)
    expect((await dumpOf(admin)).tables.songs.map((s) => s.name)).toContain('Before');
    expect((await dumpOf(admin)).tables.songs.map((s) => s.name)).not.toContain('After removal');
    expect((await api(h, 'POST', '/auth/signin', { body: { email: io.email, password: PASSWORD } })).status).toBe(401);
    await client.close();
  });

  it('a session whose membership is gone gets 403 not-a-member, and its device stops syncing', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const token = await setRole(h, 'ju', org, 'user');
    expect((await api(h, 'POST', '/sync/pull', { token, body: pull() })).status).toBe(200);
    expect((await api(h, 'POST', '/debug/membership', { body: { userId: 'ju', orgId: org, role: null } })).status).toBe(200);
    expect(await api(h, 'POST', '/sync/pull', { token, body: pull() })).toEqual({ status: 403, body: { error: 'not-a-member' } });
    const client = await SyncClient.open(await openWaSqlite(), { transport: httpTransport({ baseUrl: h.url, token }), ctx: { userId: 'ju', role: 'user' } });
    await client.sync();
    expect(client.authError).toBe('not-a-member');
    await client.close();
  });

  // ------------------------------------------------------------ wrong organisation

  it('wrong organisation: the session decides the organisation; a header or another org\'s user id changes nothing', async () => {
    const other = await setRole(h, 'kay', `org-${crypto.randomUUID()}`, 'admin');
    const r = await api(h, 'POST', '/sync/push', {
      token: other,
      headers: { 'x-org': admin.me.orgId, 'x-user': admin.me.userId, 'x-role': 'superAdmin' },
      body: push('kay-1', [{ id: 1, name: 'createSong', v: 1, args: { id: 'KAY', name: 'From another church' } }]),
    });
    expect(r.status).toBe(200);
    expect((await dumpOf(admin)).tables.songs.map((s) => s.id)).not.toContain('KAY');
    // Another organisation's users are not found, let alone changed (PERM-R3, ORG-A5).
    expect((await api(h, 'PATCH', `/users/${admin.me.userId}`, { token: other, body: { role: 'user' } })).status).toBe(404);
    expect((await api(h, 'DELETE', `/users/${admin.me.userId}`, { token: other })).status).toBe(404);
    expect((await api(h, 'POST', `/users/${admin.me.userId}/invites`, { token: other })).status).toBe(404);
    expect((await api<UserRow[]>(h, 'GET', '/users', { token: other })).body.map((u) => u.id)).toEqual(['kay']);
  });

  it('a server that is not a desktop host requires no pairing', async () => {
    expect((await api<PairStatus>(h, 'GET', '/pair/status')).body).toEqual({ required: false, paired: false, host: false });
  });
});

describe.each(adapters)('%s adapter, short session idle time', (adapterName) => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName, { sessionIdleMs: 1500 });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('expired: a session unused for longer than the idle time is refused', async () => {
    const token = await setRole(h, 'lu', 'org-lu', 'user');
    expect((await api(h, 'GET', '/auth/me', { token })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await api(h, 'GET', '/auth/me', { token })).status).toBe(401);
    expect((await api(h, 'POST', '/sync/pull', { token, body: pull() })).status).toBe(401);
  });
});

// ---------------------------------------------------------------- pairing (desktop host, Node only)

describe.each(['better-sqlite3', 'node:sqlite'] as const)('desktop host pairing, %s', (driver) => {
  const HOST = 'gphost_' + 'h'.repeat(43);
  let server: RunningServer;
  let dataDir: string;
  let admin: SignInResponse;
  const req = <T = unknown>(method: string, path: string, opts: { token?: string; device?: string; body?: unknown } = {}) =>
    api<T>({ name: 'node', url: server.url, close: async () => {} }, method, path, {
      token: opts.token,
      body: opts.body,
      headers: opts.device ? { 'x-gp-device': opts.device } : {},
    });

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'gp-pair-'));
    server = await startNodeServer({ dataDir, driver, pairing: { hostToken: HOST }, setupToken: SETUP_TOKEN });
    const r = await req<SignInResponse>('POST', '/auth/setup', {
      device: HOST,
      body: { setupToken: SETUP_TOKEN, name: 'Anna', orgName: 'Kyrkan', email: 'anna@x.se', password: PASSWORD },
    });
    expect(r.status).toBe(200);
    admin = r.body;
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('an unpaired device is refused everywhere but the pairing itself, also with a valid session token', async () => {
    expect((await req<PairStatus>('GET', '/pair/status')).body).toEqual({ required: true, paired: false, host: false });
    expect((await req<PairStatus>('GET', '/pair/status', { device: HOST })).body).toEqual({ required: true, paired: true, host: true });
    for (const device of [undefined, 'gppd_forged', 'gphost_' + 'x'.repeat(43)]) {
      expect(await req('GET', '/auth/state', { device })).toEqual({ status: 403, body: { error: 'device-not-paired' } });
      expect((await req('POST', '/auth/signin', { device, body: { email: 'anna@x.se', password: PASSWORD } })).status).toBe(403);
      expect((await req('POST', '/sync/pull', { device, token: admin.token, body: pull() })).status).toBe(403);
      expect((await req('GET', '/users', { device, token: admin.token })).status).toBe(403);
      expect((await req('POST', '/pair/code', { device, token: admin.token })).status).toBe(403);
    }
    const ws = pokeUrl({ name: 'node', url: server.url, close: async () => {} }) + '?clientId=x';
    expect(await socketOpens(ws, socketProtocols({ token: admin.token }))).toBe(false);
    expect(await socketOpens(ws, socketProtocols({ token: admin.token, device: HOST }))).toBe(true);
  });

  it('only the host, signed in with ManageUsers, makes codes; a code pairs one device once', async () => {
    expect((await req('POST', '/pair/code', { device: HOST })).status).toBe(401);
    const { body: code } = await req<{ code: string; expiresAt: number }>('POST', '/pair/code', { device: HOST, token: admin.token });
    expect(code.code).toMatch(/^\d{6}$/);

    const claim = (c: string) => req<{ token: string }>('POST', '/pair/claim', { body: { code: c, name: 'iPad i koret' } });
    const paired = await claim(code.code);
    expect(paired.status).toBe(200);
    const device = paired.body.token;
    expect(await claim(code.code)).toEqual({ status: 400, body: { error: 'pair-code-invalid' } }); // replayed

    // The paired device can sign in and sync, but cannot make codes for others: that is the host's.
    const signIn = await req<SignInResponse>('POST', '/auth/signin', { device, body: { email: 'anna@x.se', password: PASSWORD } });
    expect(signIn.status).toBe(200);
    expect((await req('POST', '/sync/pull', { device, token: signIn.body.token, body: pull('ipad') })).status).toBe(200);
    expect((await req('POST', '/pair/code', { device, token: signIn.body.token })).status).toBe(403);

    // Disconnecting it on the host refuses it at once, session or not.
    const devices = await req<{ id: string; name: string }[]>('GET', '/pair/devices', { device: HOST, token: admin.token });
    const ipad = devices.body.find((d) => d.name === 'iPad i koret')!;
    expect((await req('DELETE', `/pair/devices/${ipad.id}`, { device: HOST, token: admin.token })).status).toBe(200);
    expect((await req('POST', '/sync/pull', { device, token: signIn.body.token, body: pull('ipad') })).body).toEqual({ error: 'device-not-paired' });
  });

  it('a User at the host cannot make codes; five wrong guesses kill the code', async () => {
    const created = await req<{ inviteToken: string }>('POST', '/users', { device: HOST, token: admin.token, body: { name: 'Bo', email: 'bo@x.se', role: 'user' } });
    const bo = await req<SignInResponse>('POST', '/auth/invites/accept', { device: HOST, body: { token: created.body.inviteToken, password: PASSWORD } });
    expect((await req('POST', '/pair/code', { device: HOST, token: bo.body.token })).status).toBe(403);

    const { body: code } = await req<{ code: string }>('POST', '/pair/code', { device: HOST, token: admin.token });
    const wrong = code.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await req('POST', '/pair/claim', { body: { code: wrong, name: 'guess' } })).status).toBe(400);
    expect((await req('POST', '/pair/claim', { body: { code: code.code, name: 'too late' } })).status).toBe(400);
  });
});
