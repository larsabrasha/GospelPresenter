// Passkeys over HTTP, against Node (both drivers) and Workers, with a
// software authenticator in this process (test/soft-authenticator.ts) and the
// fake Google. Security first: every way a ceremony should be refused is
// tried, and both kinds of login on one user.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthState, LoginMethod, Me, PasskeyBeginResponse, PasskeyCreationOptions, PasskeyCredentialJson, PasskeyRequestOptions, SignInResponse } from '@gp/core';
import { api, startAdapter, type AdapterName, type Harness } from './harness.ts';
import { appCallbackLink, startFakeGoogle, TestBrowser, type FakeAccount, type FakeGoogle } from './fake-google.ts';
import { b64url, SoftAuthenticator, type Alg, type Spoil } from './soft-authenticator.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];
const SETUP_TOKEN = 'gpst_the-setup-token-for-tests';
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:47811';

let fake: FakeGoogle;
beforeAll(async () => {
  fake = await startFakeGoogle();
});
afterAll(() => fake?.close());

const googleAccount = (name: string): FakeAccount => ({ sub: `${name}-${crypto.randomUUID()}`, email: `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@gmail.com`, name });
const key = (opts: { alg?: Alg; counter?: 'increment' | 'none'; fmt?: 'none' | 'packed' } = {}) => new SoftAuthenticator(ORIGIN, opts);

/** The options embedded in a server-rendered passkey page (the system browser's). */
function pageOptions(html: string): { create?: PasskeyCreationOptions; get?: PasskeyRequestOptions } {
  const m = /data-options="([^"]*)"/.exec(html);
  if (!m) throw new Error(`no passkey options in: ${html.slice(0, 300)}`);
  return JSON.parse(m[1]!.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))));
}

