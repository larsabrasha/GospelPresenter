// Sign-in and pairing on a desktop host, over HTTP against Node (both drivers), with a fake Google in this process:
// only the host's own window signs in, and every other device signs in by pairing (docs/sign-in-and-pairing.md).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { PROTOCOL_VERSION, SCHEMA_VERSION, type Me, type PairClaimResponse, type PairStatus, type SignInResponse } from '@gp/core';
import { socketProtocols } from '@gp/sync/client';
import { Accounts, migrateGlobal, pairingGuard } from '@gp/server';
import { nodeGlobalSql, openSqlite, startNodeServer, type RunningServer } from '@gp/server/node';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, pokeUrl, type Harness } from './harness.ts';
import { appCallbackLink, startFakeGoogle, TestBrowser, type FakeAccount, type FakeGoogle } from './fake-google.ts';
import { SoftAuthenticator } from './soft-authenticator.ts';

const SETUP_TOKEN = 'gpst_the-setup-token-for-tests';

let fake: FakeGoogle;
beforeAll(async () => {
  fake = await startFakeGoogle();
});
afterAll(() => fake?.close());

const account = (name: string): FakeAccount => ({ sub: `${name}-${crypto.randomUUID()}`, email: `${name.toLowerCase()}@gmail.com`, name });
const pull = (clientId = 'c1') => ({ protocol: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, clientId, cookie: null, lastMutationId: 0 });

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
  async function hostSignIn(who: FakeAccount, inviteToken?: string) {
    const begin = await req<{ url: string }>('POST', '/api/auth/google/begin', { device: HOST, body: { invite: inviteToken, app: { deviceName: 'Värddatorn', callbackScheme: 'gospelpresenter-local' } } });
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
    expect(admin.me).toMatchObject({ role: 'admin', superAdmin: true });
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('an unpaired device is refused everywhere but the pairing itself, also with a valid session token', async () => {
    expect((await req<PairStatus>('GET', '/api/pair/status')).body).toEqual({ required: true, paired: false, host: false, dev: false });
    expect((await req<PairStatus>('GET', '/api/pair/status', { device: HOST })).body).toEqual({ required: true, paired: true, host: true, dev: false });
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

    // Bo, an Admin at the host, may not pair a device as the Superadmin; nor anyone outside the church.
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

  it('an Admin at the host pairs as, or resets, a person only the host has; one who is a member elsewhere is a Superadmin\'s', async () => {
    const bo = await req<{ id: string }>('POST', '/api/users', { device: HOST, token: admin.token, body: { name: 'Bodil', role: 'admin' } });
    const asBo = await req<PairClaimResponse>('POST', '/api/pair/claim', {
      body: { code: (await req<{ code: string }>('POST', '/api/pair/code', { device: HOST, token: admin.token, body: { userId: bo.body.id } })).body.code, name: 'Host as Bodil' },
    });
    const local = await req<{ id: string }>('POST', '/api/users', { device: HOST, token: admin.token, body: { name: 'Bildskärm', role: 'user' } });
    const boToken = asBo.body.session.token;
    expect((await req('POST', '/api/pair/code', { device: HOST, token: boToken, body: { userId: local.body.id } })).status).toBe(200);
    expect((await req('POST', `/api/users/${local.body.id}/invites`, { device: HOST, token: boToken })).status).toBe(200);
    const file = openSqlite(join(dataDir, 'global.sqlite'), driver);
    await nodeGlobalSql(file).run("INSERT INTO memberships (user_id, org_id, role) VALUES (?, 'another-church', 'user')", [local.body.id]);
    file.close();
    expect((await req('POST', '/api/pair/code', { device: HOST, token: boToken, body: { userId: local.body.id } })).body).toEqual({ error: 'super-admin-only' });
    expect((await req('POST', `/api/users/${local.body.id}/invites`, { device: HOST, token: boToken })).body).toEqual({ error: 'super-admin-only' });
  });

  it('makes people rather than invitations: an invitation could only be accepted in its window', async () => {
    expect(await req('POST', '/api/invitations', { device: HOST, token: admin.token, body: { email: 'x@x.se', role: 'user' } })).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  it('without GP_DEV_PAIR, a device cannot pair without a code', async () => {
    const r = await fetch(`${host.url}/api/pair/dev`, { method: 'POST', body: JSON.stringify({ name: 'iPhone' }) });

    expect(r.status).toBe(404);
  });
});

describe('a development host (GP_DEV_PAIR=1)', () => {
  const HOST = 'gphost_' + 'd'.repeat(43);
  let server: RunningServer;
  let dataDir: string;
  const host: Harness = { name: 'node', url: '', mediaKeys: async () => [], close: async () => {} };
  const req = <T = unknown>(method: string, path: string, opts: { token?: string; device?: string; body?: unknown } = {}) =>
    api<T>(host, method, path, { token: opts.token, body: opts.body, headers: opts.device ? { 'x-gp-device': opts.device } : {} });

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'gp-devpair-'));
    server = await startNodeServer({
      dataDir,
      driver: 'node:sqlite',
      pairing: { hostToken: HOST, dev: true },
      setupToken: SETUP_TOKEN,
      // Setup needs a way to sign in; the admin never does here.
      passkeys: { rpId: 'localhost', origins: ['http://localhost:47800'] },
      log: () => undefined,
    });
    host.url = server.url;
  });
  afterEach(async () => {
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('pairs a device that asks, without a code, as the first admin', async () => {
    const setup = await req('POST', '/api/auth/setup', { device: HOST, body: { setupToken: SETUP_TOKEN, name: 'Anna', orgName: 'Kyrkan' } });
    expect(setup.status).toBe(200);

    const paired = await req<PairClaimResponse>('POST', '/api/pair/dev', { body: { name: 'iPhone' } });

    expect(paired.status).toBe(200);
    expect((await req<PairStatus>('GET', '/api/pair/status', { device: paired.body.device })).body).toEqual({ required: true, paired: true, host: false, dev: true });
    expect((await req<Me>('GET', '/api/auth/me', { device: paired.body.device, token: paired.body.session.token })).body).toMatchObject({ name: 'Anna', role: 'admin', superAdmin: true });
  });

  it('refuses while the host is not set up, as there is no admin to pair as', async () => {
    const r = await req('POST', '/api/pair/dev', { body: { name: 'iPhone' } });

    expect(r).toEqual({ status: 400, body: { error: 'pair-code-invalid' } });
  });
});
