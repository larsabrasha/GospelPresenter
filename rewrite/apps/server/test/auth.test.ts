// Sign-in, sessions and membership over HTTP, against Node (both drivers)
// and Workers (D1 + Durable Objects in workerd), with a fake Google in this
// process. Security first: every way a request should be refused is tried.
// Pairing is Node-only (the desktop host) and has its own describe block at the end.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { PROTOCOL_VERSION, SCHEMA_VERSION, type AuthState, type Me, type PairClaimResponse, type PairStatus, type SignInResponse, type UserRow } from '@gp/core';
import { SyncClient, httpTransport, socketProtocols } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { Accounts, migrateGlobal, pairingGuard } from '@gp/server';
import { nodeGlobalSql, openSqlite, startNodeServer, type RunningServer } from '@gp/server/node';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, pokeUrl, setRole, startAdapter, type AdapterName, type Harness, type ServerDump } from './harness.ts';
import { appCallbackLink, startFakeGoogle, TestBrowser, type FakeAccount, type FakeGoogle, type Tamper } from './fake-google.ts';
import { SoftAuthenticator } from './soft-authenticator.ts';

/** The path and query a redirect ended at: the app's pages are paths now, not fragments. */
const where = (url: string) => new URL(url).pathname + new URL(url).search;

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];
const SETUP_TOKEN = 'gpst_the-setup-token-for-tests';

let fake: FakeGoogle;
beforeAll(async () => {
  fake = await startFakeGoogle();
});
afterAll(() => fake?.close());

const account = (name: string): FakeAccount => ({ sub: `${name}-${crypto.randomUUID()}`, email: `${name.toLowerCase()}@gmail.com`, name });

type WebResult = { session: SignInResponse; error?: undefined } | { session?: undefined; error: string };

/**
 * A web sign-in, as a browser does it: begin (with an invite or not), off to
 * the fake Google as `who`, back to the callback, and the page collecting
 * its session. `tamper` spoils the ID token.
 */