describe.each(adapters)('%s adapter, passkeys', (adapterName) => {
  let h: Harness;
  let admin: SignInResponse; // the SuperAdmin, who set up with a passkey
  let adminKey: SoftAuthenticator;

  beforeAll(async () => {
    h = await startAdapter(adapterName, { setupToken: SETUP_TOKEN, google: fake, passkeys: { rpId: RP_ID, origins: [ORIGIN] } });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  const json = (body: unknown, token?: string) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  async function begin(browser: TestBrowser, body: object, token?: string) {
    const res = await browser.fetch(`${h.url}/auth/passkey/begin`, json(body, token));
    return { status: res.status, body: (await res.json()) as PasskeyBeginResponse & { error?: string } };
  }

  async function finish<T = SignInResponse>(browser: TestBrowser, credential: PasskeyCredentialJson, deviceName = 'Testdator') {
    const res = await browser.fetch(`${h.url}/auth/passkey/finish`, json({ credential, deviceName }));
    return { status: res.status, body: (await res.json()) as T & { error?: string } };
  }

  /** Makes a passkey on `auth`: for an invite, or for the session `token`. */
  async function register<T = SignInResponse>(auth: SoftAuthenticator, body: { invite?: string; name?: string }, opts: { token?: string; spoil?: Spoil } = {}) {
    const browser = new TestBrowser();
    const b = await begin(browser, { mode: 'register', ...body }, opts.token);
    if (b.status !== 200 || !('options' in b.body) || !('create' in b.body.options)) return { status: b.status, body: b.body as unknown as T & { error?: string } };
    return finish<T>(browser, await auth.create(b.body.options.create, opts.spoil));
  }

  /** Signs in with whichever passkey `auth` has for the RP ID (the newest, or `pick`). */
  async function signIn(auth: SoftAuthenticator, opts: { spoil?: Spoil; pick?: string } = {}) {
    const browser = new TestBrowser();
    const b = await begin(browser, { mode: 'signin' });
    if (!('options' in b.body) || !('get' in b.body.options)) throw new Error(JSON.stringify(b.body));
    return finish(browser, await auth.get(b.body.options.get, opts.spoil, opts.pick));
  }

  /** A web Google sign-in (as in auth.test.ts), optionally linking to `link`'s session instead. */
  async function google(who: FakeAccount, opts: { invite?: string; link?: string } = {}) {
    const browser = new TestBrowser();
    const begun = await api<{ url: string; error?: string }>(h, 'POST', '/auth/google/begin', {
      token: opts.link,
      body: opts.invite ? { invite: opts.invite } : opts.link ? { link: true } : {},
    });
    if (begun.status !== 200) return { error: begun.body.error!, hash: '' };
    fake.next(who);
    const end = await browser.open(h.url + begun.body.url);
    const hash = new URL(end.url).hash;
    if (hash !== '#/signed-in') return { error: /error=([\w-]+)/.exec(hash)?.[1] ?? null, hash };
    const res = await browser.fetch(`${h.url}/auth/google/finish`, json({ deviceName: 'Browser' }));
    return { session: (await res.json()) as SignInResponse, hash };
  }

  const counts = async () => (await api<Record<string, number>>(h, 'GET', '/debug/counts')).body;
  const logins = async (token: string) => (await api<LoginMethod[]>(h, 'GET', '/auth/logins', { token })).body;

  /** An admin-made user who accepted their invite with a new passkey on `auth`. */
  async function passkeyMember(name: string, auth = key(), role: 'user' | 'admin' = 'user') {
    const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/users', {
      token: admin.token,
      body: { name, email: `${name.toLowerCase().replace(/\W/g, '')}-${crypto.randomUUID().slice(0, 8)}@x.se`, role },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const r = await register(auth, { invite: created.body.inviteToken });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { ...r.body, id: created.body.id, key: auth };
  }

  /** An admin-made user who accepted their invite with Google. */
  async function googleMember(name: string) {
    const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/users', {
      token: admin.token,
      body: { name, email: `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@x.se`, role: 'user' },
    });
    const who = googleAccount(name);
    const r = await google(who, { invite: created.body.inviteToken });
    expect(r.session, JSON.stringify(r)).toBeDefined();
    return { ...r.session!, id: created.body.id, google: who };
  }

  // ------------------------------------------------------------ first run (runs first: no user may exist yet)

  it('D19 with a passkey: setup\'s invite is accepted by making a passkey, and it signs in with no Google and no username', async () => {
    expect((await api<AuthState>(h, 'GET', '/auth/state')).body).toEqual({ setupRequired: true, google: true, passkeys: true });
    const setup = await api<{ inviteToken: string }>(h, 'POST', '/auth/setup', { body: { setupToken: SETUP_TOKEN, name: 'Anna', orgName: 'Lilla Kyrkan' } });
    expect(setup.status).toBe(200);

    const browser = new TestBrowser();
    const b = await begin(browser, { mode: 'register', invite: setup.body.inviteToken, name: 'Annas Mac' });
    expect(b.status).toBe(200);
    const o = (b.body as { options: { create: PasskeyCreationOptions } }).options.create;
    // What the server asks for: a discoverable passkey with user verification, for this RP ID, no attestation.
    expect(o).toMatchObject({
      rp: { id: RP_ID },
      user: { name: 'Anna', displayName: 'Anna' },
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: [],
    });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
    expect(o.challenge).toMatch(/^[\w-]{43}$/);
    expect((await api<AuthState>(h, 'GET', '/auth/state')).body.setupRequired).toBe(true); // nothing linked yet

    adminKey = key({ counter: 'none' }); // iCloud Keychain and Google Password Manager keep no counter
    const r = await finish(browser, await adminKey.create(o));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.token).toMatch(/^gpdt_[\w-]{43}$/);
    expect(r.body.me).toMatchObject({ name: 'Anna', role: 'superAdmin', orgName: 'Lilla Kyrkan', email: null });
    admin = r.body;
    expect(o.user.id).toBe(b64url(admin.me.userId)); // the user handle is the random user id, nothing personal
    expect((await api<AuthState>(h, 'GET', '/auth/state')).body.setupRequired).toBe(false);
    expect((await api(h, 'POST', '/auth/setup', { body: { setupToken: SETUP_TOKEN, name: 'Eve', orgName: 'Evil' } })).status).toBe(409);

    // Signing in names no user: the passkey says who it is.
    const signin = await begin(new TestBrowser(), { mode: 'signin' });
    expect((signin.body as { options: { get: PasskeyRequestOptions } }).options.get).toMatchObject({ rpId: RP_ID, userVerification: 'required', allowCredentials: [] });
    for (let i = 0; i < 3; i++) {
      const again = await signIn(adminKey); // a counter that stays 0 is fine, again and again
      expect(again.body.me?.userId).toBe(admin.me.userId);
    }
    const mine = await logins(admin.token);
    expect(mine).toEqual([{ provider: 'passkey', id: adminKey.credentials[0] && b64url(adminKey.credentials[0].id), name: 'Annas Mac', createdAt: expect.any(Number), lastUsedAt: expect.any(Number) }]);
  });

  // ------------------------------------------------------------ ceremonies

  it.each<[Alg, 'none' | 'packed']>([
    [-7, 'packed'],
    [-8, 'none'],
    [-257, 'none'],
  ])('alg %i (attestation %s): an invite accepted with a passkey, then signing in with it; the counter must grow', async (alg, fmt) => {
    const auth = key({ alg, fmt });
    const m = await passkeyMember(`Alg ${alg}`, auth);
    expect(m.me.userId).toBe(m.id);
    const a = await signIn(auth);
    expect(a.body.me?.userId).toBe(m.id);
    const b = await signIn(auth);
    expect(b.body.me?.userId).toBe(m.id);
    // A counter that goes back is a cloned passkey: refused, no session.
    const before = await counts();
    expect(await signIn(auth, { spoil: 'counter-regress' })).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    expect((await counts()).sessions).toBe(before.sessions);
  });

  it.each<Spoil>(['origin', 'rp-id', 'no-uv', 'no-up', 'type', 'cross-origin', 'attestation', 'challenge'])(
    'registration with a wrong %s is refused: nothing linked, and the invite still good',
    async (spoil) => {
      const created = await api<{ inviteToken: string }>(h, 'POST', '/users', {
        token: admin.token,
        body: { name: `R ${spoil}`, email: `r-${spoil}-${crypto.randomUUID().slice(0, 6)}@x.se`, role: 'user' },
      });
      const before = await counts();
      expect(await register(key(), { invite: created.body.inviteToken }, { spoil })).toEqual({ status: 400, body: { error: 'passkey-failed' } });
      expect((await counts()).user_logins).toBe(before.user_logins);
      expect((await counts()).sessions).toBe(before.sessions);
      expect((await api(h, 'POST', '/auth/invites/lookup', { body: { token: created.body.inviteToken } })).body).toMatchObject({ state: 'valid' });
    },
  );

  it.each<Spoil>(['origin', 'rp-id', 'no-uv', 'no-up', 'signature', 'type', 'cross-origin', 'user-handle', 'challenge'])(
    'sign-in with a wrong %s is refused, with no session',
    async (spoil) => {
      const m = await passkeyMember(`S ${spoil}`);
      const before = await counts();
      expect(await signIn(m.key, { spoil })).toEqual({ status: 400, body: { error: 'passkey-failed' } });
      expect((await counts()).sessions).toBe(before.sessions);
      expect((await signIn(m.key)).body.me?.userId).toBe(m.id); // the passkey itself still works
    },
  );

  it('challenges: single use, bound to the browser that began, and to the kind of ceremony', async () => {
    const m = await passkeyMember('Ce');
    // Replayed: the same credential twice.
    const browser = new TestBrowser();
    const b = await begin(browser, { mode: 'signin' });
    const cred = await m.key.get((b.body as { options: { get: PasskeyRequestOptions } }).options.get);
    // Another browser (no flow cookie, or its own) cannot finish it, and does not use it up.
    expect(await finish(new TestBrowser(), cred)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    const other = new TestBrowser();
    await begin(other, { mode: 'signin' });
    expect(await finish(other, cred)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    expect((await finish(browser, cred)).body.me?.userId).toBe(m.id);
    const replay = new Map(browser.cookies(new URL(h.url).origin));
    expect(await finish(browser, cred)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    for (const [k, v] of replay) browser.cookies(new URL(h.url).origin).set(k, v);
    expect(await finish(browser, cred)).toEqual({ status: 400, body: { error: 'passkey-failed' } });

    // A registration's challenge never signs anyone in, even signed by a real passkey.
    const reg = new TestBrowser();
    const r = await begin(reg, { mode: 'register' }, m.token);
    const challenge = (r.body as { options: { create: PasskeyCreationOptions } }).options.create.challenge;
    expect(await finish(reg, await m.key.get({ challenge, rpId: RP_ID, timeout: 1, userVerification: 'required', allowCredentials: [] }))).toEqual({
      status: 400,
      body: { error: 'passkey-failed' },
    });
    // And a sign-in's challenge never registers a passkey.
    const si = new TestBrowser();
    const s = await begin(si, { mode: 'signin' });
    const sc = (s.body as { options: { get: PasskeyRequestOptions } }).options.get.challenge;
    const forged = await key().create({ ...(r.body as { options: { create: PasskeyCreationOptions } }).options.create, challenge: sc });
    expect(await finish(si, forged)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
  });

  it('an unknown passkey, and the passkey of a removed user, sign no one in', async () => {
    const lone = key();
    // A passkey made for this RP ID but never registered here.
    const b = await begin(new TestBrowser(), { mode: 'register' }, admin.token);
    await lone.create((b.body as { options: { create: PasskeyCreationOptions } }).options.create);
    expect(await signIn(lone)).toEqual({ status: 400, body: { error: 'passkey-failed' } });

    const gone = await passkeyMember('Gone');
    expect((await api(h, 'DELETE', `/users/${gone.id}`, { token: admin.token })).status).toBe(200);
    expect(await signIn(gone.key)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    expect((await api(h, 'GET', '/auth/me', { token: gone.token })).status).toBe(401);
  });

  // ------------------------------------------------------------ your own logins

  it('both kinds on one user: a Google user adds a passkey, and either signs in as the same user', async () => {
    const g = await googleMember('Gun');
    const auth = key();
    const added = await register<{ added: LoginMethod }>(auth, { name: 'Guns telefon' }, { token: g.token });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.added).toMatchObject({ provider: 'passkey', name: 'Guns telefon' });
    expect((await signIn(auth)).body.me?.userId).toBe(g.id);
    expect((await google(g.google)).session?.me.userId).toBe(g.id);
    const mine = await logins(g.token);
    expect(mine.map((l) => [l.provider, l.name])).toEqual([
      ['google', g.google.email],
      ['passkey', 'Guns telefon'],
    ]);
    // The second passkey on the same authenticator is excluded; a new authenticator is fine.
    const b = await begin(new TestBrowser(), { mode: 'register' }, g.token);
    expect((b.body as { options: { create: PasskeyCreationOptions } }).options.create.excludeCredentials).toEqual([
      { type: 'public-key', id: added.body.added.id, transports: ['internal', 'hybrid'] },
    ]);
  });

  it('both kinds on one user: a passkey user links Google from their session; another user\'s Google account is refused', async () => {
    const p = await passkeyMember('Pia');
    const pias = googleAccount('Pia');
    const linked = await google(pias, { link: p.token });
    expect(linked.hash).toBe('#/logins');
    expect((await logins(p.token)).map((l) => l.provider)).toEqual(['passkey', 'google']);
    expect((await google(pias)).session?.me.userId).toBe(p.id);
    expect((await signIn(p.key)).body.me?.userId).toBe(p.id);
    // The email is filled from Google's when the user has none... Pia has one, so it stays.
    expect((await api<Me>(h, 'GET', '/auth/me', { token: p.token })).body.email).toMatch(/^pia-.*@x\.se$/);
    // One Google account per user.
    expect((await api(h, 'POST', '/auth/google/begin', { token: p.token, body: { link: true } })).body).toEqual({ error: 'limit' });

    // A Google account that is another user's is refused, and nothing changes.
    const q = await passkeyMember('Qi');
    const g = await googleMember('Gunnar');
    const before = await logins(q.token);
    expect(await google(g.google, { link: q.token })).toMatchObject({ error: 'login-taken' });
    expect(await logins(q.token)).toEqual(before);
    expect((await google(g.google)).session?.me.userId).toBe(g.id);
    // Linking needs a session.
    expect((await api(h, 'POST', '/auth/google/begin', { body: { link: true } })).status).toBe(401);
  });

  it('list, rename and remove your own logins; never the last one, of either kind; never someone else\'s', async () => {
    const g = await googleMember('Lo');
    const a = key();
    const b = key();
    const pa = (await register<{ added: LoginMethod }>(a, { name: 'A' }, { token: g.token })).body.added;
    const pb = (await register<{ added: LoginMethod }>(b, { name: 'B' }, { token: g.token })).body.added;
    expect((await api(h, 'PATCH', `/auth/logins/passkey/${pa.id}`, { token: g.token, body: { name: '  Jobbdatorn ' } })).status).toBe(200);
    expect((await api(h, 'PATCH', `/auth/logins/passkey/${pa.id}`, { token: g.token, body: { name: '   ' } })).status).toBe(400);
    expect((await logins(g.token)).find((l) => l.id === pa.id)?.name).toBe('Jobbdatorn');

    // Someone else cannot rename or remove them, not even an admin.
    for (const token of [admin.token, (await passkeyMember('Other')).token]) {
      expect((await api(h, 'PATCH', `/auth/logins/passkey/${pa.id}`, { token, body: { name: 'Mine' } })).status).toBe(404);
      expect((await api(h, 'DELETE', `/auth/logins/passkey/${pa.id}`, { token })).status).toBe(404);
      expect((await api(h, 'DELETE', `/auth/logins/google/${g.google.sub}`, { token })).status).toBe(404);
    }

    expect((await api(h, 'DELETE', `/auth/logins/google/${g.google.sub}`, { token: g.token })).status).toBe(200);
    expect(await google(g.google)).toMatchObject({ error: 'not-linked' });
    expect((await api(h, 'DELETE', `/auth/logins/passkey/${pa.id}`, { token: g.token })).status).toBe(200);
    expect(await signIn(a)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    // The last one stays.
    expect(await api(h, 'DELETE', `/auth/logins/passkey/${pb.id}`, { token: g.token })).toEqual({ status: 409, body: { error: 'last-login' } });
    expect((await signIn(b)).body.me?.userId).toBe(g.id);
    expect((await api(h, 'DELETE', `/auth/logins/other/x`, { token: g.token })).status).toBe(404);

    // A Google-only user cannot remove their Google account either.
    const go = await googleMember('Go');
    expect(await api(h, 'DELETE', `/auth/logins/google/${go.google.sub}`, { token: go.token })).toEqual({ status: 409, body: { error: 'last-login' } });
  });

  it('an Admin cannot add a passkey for someone else: registration is always for the caller\'s own session', async () => {
    const target = await passkeyMember('Target');
    const browser = new TestBrowser();
    // A user id in the body is ignored; the passkey is the admin's own.
    const b = await begin(browser, { mode: 'register', userId: target.id }, admin.token);
    const o = (b.body as { options: { create: PasskeyCreationOptions } }).options.create;
    expect(o.user.id).toBe(b64url(admin.me.userId));
    const evil = key();
    const r = await finish<{ added: LoginMethod }>(browser, await evil.create(o));
    expect(r.status).toBe(200);
    expect((await signIn(evil)).body.me?.userId).toBe(admin.me.userId);
    expect((await logins(target.token)).length).toBe(1);
    // Without a session there is no one to register for.
    expect((await begin(new TestBrowser(), { mode: 'register' })).status).toBe(401);
    expect((await begin(new TestBrowser(), { mode: 'signin', invite: 'gpin_x' })).status).toBe(400);
    // Clean up, so Anna keeps one passkey for the later tests.
    expect((await api(h, 'DELETE', `/auth/logins/passkey/${r.body.added.id}`, { token: admin.token })).status).toBe(200);
  });

  it('a new invite is the reset: the passkey that accepts it replaces every login, and the old sessions end', async () => {
    const g = await googleMember('Reset');
    const old = key();
    await register(old, {}, { token: g.token });
    const invite = await api<{ inviteToken: string }>(h, 'POST', `/users/${g.id}/invites`, { token: admin.token });
    const fresh = key();
    const r = await register(fresh, { invite: invite.body.inviteToken });
    expect(r.body.me?.userId).toBe(g.id);
    expect((await api(h, 'GET', '/auth/me', { token: g.token })).status).toBe(401);
    expect(await google(g.google)).toMatchObject({ error: 'not-linked' });
    expect(await signIn(old)).toEqual({ status: 400, body: { error: 'passkey-failed' } });
    expect((await signIn(fresh)).body.me?.userId).toBe(g.id);
    expect((await logins(r.body.token)).map((l) => l.provider)).toEqual(['passkey']);
  });

  // ------------------------------------------------------------ apps: the ceremony in the system browser (spec 01 device sign-in)

  it('/app-login?method=passkey: unknown schemes refused first; the page runs the ceremony and hands the token to the app', async () => {
    const before = await counts();
    for (const scheme of ['evil', 'GospelPresenter', '']) {
      const r = await fetch(`${h.url}/app-login?method=passkey&callback_scheme=${encodeURIComponent(scheme)}`);
      expect([scheme, r.status]).toEqual([scheme, 400]);
    }
    expect((await fetch(`${h.url}/app-login?method=password&callback_scheme=gospelpresenter`)).status).toBe(400);
    expect(await counts()).toEqual(before);

    const m = await passkeyMember('App');
    const browser = new TestBrowser();
    const res = await browser.fetch(`${h.url}/app-login?method=passkey&device=Mac&callback_scheme=gospelpresenter-test`);
    const html = await res.text();
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(html).toContain('<script src="/auth/passkey.js"></script>');
    const done = await finish<{ callback: string }>(browser, await m.key.get(pageOptions(html).get!));
    const link = new URL(done.body.callback);
    expect(`${link.protocol}//${link.host}`).toBe('gospelpresenter-test://auth');
    const token = new URLSearchParams(link.hash.slice(1)).get('token')!;
    expect((await api<Me>(h, 'GET', '/auth/me', { token })).body.userId).toBe(m.id);
    expect((await fetch(`${h.url}/auth/passkey.js`)).headers.get('content-type')).toMatch(/javascript/);
  });

  it('an app begins an invite or a new passkey; the system browser opens it once and gets the callback, or a done', async () => {
    const created = await api<{ id: string; inviteToken: string }>(h, 'POST', '/users', {
      token: admin.token,
      body: { name: 'Desk', email: `desk-${crypto.randomUUID().slice(0, 6)}@x.se`, role: 'user' },
    });
    const app = { deviceName: 'Mac', callbackScheme: 'gospelpresenter-test' };
    expect((await begin(new TestBrowser(), { mode: 'register', invite: created.body.inviteToken, app: { ...app, callbackScheme: 'evil' } })).status).toBe(400);
    const b = await begin(new TestBrowser(), { mode: 'register', invite: created.body.inviteToken, app });
    const url = h.url + (b.body as { url: string }).url;
    const browser = new TestBrowser();
    const page = await browser.open(url);
    expect(page.status).toBe(200);
    expect((await new TestBrowser().open(url)).status).toBe(400); // started once, in one browser
    const auth = key();
    const done = await finish<{ callback: string }>(browser, await auth.create(pageOptions(page.html).create!));
    const token = new URLSearchParams(new URL(done.body.callback).hash.slice(1)).get('token')!;
    expect((await api<Me>(h, 'GET', '/auth/me', { token })).body.userId).toBe(created.body.id);
    expect(appCallbackLink(page.html)).toBeNull(); // the link appears only once the script has it

    // A signed-in app adds a passkey the same way; nothing is handed back but "done".
    const add = await begin(new TestBrowser(), { mode: 'register', name: 'Nyckel', app }, token);
    const b2 = new TestBrowser();
    const p2 = await b2.open(h.url + (add.body as { url: string }).url);
    expect(await finish(b2, await key().create(pageOptions(p2.html).create!))).toEqual({ status: 200, body: { done: true } });
    expect((await logins(token)).map((l) => l.name)).toEqual(['Mac', 'Nyckel']);
  });

  // ------------------------------------------------------------ throttling (runs last: it fills this address's quota)

  it('at most 20 unfinished ceremonies per address; then 429 with Retry-After', async () => {
    let refused: Response | null = null;
    let ok = 0;
    for (let i = 0; i < 25 && !refused; i++) {
      const res = await fetch(`${h.url}/auth/passkey/begin`, json({ mode: 'signin' }));
      if (res.status === 429) refused = res;
      else ok++;
    }
    expect(refused?.status).toBe(429);
    expect(ok).toBeLessThanOrEqual(20);
    expect(await refused!.json()).toEqual({ error: 'too-many-attempts', retryAfter: 300 });
  });
});

describe.each(adapters)('%s adapter, passkeys and a session that is no longer fresh', (adapterName) => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName, { google: fake, passkeys: { rpId: RP_ID, origins: [ORIGIN] }, freshSignInMs: 1000 });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('adding a passkey or linking Google needs a recent sign-in; listing does not', async () => {
    const { setRole } = await import('./harness.ts');
    const token = await setRole(h, 'old', 'org-old', 'user');
    expect((await api(h, 'POST', '/auth/passkey/begin', { token, body: { mode: 'register' } })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await api(h, 'POST', '/auth/passkey/begin', { token, body: { mode: 'register' } })).body).toEqual({ error: 'reauth-required' });
    expect((await api(h, 'POST', '/auth/google/begin', { token, body: { link: true } })).body).toEqual({ error: 'reauth-required' });
    expect((await api(h, 'GET', '/auth/logins', { token })).status).toBe(200);
  });
});

describe.each(adapters)('%s adapter, passkeys not configured', (adapterName) => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter(adapterName, { google: fake });
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('every passkey route says so', async () => {
    expect((await api<AuthState>(h, 'GET', '/auth/state')).body.passkeys).toBe(false);
    expect(await api(h, 'POST', '/auth/passkey/begin', { body: { mode: 'signin' } })).toEqual({ status: 503, body: { error: 'passkey-disabled' } });
    expect((await fetch(`${h.url}/app-login?method=passkey&callback_scheme=gospelpresenter`)).status).toBe(503);
    expect((await fetch(`${h.url}/auth/passkey/start?flow=x`)).status).toBe(503);
  });
});
