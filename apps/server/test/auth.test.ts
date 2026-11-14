// Sign-in, sessions and membership over HTTP, against Node (both drivers)
// and Workers (D1 + Durable Objects in workerd), with a fake Google in this
// process. Security first: every way a request should be refused is tried.
// The desktop host, where pairing is how devices sign in, is in host-auth.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SCHEMA_VERSION, type AuthState, type LoginMethod, type Me, type PairStatus, type SignInResponse, type UserRow } from '@gp/core';
import { SyncClient, httpTransport, socketProtocols } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { nodeRustCore } from '@gp/rust-core/node';
import { api, invite, pokeUrl, setRole, startAdapter, type AdapterName, type Harness, type ServerDump } from './harness.ts';
import { appCallbackLink, startFakeGoogle, TestBrowser, type FakeAccount, type FakeGoogle, type Tamper } from './fake-google.ts';

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
  // Begun in the browser itself, as the page does: the flow is bound to it then.
  const res0 = await browser.fetch(`${h.url}/api/auth/google/begin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.invite ? { invite: opts.invite } : {}) });
  const begin = { status: res0.status, body: (await res0.json()) as { url: string; error?: string } };
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

/** A JSON POST's options, for a TestBrowser's fetch. */
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

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

  /** Someone an admin invited, who made their account with Google and is signed in. */
  async function member(name: string, role: 'user' | 'admin', by = admin) {
    const inv = await invite(h, by, role);
    const google = account(name);
    const r = await webSignIn(h, google, { invite: inv.token });
    expect(r.error).toBeUndefined();
    return { ...r.session!, id: r.session!.me.userId, email: r.session!.me.email!, google, inviteToken: inv.token };
  }

  /** Turns superadminläge on or off for `who`'s session. */
  const superMode = async (who: { token: string }, on: boolean) =>
    expect((await api(h, 'POST', '/api/auth/superadmin', { ...as(who), body: { on } })).status).toBe(200);

  // ------------------------------------------------------------ first run (runs first: no user may exist yet)

  it('AUTH-A1/D19: setup needs the setup token, answers with an invite, and is done once its Superadmin linked Google', async () => {
    expect(await api(h, 'GET', '/api/auth/state')).toEqual({ status: 200, body: { setupRequired: true, google: true, passkeys: false, mail: false } satisfies AuthState });
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
    // An Admin of her church, with the Superadmin mark; Google vouches for her address.
    expect(r.session?.me).toMatchObject({ name: 'Anna', email: 'anna@gmail.com', emailConfirmed: true, role: 'admin', superAdmin: true, superUntil: null, orgName: 'Lilla Kyrkan' });
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
      const inv = await invite(h, admin);
      const before = await counts(h);
      expect(await webSignIn(h, account('T'), { invite: inv.token, tamper })).toEqual({ error: 'google-failed' });
      expect((await counts(h)).sessions).toBe(before.sessions);
      expect((await counts(h)).user_logins).toBe(before.user_logins);
      expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: inv.token } })).body).toMatchObject({ state: 'valid', kind: 'join' });
    },
  );

  it('state: a callback with a forged state, from another browser, or replayed is refused; the page collects its session once', async () => {
    const google = (await member('Ce', 'user')).google;
    // Forged state, in a browser that has started nothing.
    const forged = await new TestBrowser().open(`${h.url}/api/auth/google/callback?state=forged&code=x`);
    expect([forged.status, /data-error="google-failed"/.test(forged.html)]).toEqual([400, true]);

    // A flow begun in one browser, finished in another (login CSRF): refused.
    const starter = new TestBrowser();
    const begin = { body: (await (await starter.fetch(`${h.url}/api/auth/google/begin`, json({}))).json()) as { url: string } };
    fake.next(google);
    const toGoogle = await starter.fetch(h.url + begin.body.url);
    const back = await fetch(toGoogle.headers.get('location')!, { redirect: 'manual' });
    const callback = back.headers.get('location')!;
    const other = await new TestBrowser().open(callback);
    expect(other.status).toBe(400);
    // Another browser cannot start it either.
    expect((await new TestBrowser().open(h.url + begin.body.url)).status).toBe(400);

    // The right browser, once; the same callback again is a replay.
    const browser = new TestBrowser();
    const b2 = { body: (await (await browser.fetch(`${h.url}/api/auth/google/begin`, json({}))).json()) as { url: string } };
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

  it('an invitation opened with a Google account someone has: that account gains the membership and nothing else', async () => {
    const dag = await member('Dag', 'user');
    const org = `org-${crypto.randomUUID()}`;
    const other = await setRole(h, `ot-${crypto.randomUUID()}`, org, 'admin');
    const inv = await invite(h, { token: other }, 'user', `eva-${crypto.randomUUID().slice(0, 6)}@x.se`);
    const r = await webSignIn(h, dag.google, { invite: inv.token });
    expect(r.session?.me).toMatchObject({ userId: dag.id, orgId: org, role: 'user', email: dag.email });
    // Dag's own sign-in, address and session are as they were.
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(dag))).body).toMatchObject({ orgId: admin.me.orgId, email: dag.email });
    expect((await webSignIn(h, dag.google)).session?.me.userId).toBe(dag.id);
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

  it('replayed: a signed-out token and a used invitation are refused', async () => {
    const di = await member('Di', 'user');
    expect((await api(h, 'POST', '/api/auth/signout', as(di))).status).toBe(200);
    expect((await api(h, 'GET', '/api/auth/me', as(di))).status).toBe(401);
    expect((await api(h, 'POST', '/api/sync/pull', { ...as(di), body: pull() })).status).toBe(401);

    expect(await webSignIn(h, account('Other'), { invite: di.inviteToken })).toEqual({ error: 'invite-invalid' });
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: di.inviteToken } })).body).toEqual({ state: 'invalid' });
  });

  it('a reset link, only from a Superadmin in superadminläge: it links a new Google account in place of the old one and ends the old sessions', async () => {
    const gi = await member('Gi', 'user');
    expect(await api(h, 'POST', `/api/users/${gi.id}/invites`, as(admin))).toEqual({ status: 403, body: { error: 'super-admin-only' } });
    await superMode(admin, true);
    const reset = await api<{ inviteToken: string }>(h, 'POST', `/api/users/${gi.id}/invites`, as(admin));
    await superMode(admin, false);
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: reset.body.inviteToken } })).body).toMatchObject({ state: 'valid', kind: 'reset', name: 'Gi' });
    const fresh = account('Gi');
    expect((await webSignIn(h, fresh, { invite: reset.body.inviteToken })).session?.me.userId).toBe(gi.id);
    expect((await api(h, 'GET', '/api/auth/me', as(gi))).status).toBe(401);
    expect(await webSignIn(h, gi.google)).toEqual({ error: 'not-linked' });
  });

  // ------------------------------------------------------------ taking over someone else's account (docs/accounts-and-roles.md, "Why")

  it('an Admin of another organisation who invites a person\'s address gets an invitation, never their account', async () => {
    const eveOrg = `org-${crypto.randomUUID()}`;
    const eve = await setRole(h, `eve-${crypto.randomUUID()}`, eveOrg, 'admin');
    const inv = await invite(h, { token: eve }, 'user', 'anna@gmail.com');
    // Anna is not made a member, and the list shows only the address.
    expect((await api<UserRow[]>(h, 'GET', '/api/users', { token: eve })).body.map((u) => u.email)).not.toContain('anna@gmail.com');
    expect((await api<{ email: string }[]>(h, 'GET', '/api/invitations', { token: eve })).body).toEqual([expect.objectContaining({ email: 'anna@gmail.com', role: 'user' })]);
    // Eve opens the link with a Google account of her own: a new account, not Anna's.
    const evesGoogle = account('Eve');
    const r = await webSignIn(h, evesGoogle, { invite: inv.token });
    expect(r.session?.me.userId).not.toBe(admin.me.userId);
    expect(r.session?.me).toMatchObject({ email: 'eve@gmail.com', emailConfirmed: true, orgId: eveOrg });
    // Anna keeps her logins and her session.
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(admin))).status).toBe(200);
    expect((await api<LoginMethod[]>(h, 'GET', '/api/auth/logins', as(admin))).body).toHaveLength(1);
  });

  it("a web sign-in begun in one browser does not go on in another: an invitation's link cannot make someone else's account join", async () => {
    const eveOrg = `org-${crypto.randomUUID()}`;
    const eve = await setRole(h, `eve-${crypto.randomUUID()}`, eveOrg, 'admin');
    const inv = await invite(h, { token: eve });
    const evesBrowser = new TestBrowser();
    const begun = await evesBrowser.fetch(`${h.url}/api/auth/google/begin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: inv.token }) });
    const { url } = (await begun.json()) as { url: string };
    const victim = await member('Vi', 'user');

    fake.next(victim.google);
    const end = await new TestBrowser().open(h.url + url);

    expect(where(end.url)).not.toBe('/signed-in');
    expect((await api<UserRow[]>(h, 'GET', '/api/users', { token: eve })).body.map((u) => u.id)).not.toContain(victim.id);
  });

  it('an Admin cannot change a member\'s address, and a 1.x import links no Google id to an existing account', async () => {
    const eveOrg = `org-${crypto.randomUUID()}`;
    const eve = await setRole(h, `eve-${crypto.randomUUID()}`, eveOrg, 'admin');
    const ok = await member('Okke', 'user');
    expect(await api(h, 'PATCH', `/api/users/${ok.id}`, { ...as(await member('Ad', 'admin')), body: { email: 'eve@evil.se' } })).toEqual({
      status: 403,
      body: { error: 'super-admin-only' },
    });
    expect((await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { token: eve, body: { email: 'eve@evil.se' } })).status).toBe(404);
    // The import invites Anna's address with Eve's Google id: signing in with it makes Eve a new account.
    const evesGoogle = account('Eve');
    const imported = await api(h, 'POST', '/api/import/users', { token: eve, body: [{ name: 'Anna', email: 'anna@gmail.com', role: 'admin', google: [evesGoogle.sub] }] });
    expect(imported.body).toEqual({ created: 0, member: 0, kept: 0, invited: 1, limit: 0 });
    const r = await webSignIn(h, evesGoogle);
    expect(r.session?.me.userId).not.toBe(admin.me.userId);
    expect(r.session?.me).toMatchObject({ orgId: eveOrg, role: 'admin', email: 'eve@gmail.com' });
    expect((await api<LoginMethod[]>(h, 'GET', '/api/auth/logins', as(admin))).body.map((l) => l.id)).not.toContain(evesGoogle.sub);
  });

  // ------------------------------------------------------------ roles and membership

  it('PERM-A2: a User cannot list, invite, change or remove users', async () => {
    const fa = await member('Fa', 'user');
    expect(await api(h, 'GET', '/api/users', as(fa))).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect((await api(h, 'GET', '/api/invitations', as(fa))).status).toBe(403);
    expect((await api(h, 'POST', '/api/invitations', { ...as(fa), body: { email: 'x@x.se', role: 'user' } })).status).toBe(403);
    expect((await api(h, 'PATCH', `/api/users/${fa.id}`, { ...as(fa), body: { role: 'admin' } })).status).toBe(403);
    expect((await api(h, 'DELETE', `/api/users/${admin.me.userId}`, as(fa))).status).toBe(403);
    expect((await api(h, 'POST', `/api/users/${fa.id}/invites`, as(fa))).status).toBe(403);
  });

  it('PERM-R5/R6: an Admin sets roles and removes members, never their own; someone else\'s account is a Superadmin\'s', async () => {
    const gu = await member('Gu', 'admin');
    const refused = (r: { status: number; body: unknown }) => r.body;
    // A link that replaces the logins, the logins themselves, the name: the account is the person's.
    expect(refused(await api(h, 'POST', `/api/users/${admin.me.userId}/invites`, as(gu)))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'GET', `/api/users/${admin.me.userId}/logins`, as(gu)))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { ...as(gu), body: { name: 'Not Anna' } }))).toEqual({ error: 'super-admin-only' });
    expect(refused(await api(h, 'PATCH', `/api/users/${gu.id}`, { ...as(gu), body: { role: 'user' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'PATCH', `/api/users/${admin.me.userId}`, { ...as(admin), body: { role: 'user' } }))).toEqual({ error: 'own-role' });
    expect(refused(await api(h, 'DELETE', `/api/users/${gu.id}`, as(gu)))).toEqual({ error: 'own-account' });
    // People are invited; only a desktop host makes them directly.
    expect(await api(h, 'POST', '/api/users', { ...as(gu), body: { name: 'X', role: 'user' } })).toEqual({ status: 403, body: { error: 'forbidden' } });
    // 'superAdmin' is no role to give.
    expect((await api(h, 'POST', '/api/invitations', { ...as(gu), body: { email: 's@x.se', role: 'superAdmin' } })).status).toBe(400);
    // An address a member here has: the Admin sees it in the list already.
    expect(await api(h, 'POST', '/api/invitations', { ...as(gu), body: { email: 'anna@gmail.com', role: 'user' } })).toEqual({ status: 409, body: { error: 'email-taken' } });
    const users = await api<UserRow[]>(h, 'GET', '/api/users', as(gu));
    expect(users.body.find((u) => u.id === admin.me.userId)).toMatchObject({ role: 'admin', superAdmin: true, active: true, invite: null });
  });

  it('an organisation always has at least one Admin: the last one is neither made a User nor removed', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const solo = `solo-${crypto.randomUUID()}`;
    await setRole(h, solo, org, 'admin');
    const boss = await setRole(h, `boss-${crypto.randomUUID()}`, `org-${crypto.randomUUID()}`, 'superAdmin');
    const there = await api<SignInResponse>(h, 'POST', '/api/auth/switch', { token: boss, body: { orgId: org } });
    expect(there.body.me.role).toBe('superAdmin');
    expect(await api(h, 'PATCH', `/api/users/${solo}`, { token: there.body.token, body: { role: 'user' } })).toEqual({ status: 403, body: { error: 'last-admin' } });
    expect(await api(h, 'DELETE', `/api/users/${solo}`, { token: there.body.token })).toEqual({ status: 403, body: { error: 'last-admin' } });
    // With a second Admin, either may go.
    await setRole(h, `second-${crypto.randomUUID()}`, org, 'admin');
    expect((await api(h, 'PATCH', `/api/users/${solo}`, { token: there.body.token, body: { role: 'user' } })).status).toBe(200);
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
      core: nodeRustCore(),
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
    const client = await SyncClient.open(await openWaSqlite(), { transport: httpTransport({ baseUrl: h.url, token }), ctx: { userId: 'ju', role: 'user' }, core: nodeRustCore() });
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

  // ------------------------------------------------------------ the user detail page (/admin/users/{id})

  it('one user: an admin reads them as the list shows them; a User is refused and another organisation finds no one', async () => {
    const ka = await member('Ka', 'user');
    const other = await setRole(h, `ko-${crypto.randomUUID()}`, `org-${crypto.randomUUID()}`, 'admin');
    expect(await api(h, 'GET', `/api/users/${ka.id}`, as(admin))).toEqual({
      status: 200,
      body: { id: ka.id, name: 'Ka', email: 'ka@gmail.com', role: 'user', active: true, invite: null, onlyHere: true, superAdmin: false } satisfies UserRow,
    });
    expect((await api(h, 'GET', `/api/users/${ka.id}`, as(ka))).status).toBe(403);
    expect(await api(h, 'GET', `/api/users/${ka.id}`, { token: other })).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('name and e-mail: a Superadmin in superadminläge changes them; an address set so is unconfirmed', async () => {
    const la = await member('La', 'user');
    expect(await api(h, 'PATCH', `/api/users/${la.id}`, { ...as(admin), body: { name: 'Lars' } })).toEqual({ status: 403, body: { error: 'super-admin-only' } });
    await superMode(admin, true);
    expect((await api(h, 'PATCH', `/api/users/${la.id}`, { ...as(admin), body: { name: 'Lars', email: 'Lars@X.se' } })).status).toBe(200);
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(la))).body).toMatchObject({ name: 'Lars', email: 'lars@x.se', emailConfirmed: false });
    expect(await api(h, 'PATCH', `/api/users/${la.id}`, { ...as(admin), body: { email: 'inte-en-adress' } })).toEqual({ status: 400, body: { error: 'invalid-request' } });
    expect(await api(h, 'PATCH', `/api/users/${la.id}`, { ...as(admin), body: { name: '  ' } })).toEqual({ status: 400, body: { error: 'invalid-request' } });
    expect((await api(h, 'PATCH', `/api/users/${la.id}`, { ...as(admin), body: { email: null } })).status).toBe(200);
    await superMode(admin, false);
    expect((await api<UserRow>(h, 'GET', `/api/users/${la.id}`, as(admin))).body).toMatchObject({ name: 'Lars', email: null });
  });

  it('your own name and address under Mina inställningar; without mail an address is set at once, unconfirmed', async () => {
    const mu = await member('Mu', 'user');
    expect(await api(h, 'PATCH', '/api/auth/me', { ...as(mu), body: { name: ' Mumin ' } })).toEqual({ status: 200, body: { ok: true } });
    expect(await api(h, 'POST', '/api/auth/email', { ...as(mu), body: { email: 'Mumin@Dalen.se' } })).toEqual({ status: 200, body: { changed: true } });
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(mu))).body).toMatchObject({ name: 'Mumin', email: 'mumin@dalen.se', emailConfirmed: false });
    // Anna's confirmed address on another account stays unconfirmed there, and Anna's is untouched.
    expect((await api(h, 'POST', '/api/auth/email', { ...as(mu), body: { email: 'anna@gmail.com' } })).status).toBe(200);
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(mu))).body).toMatchObject({ email: 'anna@gmail.com', emailConfirmed: false });
    expect((await api<Me>(h, 'GET', '/api/auth/me', as(admin))).body).toMatchObject({ email: 'anna@gmail.com', emailConfirmed: true });
    expect((await api(h, 'PATCH', '/api/auth/me', { body: { name: 'X' } })).status).toBe(401);
  });

  it('logins: a Superadmin in superadminläge lists a user\'s and removes one, the last too, after which they cannot sign in', async () => {
    const na = await member('Na', 'user');
    await superMode(admin, true);
    const logins = await api<LoginMethod[]>(h, 'GET', `/api/users/${na.id}/logins`, as(admin));
    expect(logins.body).toEqual([expect.objectContaining({ provider: 'google', id: na.google.sub })]);
    expect((await api(h, 'DELETE', `/api/users/${na.id}/logins/google/${encodeURIComponent(na.google.sub)}`, as(admin))).status).toBe(200);
    expect((await api(h, 'GET', `/api/users/${na.id}/logins`, as(admin))).body).toEqual([]);
    await superMode(admin, false);
    expect((await api<UserRow>(h, 'GET', `/api/users/${na.id}`, as(admin))).body.active).toBe(false);
    expect(await webSignIn(h, na.google)).toEqual({ error: 'not-linked' });
  });

  it('logins: a User and an Admin are refused someone else\'s, nobody removes their own last; another organisation finds no one', async () => {
    const oa = await member('Oa', 'admin');
    const ou = await member('Ou', 'user');
    const other = await setRole(h, `oo-${crypto.randomUUID()}`, `org-${crypto.randomUUID()}`, 'admin');
    const path = (id: string, l: { google: FakeAccount }) => `/api/users/${id}/logins/google/${encodeURIComponent(l.google.sub)}`;
    expect(await api(h, 'GET', `/api/users/${ou.id}/logins`, as(ou))).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect(await api(h, 'GET', `/api/users/${ou.id}/logins`, as(oa))).toEqual({ status: 403, body: { error: 'super-admin-only' } });
    expect(await api(h, 'DELETE', path(oa.id, oa), as(ou))).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect(await api(h, 'DELETE', path(ou.id, ou), as(oa))).toEqual({ status: 403, body: { error: 'super-admin-only' } });
    expect(await api(h, 'DELETE', path(oa.id, oa), as(oa))).toEqual({ status: 409, body: { error: 'last-login' } });
    expect(await api(h, 'GET', `/api/users/${ou.id}/logins`, { token: other })).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(await api(h, 'DELETE', path(ou.id, ou), { token: other })).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('invitations: an admin lists and withdraws one, and its link stops working; a User is refused, another organisation finds nothing', async () => {
    const pu = await member('Pu', 'user');
    const other = await setRole(h, `po-${crypto.randomUUID()}`, `org-${crypto.randomUUID()}`, 'admin');
    const inv = await invite(h, admin, 'user', `pa-${crypto.randomUUID().slice(0, 6)}@x.se`);
    // A second invitation to the same address replaces the first.
    const again = await invite(h, admin, 'user', inv.email);
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: inv.token } })).body).toEqual({ state: 'invalid' });
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: again.token } })).body).toEqual({ state: 'valid', kind: 'join', orgName: 'Lilla Kyrkan', email: inv.email });
    expect((await api<{ id: string; email: string }[]>(h, 'GET', '/api/invitations', as(admin))).body.filter((i) => i.email === inv.email)).toHaveLength(1);
    expect((await api(h, 'DELETE', `/api/invitations/${again.id}`, as(pu))).status).toBe(403);
    expect(await api(h, 'DELETE', `/api/invitations/${again.id}`, { token: other })).toEqual({ status: 404, body: { error: 'not-found' } });
    expect(await api(h, 'DELETE', `/api/invitations/${again.id}`, as(admin))).toEqual({ status: 200, body: { ok: true } });
    expect((await api(h, 'POST', '/api/auth/invites/lookup', { body: { token: again.token } })).body).toEqual({ state: 'invalid' });
  });

  it('superadminläge: off after sign-in; on, a Superadmin sees every organisation; off again, they are what their membership says', async () => {
    expect((await api(h, 'GET', '/api/orgs', as(admin))).status).toBe(403);
    const off = await api<Me>(h, 'GET', '/api/auth/me', as(admin));
    expect(off.body).toMatchObject({ role: 'admin', superAdmin: true, superUntil: null });
    const on = await api<{ me: Me }>(h, 'POST', '/api/auth/superadmin', { ...as(admin), body: { on: true } });
    expect(on.body.me).toMatchObject({ role: 'superAdmin', superUntil: expect.any(Number) });
    expect(on.body.me.superUntil! - Date.now()).toBeGreaterThan(59 * 60_000);
    expect((await api(h, 'GET', '/api/orgs', as(admin))).status).toBe(200);
    // Visiting a church one is no member of, and coming home when it is turned off there.
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, `vi-${crypto.randomUUID()}`, org, 'admin');
    expect((await api<{ id: string }[]>(h, 'GET', '/api/auth/orgs', as(admin))).body.map((o) => o.id)).toContain(org);
    const there = await api<SignInResponse>(h, 'POST', '/api/auth/switch', { ...as(admin), body: { orgId: org } });
    expect(there.body.me).toMatchObject({ orgId: org, role: 'superAdmin' });
    const home = await api<{ token: string; me: Me }>(h, 'POST', '/api/auth/superadmin', { token: there.body.token, body: { on: false } });
    expect(home.body.me).toMatchObject({ orgId: admin.me.orgId, role: 'admin', superUntil: null });
    expect((await api(h, 'GET', '/api/auth/me', { token: there.body.token })).status).toBe(401);
    await superMode(admin, false);
    expect((await api<{ id: string }[]>(h, 'GET', '/api/auth/orgs', as(admin))).body.map((o) => o.id)).not.toContain(org);
    // Nobody without the mark turns it on.
    const ro = await member('Ro', 'admin');
    expect(await api(h, 'POST', '/api/auth/superadmin', { ...as(ro), body: { on: true } })).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  it('a server that is not a desktop host requires no pairing', async () => {
    expect((await api<PairStatus>(h, 'GET', '/api/pair/status')).body).toEqual({ required: false, paired: false, host: false, dev: false });
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
    await new Promise((r) => setTimeout(r, 1700)); // past the harness's idle time, on the server's own clock
    expect((await api(h, 'GET', '/api/auth/me', { token })).status).toBe(401);
    expect((await api(h, 'POST', '/api/sync/pull', { token, body: pull() })).status).toBe(401);
  });
});