async function webSignIn(h: Harness, who: FakeAccount | null, opts: { invite?: string; tamper?: Tamper; browser?: TestBrowser } = {}): Promise<WebResult> {
  const browser = opts.browser ?? new TestBrowser();
  const begin = await api<{ url: string; error?: string }>(h, 'POST', '/api/auth/google/begin', { body: opts.invite ? { invite: opts.invite } : {} });
  if (begin.status !== 200) return { error: begin.body.error! };
  fake.next(who, opts.tamper);
  const end = await browser.open(h.url + begin.body.url);
  const hash = where(end.url);
  if (hash !== '/signed-in') return { error: /error=([\w-]+)/.exec(hash)?.[1] ?? /data-error="([\w-]+)"/.exec(end.html)?.[1] ?? `page ${end.status}` };
  const res = await browser.fetch(`${h.url}/api/auth/google/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"deviceName":"Browser"}' });
  const body = (await res.json()) as SignInResponse & { error?: string };
  return res.ok ? { session: body } : { error: body.error! };
}

/** A desktop app's sign-in (spec 01): `/api/app-login` in the system browser, ending at the handover page. */
async function appSignIn(h: Harness, who: FakeAccount | null, query: string) {
  fake.next(who);
  const end = await new TestBrowser().open(`${h.url}/api/app-login?${query}`);
  return { ...end, link: appCallbackLink(end.html) };
}

const counts = async (h: Harness) => (await api<Record<string, number>>(h, 'GET', '/api/debug/counts')).body;

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
    h = await startAdapter(adapterName, { setupToken: SETUP_TOKEN, google: fake });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  const dumpOf = async (who: { token: string }) => (await api<ServerDump>(h, 'GET', '/api/debug/dump', as(who))).body;

  /** An admin-made user who accepted their invite with Google and is signed in. */
  async function member(name: string, role: 'user' | 'admin' | 'superAdmin', by = admin) {
    const email = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@x.se`;
    const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/api/users', { ...as(by), body: { name, email, role } });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const google = account(name);
    const r = await webSignIn(h, google, { invite: created.body.inviteToken });
    expect(r.error).toBeUndefined();
    return { ...r.session!, id: created.body.id, email, google, inviteToken: created.body.inviteToken };
  }

  // ------------------------------------------------------------ first run (runs first: no user may exist yet)

  it('AUTH-A1/D19: setup needs the setup token, answers with an invite, and is done once the SuperAdmin linked Google', async () => {
    expect(await api(h, 'GET', '/api/auth/state')).toEqual({ status: 200, body: { setupRequired: true, google: true, passkeys: false } satisfies AuthState });
    const body = { name: 'Anna', orgName: 'Lilla Kyrkan' };
    expect((await api(h, 'POST', '/api/auth/setup', { body: { ...body, setupToken: 'gpst_guess' } })).body).toEqual({ error: 'setup-token' });
    expect((await api(h, 'POST', '/api/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN, name: '  ' } })).body).toEqual({ error: 'invalid-request' });
    const first = await api<{ inviteToken: string }>(h, 'POST', '/api/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN } });
    expect(first.body.inviteToken).toMatch(/^gpin_[\w-]{43}$/);
    // Left before Google: still not set up, and doing it again makes no second church.
    expect((await api<AuthState>(h, 'GET', '/api/auth/state')).body.setupRequired).toBe(true);
    const again = await api<{ inviteToken: string }>(h, 'POST', '/api/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN } });
    expect((await webSignIn(h, account('Anna'), { invite: first.body.inviteToken })).error).toBe('invite-invalid');

    const anna = account('Anna');
    const r = await webSignIn(h, anna, { invite: again.body.inviteToken });
    expect(r.session?.token).toMatch(/^gpdt_[\w-]{43}$/);
    expect(r.session?.me).toMatchObject({ name: 'Anna', email: 'anna@gmail.com', role: 'superAdmin', orgName: 'Lilla Kyrkan' });
    admin = r.session!;

    expect((await api(h, 'POST', '/api/auth/setup', { body: { ...body, setupToken: SETUP_TOKEN } })).status).toBe(409);
    expect((await api<AuthState>(h, 'GET', '/api/auth/state')).body.setupRequired).toBe(false);
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(admin))).body).toEqual(admin.me);
    // Signing in again later needs no invite: the Google account is linked.
    expect((await webSignIn(h, anna)).session?.me.userId).toBe(admin.me.userId);
  });

  // ------------------------------------------------------------ unauthenticated

  it('unauthenticated: no token, a forged token or a user id as token gets 401 everywhere', async () => {
    const forged = 'gpdt_' + 'A'.repeat(43);
    for (const token of [undefined, forged, admin.me.userId, `${admin.token}x`]) {
      expect((await api(h, 'POST', '/api/sync/pull', { token, body: pull() })).status, String(token)).toBe(401);
      expect((await api(h, 'POST', '/api/sync/push', { token, body: push('c1', []) })).status).toBe(401);
      expect((await api(h, 'GET', '/api/auth/me', { token })).status).toBe(401);
      expect((await api(h, 'GET', '/api/users', { token })).status).toBe(401);
    }
    // A poke socket without credentials, or with a forged token, is refused.
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', ['gp.v1'])).toBe(false);
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', socketProtocols({ token: forged }))).toBe(false);
    expect(await socketOpens(pokeUrl(h) + '?clientId=x', socketProtocols({ token: admin.token }))).toBe(true);
  });

  // ------------------------------------------------------------ sign-in with Google

  it('AUTH-R4: a Google account that is not linked, with no invite, is refused and gets no session', async () => {
    const before = await counts(h);
    expect(await webSignIn(h, account('Stranger'))).toEqual({ error: 'not-linked' });
    // Not by email either: a new Google account with a member's address is someone else.
    const bo = await member('Bo', 'user');
    expect(await webSignIn(h, { ...account('Mallory'), email: bo.email })).toEqual({ error: 'not-linked' });
    expect((await counts(h)).sessions).toBe(before.sessions! + 1); // Bo's own, nothing more
    // Bo signs in by his Google account's sub, also after changing its address.
    expect((await webSignIn(h, { ...bo.google, email: 'bo.new@gmail.com' })).session?.me.userId).toBe(bo.id);
    // Declining at Google ends the same way, with nothing minted.
    expect(await webSignIn(h, null)).toEqual({ error: 'google-failed' });
  });

  it.each<Tamper>(['aud', 'iss', 'expired', 'signature', 'nonce', 'unverified', 'alg-none'])(
    'an ID token with a wrong %s is refused; no session, and the invite is still good',
    async (tamper) => {
      const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/api/users', {
        ...as(admin),
        body: { name: `T ${tamper}`, email: `t-${tamper}-${crypto.randomUUID().slice(0, 6)}@x.se`, role: 'user' },
      });
      const before = await counts(h);
      expect(await webSignIn(h, account('T'), { invite: created.body.inviteToken, tamper })).toEqual({ error: 'google-failed' });
      expect((await counts(h)).sessions).toBe(before.sessions);
      expect((await counts(h)).user_logins).toBe(before.user_logins);
      expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: created.body.inviteToken } })).body).toMatchObject({ state: 'valid' });
    },
  );

  it('state: a callback with a forged state, from another browser, or replayed is refused; the page collects its session once', async () => {
    const google = (await member('Ce', 'user')).google;
    // Forged state, in a browser that has started nothing.
    const forged = await new TestBrowser().open(`${h.url}/api/auth/google/callback?state=forged&code=x`);
    expect([forged.status, /data-error="google-failed"/.test(forged.html)]).toEqual([400, true]);

    // A flow started in one browser, finished in another (login CSRF): refused.
    const begin = await api<{ url: string }>(h, 'POST', '/api/auth/google/begin', { body: {} });
    const victim = new TestBrowser();
    fake.next(google);
    const toGoogle = await victim.fetch(h.url + begin.body.url);
    const back = await fetch(toGoogle.headers.get('location')!, { redirect: 'manual' });
    const callback = back.headers.get('location')!;
    const other = await new TestBrowser().open(callback);
    expect(other.status).toBe(400);
    // The flow cannot be started a second time either.
    expect((await new TestBrowser().open(h.url + begin.body.url)).status).toBe(400);

    // The right browser, once; the same callback again is a replay.
    const browser = new TestBrowser();
    const b2 = await api<{ url: string }>(h, 'POST', '/api/auth/google/begin', { body: {} });
    fake.next(google);
    const r1 = await browser.fetch(h.url + b2.body.url);
    const cb = (await fetch(r1.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!;
    const saved = new Map(browser.cookies(new URL(h.url).origin));
    expect(where((await browser.open(cb)).url)).toBe('/signed-in');
    for (const [k, v] of saved) browser.cookies(new URL(h.url).origin).set(k, v); // even with the flow cookie kept
    expect((await browser.open(cb)).status).toBe(400);

    const finish = () => browser.fetch(`${h.url}/api/auth/google/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect((await finish()).status).toBe(200);
    expect((await finish()).status).toBe(401);
    expect((await api(h, 'POST', '/api/auth/google/finish', { body: {} })).status).toBe(401);
  });

  it('an invite links one Google account: one already linked to another user is refused (spec 01 E4)', async () => {
    const dag = await member('Dag', 'user');
    const created = await api<{ inviteToken: string }>(h, 'POST', '/api/users', { ...as(admin), body: { name: 'Eva', email: `eva-${crypto.randomUUID().slice(0, 6)}@x.se`, role: 'user' } });
    expect(await webSignIn(h, dag.google, { invite: created.body.inviteToken })).toEqual({ error: 'login-taken' });
    expect((await webSignIn(h, dag.google)).session?.me.userId).toBe(dag.id); // still Dag's
  });

  it('AUTH-R10/AUTH-A11/A12: /app-login refuses an unknown callback scheme before anything is minted, and hands a token to a known one in the fragment', async () => {
    const fa = await member('Fa', 'admin');
    const before = await counts(h);
    for (const scheme of ['evil', 'GospelPresenter', 'gospelpresenter-local:', 'gospelpresenter ', 'https', '']) {
      const r = await fetch(`${h.url}/api/app-login?device=Mac&callback_scheme=${encodeURIComponent(scheme)}`, { redirect: 'manual' });
      expect([scheme, r.status, await r.json()]).toEqual([scheme, 400, { error: 'callback-scheme' }]);
    }
    expect((await api(h, 'POST', '/api/auth/google/begin', { body: { app: { deviceName: 'Mac', callbackScheme: 'evil' } } })).body).toEqual({ error: 'callback-scheme' });
    expect(await counts(h)).toEqual(before); // no session, and not even a sign-in started

    const page = await appSignIn(h, fa.google, 'device=Mac&callback_scheme=gospelpresenter-test');
    expect(page.status).toBe(200);
    expect(page.html).toContain('Du är inloggad');
    const link = new URL(page.link!);
    expect(`${link.protocol}//${link.host}`).toBe('gospelpresenter-test://auth');
    const params = new URLSearchParams(link.hash.slice(1));
    expect(params.get('user_id')).toBe(fa.id);
    expect(params.get('organization_id')).toBe(admin.me.orgId);
    expect((await api<Me>(h, 'GET', '/api/auth/me', { token: params.get('token')! })).body.userId).toBe(fa.id);
    // No scheme: the default one (ADR 0005 (6)).
    expect(new URL((await appSignIn(h, fa.google, 'device=Mac')).link!).protocol).toBe('gospelpresenter:');
    // An account that is not linked gets the error page, and no link.
    const refused = await appSignIn(h, account('Stranger'), 'callback_scheme=gospelpresenter');
    expect([refused.status, refused.link, /data-error="not-linked"/.test(refused.html)]).toEqual([400, null, true]);
  });

  it('replayed: a signed-out token and a used invite are refused', async () => {
    const di = await member('Di', 'user');
    expect((await api(h, 'POST', '/api/auth/signout', as(di))).status).toBe(200);
    expect((await api(h, 'GET', '/api/auth/me', as(di))).status).toBe(401);
    expect((await api(h, 'POST', '/api/sync/pull', { ...as(di), body: pull() })).status).toBe(401);

    expect(await webSignIn(h, account('Other'), { invite: di.inviteToken })).toEqual({ error: 'invite-invalid' });
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: di.inviteToken } })).body).toEqual({ state: 'invalid' });
  });

  it('a new invite is the reset: it links a new Google account in place of the old one and ends the old sessions', async () => {
    const gi = await member('Gi', 'user');
    const invite = await api<{ inviteToken: string }>(h, 'POST', `/api/users/${gi.id}/invites`, as(admin));
    const fresh = account('Gi');
    expect((await webSignIn(h, fresh, { invite: invite.body.inviteToken })).session?.me.userId).toBe(gi.id);
    expect((await api(h, 'GET', '/api/auth/me', as(gi))).status).toBe(401);
    expect(await webSignIn(h, gi.google)).toEqual({ error: 'not-linked' });
  });

  // ------------------------------------------------------------ roles and membership

  it('PERM-A2: a User cannot list, create, change or remove users', async () => {
    const fa = await member('Fa', 'user');
    expect(await api(h, 'GET', '/api/users', as(fa))).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect((await api(h, 'POST', '/api/users', { ...as(fa), body: { name: 'X', email: 'x@x.se', role: 'user' } })).status).toBe(403);
    expect((await api(h, 'PATCH', `/api/users/${fa.id}`, { ...as(fa), body: { role: 'admin' } })).status).toBe(403);
    expect((await api(h, 'DELETE', `/api/users/${admin.me.userId}`, as(fa))).status).toBe(403);
    expect((await api(h, 'POST', `/api/users/${fa.id}/invites`, as(fa))).status).toBe(403);
  });

  it('PERM-R4/R5/R6, D20: an Admin cannot make or touch a SuperAdmin; nobody changes their own role or removes themselves', async () => {
    const gu = await member('Gu', 'admin');
    const refused = (r: { status: number; body: unknown }) => r.body;
    expect(refused(await api(h, 'POST', '/api/users', { ...as(gu), body: { name: 'S', email: 's@x.se', role: 'superAdmin' } }))).toEqual({
      error: 'super-admin-only',
    });
    expect(refused(await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { ...as(gu), body: { role: 'user' } }))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'DELETE', `/api/users/${admin.me.userId}`, as(gu)))).toEqual({ error: 'super-admin-only' });
    // A new invite would let the Admin link their own Google account to the SuperAdmin.
    expect(refused(await api(h, 'POST', `/api/users/${admin.me.userId}/invites`, as(gu)))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'PATCH', `/api/users/${gu.id}`, { ...as(gu), body: { role: 'superAdmin' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { ...as(admin), body: { role: 'admin' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'DELETE', `/api/users/${gu.id}`, as(gu)))).toEqual({ error: 'own-account' });
    expect(await api(h, 'POST', '/api/users', { ...as(gu), body: { name: 'Anna 2', email: 'anna@gmail.com', role: 'user' } })).toEqual({
      status: 409,
      body: { error: 'email-taken' },
    });
    // What the Admin may do: list, and manage Users and Admins.
    const users = await api<UserRow[]>(h, 'GET', '/api/users', as(gu));
    expect(users.body.find((u) => u.id === admin.me.userId)).toMatchObject({ role: 'superAdmin', active: true, invite: null });
  });

  it('demoted: the role is read on every request; the next pull starts over and admin APIs are refused', async () => {
    const ha = await member('Ha', 'admin');
    expect((await api(h, 'GET', '/api/users', as(ha))).status).toBe(200);
    const first = await api<{ cookie: string }>(h, 'POST', '/api/sync/pull', { ...as(ha), body: pull('ha-1') });
    expect(first.status).toBe(200);

    expect((await api(h, 'PATCH', `/api/users/${ha.id}`, { ...as(admin), body: { role: 'user' } })).status).toBe(200);
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(ha))).body.role).toBe('user');
    expect((await api(h, 'GET', '/api/users', as(ha))).status).toBe(403);
    const next = await api<{ clear: boolean }>(h, 'POST', '/api/sync/pull', { ...as(ha), body: { ...pull('ha-1'), cookie: first.body.cookie } });
    expect(next.body.clear).toBe(true); // the role is part of the pull cookie's scope
    const listed = await api<UserRow[]>(h, 'GET', '/api/users', as(admin));
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

    expect((await api(h, 'DELETE', `/api/users/${io.id}`, as(admin))).status).toBe(200);
    expect((await api(h, 'POST', '/api/sync/push', { ...as(io), body: push(client.id, []) })).status).toBe(401);
    await client.sync();
    expect(client.authError).toBe('unauthenticated');
    expect(await client.pending()).toHaveLength(1); // kept, unsynced (D23)
    expect((await dumpOf(admin)).tables.songs.map((s) => s.name)).toContain('Before');
    expect((await dumpOf(admin)).tables.songs.map((s) => s.name)).not.toContain('After removal');
    expect(await webSignIn(h, io.google)).toEqual({ error: 'not-linked' });
    await client.close();
  });

  it('a session whose membership is gone gets 403 not-a-member, and its device stops syncing', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const token = await setRole(h, 'ju', org, 'user');
    expect((await api(h, 'POST', '/api/sync/pull', { token, body: pull() })).status).toBe(200);
    expect((await api(h, 'POST', '/api/debug/membership', { body: { userId: 'ju', orgId: org, role: null } })).status).toBe(200);
    expect(await api(h, 'POST', '/api/sync/pull', { token, body: pull() })).toEqual({ status: 403, body: { error: 'not-a-member' } });
    const client = await SyncClient.open(await openWaSqlite(), { transport: httpTransport({ baseUrl: h.url, token }), ctx: { userId: 'ju', role: 'user' } });
    await client.sync();
    expect(client.authError).toBe('not-a-member');
    await client.close();
  });

  // ------------------------------------------------------------ wrong organisation

  it('wrong organisation: the session decides the organisation; a header or another org\'s user id changes nothing', async () => {
    const other = await setRole(h, 'kay', `org-${crypto.randomUUID()}`, 'admin');
    const r = await api(h, 'POST', '/api/sync/push', {
      token: other,
      headers: { 'x-org': admin.me.orgId, 'x-user': admin.me.userId, 'x-role': 'superAdmin' },
      body: push('kay-1', [{ id: 1, name: 'createSong', v: 1, args: { id: 'KAY', name: 'From another church' } }]),
    });
    expect(r.status).toBe(200);
    expect((await dumpOf(admin)).tables.songs.map((s) => s.id)).not.toContain('KAY');
    // Another organisation's users are not found, let alone changed (PERM-R3, ORG-A5).
    expect((await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { token: other, body: { role: 'user' } })).status).toBe(404);
    expect((await api(h, 'DELETE', `/api/users/${admin.me.userId}`, { token: other })).status).toBe(404);
    expect((await api(h, 'POST', `/api/users/${admin.me.userId}/invites`, { token: other })).status).toBe(404);
    expect((await api<UserRow[]>(h, 'GET', '/api/users', { token: other })).body.map((u) => u.id)).toEqual(['kay']);
  });

  it('a server that is not a desktop host requires no pairing', async () => {
    expect((await api<PairStatus>(h, 'GET', '/api/pair/status')).body).toEqual({ required: false, paired: false, host: false });
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
    expect((await api(h, 'GET', '/api/auth/me', { token })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1700));
    expect((await api(h, 'GET', '/api/auth/me', { token })).status).toBe(401);
    expect((await api(h, 'POST', '/api/sync/pull', { token, body: pull() })).status).toBe(401);
  });
});

