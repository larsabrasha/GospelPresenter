// Trial: passkeys verified by the deployed Worker (WebCrypto in the Workers runtime), Ed25519 first.
import { expect, it } from 'vitest';
import { api, startAdapter } from '../../../apps/server/test/harness.ts';
import { TestBrowser } from '../../../apps/server/test/fake-google.ts';
import { SoftAuthenticator, type Alg, type Spoil } from '../../../apps/server/test/soft-authenticator.ts';
import { trialToken } from '../tokens.ts';

const SETUP_TOKEN = trialToken('SETUP_TOKEN');
// What begin and finish answer, as far as these checks read it.
type Answer = {
  options: { create: Parameters<SoftAuthenticator['create']>[0]; get: Parameters<SoftAuthenticator['get']>[0] };
  me: { userId: string; role: string; orgName: string };
  token: string;
  error?: string;
};
const json = (body: unknown, token?: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

it('setup with an Ed25519 passkey; ES256, Ed25519 and RS256 invites; spoiled signatures refused', async () => {
  const h = await startAdapter('remote');
  const ORIGIN = h.url;
  const begin = async (b: TestBrowser, body: object, token?: string) => {
    const res = await b.fetch(`${h.url}/api/auth/passkey/begin`, json(body, token));
    return { status: res.status, body: (await res.json()) as Answer };
  };
  const finish = async (b: TestBrowser, credential: unknown) => {
    const t = performance.now();
    const res = await b.fetch(`${h.url}/api/auth/passkey/finish`, json({ credential, deviceName: 'Trial' }));
    return { status: res.status, body: (await res.json()) as Answer, ms: performance.now() - t };
  };
  const register = async (auth: SoftAuthenticator, body: object, token?: string) => {
    const b = new TestBrowser();
    const r = await begin(b, { mode: 'register', ...body }, token);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return finish(b, await auth.create(r.body.options.create));
  };
  const signIn = async (auth: SoftAuthenticator, spoil?: Spoil) => {
    const b = new TestBrowser();
    const r = await begin(b, { mode: 'signin' });
    return finish(b, await auth.get(r.body.options.get, spoil));
  };

  expect((await api(h, 'GET', '/api/auth/state')).body).toEqual({ setupRequired: true, google: false, passkeys: true });
  const setup = await api<{ inviteToken: string }>(h, 'POST', '/api/auth/setup', { body: { setupToken: SETUP_TOKEN, name: 'Trial Admin', orgName: 'Provkyrkan' } });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const adminKey = new SoftAuthenticator(ORIGIN, { alg: -8, counter: 'none' });
  const admin = await register(adminKey, { invite: setup.body.inviteToken, name: 'Ed25519' });
  expect(admin.status, JSON.stringify(admin.body)).toBe(200);
  expect(admin.body.me).toMatchObject({ role: 'superAdmin', orgName: 'Provkyrkan' });
  const times: string[] = [`register -8: ${Math.round(admin.ms)} ms`];
  for (let i = 0; i < 3; i++) {
    const r = await signIn(adminKey);
    expect(r.body.me?.userId).toBe(admin.body.me.userId);
    times.push(`sign-in -8: ${Math.round(r.ms)} ms`);
  }
  expect(await signIn(adminKey, 'signature')).toMatchObject({ status: 400, body: { error: 'passkey-failed' } });

  for (const [alg, fmt] of [[-7, 'packed'], [-8, 'none'], [-257, 'none']] as [Alg, 'none' | 'packed'][]) {
    const created = await api<{ inviteToken: string }>(h, 'POST', '/api/users', { token: admin.body.token, body: { name: `Alg ${alg}`, email: `alg${-alg}-${crypto.randomUUID().slice(0, 6)}@x.se`, role: 'user' } });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const auth = new SoftAuthenticator(ORIGIN, { alg, fmt });
    const m = await register(auth, { invite: created.body.inviteToken });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const a = await signIn(auth);
    expect(a.body.me?.userId).toBe(m.body.me.userId);
    times.push(`alg ${alg}: register ${Math.round(m.ms)} ms, sign-in ${Math.round(a.ms)} ms`);
    expect(await signIn(auth, 'counter-regress')).toMatchObject({ status: 400, body: { error: 'passkey-failed' } });
    expect(await signIn(auth, 'signature')).toMatchObject({ status: 400, body: { error: 'passkey-failed' } });
  }
  for (const spoil of ['origin', 'rp-id'] as Spoil[]) expect(await signIn(adminKey, spoil)).toMatchObject({ status: 400 });
  console.log('[measure] passkeys:', times.join('; '));
}, 120_000);