describe.each(adapters)('%s adapter, a session that is no longer fresh', (adapterName) => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName, { freshSignInMs: 1000 });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it("an Admin's import of users needs a fresh sign-in, as making an Admin does: a stale session links no Google account", async () => {
    const token = await setRole(h, 'stale-admin', 'org-stale', 'admin');
    await new Promise((r) => setTimeout(r, 1200)); // past the harness's fresh sign-in time, on the server's own clock

    const r = await api(h, 'POST', '/api/import/users', { token, body: [{ name: 'Eve', email: 'eve@evil.se', role: 'admin', google: ['sub-eve'] }] });

    expect(r).toEqual({ status: 403, body: { error: 'reauth-required' } });
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
    expect((await api(h, 'GET', '/api/auth/state')).body).toEqual({ setupRequired: true, google: false, passkeys: false, mail: false });
    expect(await api(h, 'POST', '/api/auth/setup', { body: { setupToken: SETUP_TOKEN, name: 'A', orgName: 'K' } })).toEqual({ status: 503, body: { error: 'google-disabled' } });
    expect((await api(h, 'POST', '/api/auth/google/begin', { body: {} })).body).toEqual({ error: 'google-disabled' });
    const page = await fetch(`${h.url}/api/app-login?callback_scheme=gospelpresenter`, { redirect: 'manual' });
    expect(page.status).toBe(503);
    // The scheme is still checked first.
    expect((await fetch(`${h.url}/api/app-login?callback_scheme=evil`)).status).toBe(400);
  });
});

// ---------------------------------------------------------------- pairing (desktop host, Node only)