describe.each(adapters)('%s adapter, Google not configured', (adapterName) => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName, { setupToken: SETUP_TOKEN });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('nobody can set up or sign in, and the server says why', async () => {
    expect((await api(h, 'GET', '/api/auth/state')).body).toEqual({ setupRequired: true, google: false, passkeys: false });
    expect(await api(h, 'POST', '/api/auth/setup', { body: { setupToken: SETUP_TOKEN, name: 'A', orgName: 'K' } })).toEqual({ status: 503, body: { error: 'google-disabled' } });
    expect((await api(h, 'POST', '/api/auth/google/begin', { body: {} })).body).toEqual({ error: 'google-disabled' });
    const page = await fetch(`${h.url}/api/app-login?callback_scheme=gospelpresenter`, { redirect: 'manual' });
    expect(page.status).toBe(503);
    // The scheme is still checked first.
    expect((await fetch(`${h.url}/api/app-login?callback_scheme=evil`)).status).toBe(400);
  });
});

// ---------------------------------------------------------------- pairing (desktop host, Node only)

describe('desktop host: sign-in only from this machine', () => {
  it('/app-login, the Google callback and the passkey page answer an unpaired browser on loopback, and nothing else', async () => {
    const sql = nodeGlobalSql(openSqlite(':memory:', 'better-sqlite3'));
    await migrateGlobal(sql);
    const accounts = new Accounts(sql);
    for (const [address, open] of [
      ['127.0.0.1', true],
      ['::1', true],
      ['::ffff:127.0.0.1', true],
      ['192.168.1.20', false],
      ['::ffff:192.168.1.20', false],
      ['10.0.0.127', false],
    ] as const) {
      const app = new Hono();
      app.use('*', pairingGuard(accounts, { hostToken: 'gphost_x' }, () => address));
      app.all('*', (c) => c.text('reached'));
      for (const path of ['/api/app-login', '/api/auth/google/start', '/api/auth/google/callback', '/api/auth/app-callback.js', '/api/auth/passkey/start', '/api/auth/passkey/finish', '/api/auth/passkey.js']) {
        expect([address, path, (await app.request(path)).status]).toEqual([address, path, open ? 200 : 403]);
      }
      // The rest of the API needs pairing from anywhere.
      for (const path of ['/api/auth/google/begin', '/api/auth/google/finish', '/api/auth/passkey/begin', '/api/auth/logins', '/api/auth/state', '/api/sync/pull']) {
        expect((await app.request(path)).status).toBe(403);
      }
    }
  });
});

describe.each(['better-sqlite3', 'node:sqlite'] as const)('desktop host pairing, %s', (driver) => {
  const HOST = 'gphost_' + 'h'.repeat(43);
  const HOST_PASSKEY_ORIGIN = 'http://localhost:47800';
  let server: RunningServer;
  let dataDir: string;
  let admin: SignInResponse;
  const anna = account('Anna');
  const host: Harness = { name: 'node', url: '', mediaKeys: async () => [], close: async () => {} };
  const req = <T = unknown>(method: string, path: string, opts: { token?: string; device?: string; body?: unknown } = {}) =>
    api<T>(host, method, path, {
      token: opts.token,
      body: opts.body,
      headers: opts.device ? { 'x-gp-device': opts.device } : {},
    });

  /** The host's own sign-in: its window begins (it holds the host token), the system browser does the rest. */
  async function hostSignIn(who: FakeAccount, invite?: string) {
    const begin = await req<{ url: string }>('POST', '/api/auth/google/begin', { device: HOST, body: { invite, app: { deviceName: 'Värddatorn', callbackScheme: 'gospelpresenter-local' } } });
    expect(begin.status).toBe(200);
    fake.next(who);
    const page = await new TestBrowser().open(host.url + begin.body.url);
    const link = appCallbackLink(page.html);
    expect(link, page.html).toMatch(/^gospelpresenter-local:\/\/auth#token=gpdt_/);
    return new URLSearchParams(new URL(link!).hash.slice(1)).get('token')!;
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'gp-pair-'));
    server = await startNodeServer({
      dataDir,
      driver,
      pairing: { hostToken: HOST },
      setupToken: SETUP_TOKEN,
      google: { clientId: fake.clientId, clientSecret: fake.clientSecret, testIssuer: fake.url },
      passkeys: { rpId: 'localhost', origins: [HOST_PASSKEY_ORIGIN] },
      log: () => undefined,
    });
    host.url = server.url;
    const setup = await req<{ inviteToken: string }>('POST', '/api/auth/setup', { device: HOST, body: { setupToken: SETUP_TOKEN, name: 'Anna', orgName: 'Kyrkan' } });
    expect(setup.status).toBe(200);
    const token = await hostSignIn(anna, setup.body.inviteToken);
    admin = { token, me: (await req<Me>('GET', '/api/auth/me', { device: HOST, token })).body };
    expect(admin.me.role).toBe('superAdmin');
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('an unpaired device is refused everywhere but the pairing itself, also with a valid session token', async () => {
    expect((await req<PairStatus>('GET', '/api/pair/status')).body).toEqual({ required: true, paired: false, host: false });
    expect((await req<PairStatus>('GET', '/api/pair/status', { device: HOST })).body).toEqual({ required: true, paired: true, host: true });
    for (const device of [undefined, 'gppd_forged', 'gphost_' + 'x'.repeat(43)]) {
      expect(await req('GET', '/api/auth/state', { device })).toEqual({ status: 403, body: { error: 'device-not-paired' } });
      expect((await req('POST', '/api/auth/google/begin', { device, body: { app: { deviceName: 'x', callbackScheme: 'gospelpresenter' } } })).status).toBe(403);
      expect((await req('POST', '/api/auth/google/finish', { device, body: {} })).status).toBe(403);
      expect((await req('POST', '/api/sync/pull', { device, token: admin.token, body: pull() })).status).toBe(403);
      expect((await req('GET', '/api/users', { device, token: admin.token })).status).toBe(403);
      expect((await req('POST', '/api/pair/code', { device, token: admin.token })).status).toBe(403);
    }
    const ws = pokeUrl(host) + '?clientId=x';
    expect(await socketOpens(ws, socketProtocols({ token: admin.token }))).toBe(false);
    expect(await socketOpens(ws, socketProtocols({ token: admin.token, device: HOST }))).toBe(true);
  });

  it('only the host window starts a Google sign-in, and only for itself; a paired device signs in by pairing', async () => {
    const { body: code } = await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: {} });
    const paired = await req<PairClaimResponse>('POST', '/api/pair/claim', { body: { code: code.code, name: 'iPad' } });
    const device = paired.body.device;
    expect((await req('POST', '/api/auth/google/begin', { device, body: { app: { deviceName: 'iPad', callbackScheme: 'gospelpresenter' } } })).body).toEqual({ error: 'forbidden' });
    expect((await req('POST', '/api/auth/google/begin', { device: HOST, body: {} })).body).toEqual({ error: 'forbidden' }); // a web sign-in
    // The host signs in again with its linked Google account (no invite), in the system browser.
    const again = await hostSignIn(anna);
    expect((await req<Me>('GET', '/api/auth/me', { device: HOST, token: again })).body.userId).toBe(admin.me.userId);
  });

  it('passkeys on the host: only its window begins, through the system browser; a paired device neither begins nor manages logins', async () => {
    const auth = new SoftAuthenticator(HOST_PASSKEY_ORIGIN);
    const app = { deviceName: 'Värddatorn', callbackScheme: 'gospelpresenter-local' };
    // In the system browser: the page, then the credential, with this browser's cookie.
    async function inBrowser(url: string, create: boolean) {
      const browser = new TestBrowser();
      const page = await browser.open(host.url + url);
      const options = JSON.parse(/data-options="([^"]*)"/.exec(page.html)![1]!.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))));
      const credential = create ? await auth.create(options.create) : await auth.get(options.get);
      const res = await browser.fetch(`${host.url}/api/auth/passkey/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
      return { status: res.status, body: (await res.json()) as { callback?: string; done?: true; error?: string } };
    }
    // The host window, signed in as Anna, adds a passkey for herself.
    const add = await req<{ url: string }>('POST', '/api/auth/passkey/begin', { device: HOST, token: admin.token, body: { mode: 'register', app } });
    expect(add.body.url).toMatch(/^\/api\/auth\/passkey\/start\?flow=/);
    expect(await inBrowser(add.body.url, true)).toEqual({ status: 200, body: { done: true } });
    // Then signs in with it: the app gets its token on its callback scheme.
    const signin = await req<{ url: string }>('POST', '/api/auth/passkey/begin', { device: HOST, body: { mode: 'signin', app } });
    const done = await inBrowser(signin.body.url, false);
    expect(done.body.callback).toMatch(/^gospelpresenter-local:\/\/auth#token=gpdt_/);
    // A web ceremony (no app) is refused on a host, as for Google.
    expect((await req('POST', '/api/auth/passkey/begin', { device: HOST, body: { mode: 'signin' } })).body).toEqual({ error: 'forbidden' });

    // A paired device: refused before anything, and its session cannot add or remove Anna's logins.
    const { body: code } = await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: {} });
    const paired = await req<PairClaimResponse>('POST', '/api/pair/claim', { body: { code: code.code, name: 'iPad' } });
    const { device, session } = paired.body;
    expect((await req('POST', '/api/auth/passkey/begin', { device, token: session.token, body: { mode: 'register', app } })).body).toEqual({ error: 'forbidden' });
    expect((await req('POST', '/api/auth/passkey/begin', { device: HOST, token: session.token, body: { mode: 'register', app } })).body).toEqual({ error: 'forbidden' });
    const mine = await req<{ provider: string; id: string }[]>('GET', '/api/auth/logins', { device, token: session.token });
    expect(mine.body.map((l) => l.provider)).toEqual(['google', 'passkey']);
    expect((await req('DELETE', `/api/auth/logins/passkey/${mine.body[1]!.id}`, { device, token: session.token })).body).toEqual({ error: 'forbidden' });
    expect((await req('DELETE', `/api/auth/logins/passkey/${mine.body[1]!.id}`, { device: HOST, token: admin.token })).status).toBe(200);
  });

  it('a code pairs one device once, signed in as the member the host chose; disconnecting it ends its session', async () => {
    expect((await req('POST', '/api/pair/code', { device: HOST })).status).toBe(401);
    const created = await req<{ id: string }>('POST', '/api/users', { device: HOST, token: admin.token, body: { name: 'Bo', email: 'bo@x.se', role: 'admin' } });
    const { body: code } = await req<{ code: string; expiresAt: number }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: created.body.id } });
    expect(code.code).toMatch(/^\d{6}$/);

    const claim = (c: string) => req<PairClaimResponse>('POST', '/api/pair/claim', { body: { code: c, name: 'iPad i koret' } });
    const paired = await claim(code.code);
    expect(paired.status).toBe(200);
    const { device, session } = paired.body;
    expect(device).toMatch(/^gppd_[\w-]{43}$/);
    expect(session.me).toMatchObject({ userId: created.body.id, name: 'Bo', role: 'admin' });
    expect(await claim(code.code)).toEqual({ status: 400, body: { error: 'pair-code-invalid' } }); // replayed

    // The paired device syncs as Bo, but cannot make codes for others: that is the host's.
    expect((await req('POST', '/api/sync/pull', { device, token: session.token, body: pull('ipad') })).status).toBe(200);
    expect((await req('POST', '/api/pair/code', { device, token: session.token, body: {} })).status).toBe(403);

    // Bo, an Admin at the host, may not pair a device as the SuperAdmin (D20, D21); nor anyone outside the church.
    const bo = await req<PairClaimResponse>('POST', '/api/pair/claim', {
      body: { code: (await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: created.body.id } })).body.code, name: 'Host as Bo' },
    });
    expect((await req('POST', '/api/pair/code', { device: HOST, token: bo.body.session.token, body: { userId: admin.me.userId } })).body).toEqual({ error: 'super-admin-only' });
    expect((await req('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: 'someone-else' } })).status).toBe(404);

    // Disconnecting the device on the host refuses it at once, and its session is over too.
    const devices = await req<{ id: string; name: string }[]>('GET', '/api/pair/devices', { device: HOST, token: admin.token });
    const ipad = devices.body.find((d) => d.name === 'iPad i koret')!;
    expect((await req('DELETE', `/api/pair/devices/${ipad.id}`, { device: HOST, token: admin.token })).status).toBe(200);
    expect((await req('POST', '/api/sync/pull', { device, token: session.token, body: pull('ipad') })).body).toEqual({ error: 'device-not-paired' });
    expect((await req('GET', '/api/auth/me', { device: HOST, token: session.token })).status).toBe(401);
  });

  it('a User at the host cannot make codes; five wrong guesses kill the code; a removed user\'s code pairs nothing', async () => {
    const created = await req<{ id: string }>('POST', '/api/users', { device: HOST, token: admin.token, body: { name: 'Cy', email: 'cy@x.se', role: 'user' } });
    const asCy = await req<PairClaimResponse>('POST', '/api/pair/claim', {
      body: { code: (await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: created.body.id } })).body.code, name: 'Cy' },
    });
    expect((await req('POST', '/api/pair/code', { device: HOST, token: asCy.body.session.token, body: {} })).status).toBe(403);

    const { body: code } = await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: {} });
    const wrong = code.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await req('POST', '/api/pair/claim', { body: { code: wrong, name: 'guess' } })).status).toBe(400);
    expect((await req('POST', '/api/pair/claim', { body: { code: code.code, name: 'too late' } })).status).toBe(400);

    const forCy = await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: created.body.id } });
    expect((await req('DELETE', `/api/users/${created.body.id}`, { device: HOST, token: admin.token })).status).toBe(200);
    expect((await req('POST', '/api/pair/claim', { body: { code: forCy.body.code, name: 'Cy again' } })).body).toEqual({ error: 'pair-code-invalid' });
  });
});
