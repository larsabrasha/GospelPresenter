// The ID token check, case by case, against the fake Google; and the gate
// that keeps a fake Google out of anything but a test build.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleOidc, TEST_ISSUER_BUILD } from '../src/google.ts';
import { startAdapter } from './harness.ts';
import { startFakeGoogle, type FakeGoogle, type Tamper } from './fake-google.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const REDIRECT = 'http://127.0.0.1:1/auth/google/callback';
const verifier = 'v'.repeat(43);

let fake: FakeGoogle;
let oidc: GoogleOidc;
beforeAll(async () => {
  fake = await startFakeGoogle();
  oidc = new GoogleOidc({ clientId: fake.clientId, clientSecret: fake.clientSecret, testIssuer: fake.url });
});
afterAll(() => fake?.close());

/** A code from the fake's authorization endpoint, as the browser would bring it back. */
async function code(nonce: string, v: string, tamper?: Tamper) {
  fake.next({ sub: '1234567890', email: 'Anna@Gmail.com', name: 'Anna' }, tamper);
  const res = await fetch(await oidc.authorizeUrl({ state: 's', nonce, verifier: v, redirectUri: REDIRECT }), { redirect: 'manual' });
  return new URL(res.headers.get('location')!).searchParams.get('code')!;
}

describe('ID token', () => {
  it('a good token gives the account, its email lower-cased', async () => {
    const token = await oidc.exchange(await code('n1', verifier), verifier, REDIRECT);
    expect(await oidc.verify(token, 'n1')).toEqual({ sub: '1234567890', email: 'anna@gmail.com', name: 'Anna' });
  });

  it.each<[Tamper, string]>([
    ['aud', 'aud'],
    ['iss', 'iss'],
    ['expired', 'expired'],
    ['signature', 'signature'],
    ['nonce', 'nonce'],
    ['unverified', 'email-unverified'],
    ['alg-none', 'alg'],
  ])('refused: %s', async (tamper, problem) => {
    const token = await oidc.exchange(await code('n2', verifier, tamper), verifier, REDIRECT);
    expect(await oidc.verify(token, 'n2')).toEqual({ problem });
  });

  it('refused: a token for another sign-in (its nonce), a malformed one, an unknown key', async () => {
    const token = await oidc.exchange(await code('n3', verifier), verifier, REDIRECT);
    expect(await oidc.verify(token, 'another sign-in')).toEqual({ problem: 'nonce' });
    expect(await oidc.verify('a.b', 'n3')).toEqual({ problem: 'malformed' });
    const [, payload, sig] = token.split('.');
    const otherKid = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'not-a-key' })).toString('base64url');
    expect(await oidc.verify(`${otherKid}.${payload}.${sig}`, 'n3')).toEqual({ problem: 'unknown-key' });
    // An HMAC "signed" with anything is never accepted: only RS256.
    const hs = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'fake-key-1' })).toString('base64url');
    expect(await oidc.verify(`${hs}.${payload}.${sig}`, 'n3')).toEqual({ problem: 'alg' });
  });

  it('the token endpoint refuses a wrong PKCE verifier and a code used twice', async () => {
    const c = await code('n4', verifier);
    await expect(oidc.exchange(c, 'w'.repeat(43), REDIRECT)).rejects.toThrow(/400/);
    await expect(oidc.exchange(c, verifier, REDIRECT)).rejects.toThrow(/400/); // the fake, like Google, burns the code
  });

  it('the authorization request asks for PKCE S256, a nonce, state and select_account (spec 01)', async () => {
    const q = new URL(await oidc.authorizeUrl({ state: 'st', nonce: 'no', verifier, redirectUri: REDIRECT })).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      client_id: fake.clientId,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'st',
      nonce: 'no',
      code_challenge_method: 'S256',
      prompt: 'select_account',
      redirect_uri: REDIRECT,
    });
    expect(q.get('code_challenge')).not.toBe(verifier);
  });
});

describe('a fake Google only in test builds', () => {
  it('this test build allows one', () => {
    expect(TEST_ISSUER_BUILD).toBe(true);
  });

  it('google.ts bundled for a deploy (GP_TEST_ISSUER=false) or with no definition refuses a test issuer, and still signs in with Google', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-google-'));
    try {
      for (const [i, define] of ([{ GP_TEST_ISSUER: 'false' }, {}] as Record<string, string>[]).entries()) {
        const outfile = join(dir, `google-${i}.mjs`);
        await build({ entryPoints: [join(here, '..', 'src', 'google.ts')], bundle: true, format: 'esm', platform: 'neutral', define, outfile, logLevel: 'silent' });
        // In a process of its own: this one has Vitest's GP_TEST_ISSUER on globalThis.
        const script = `
          const m = await import(${JSON.stringify(pathToFileURL(outfile).href)});
          let refused = false;
          try { new m.GoogleOidc({ clientId: 'c', clientSecret: 's', testIssuer: ${JSON.stringify(fake.url)} }); } catch (e) { refused = /does not allow/.test(e.message); }
          const real = new m.GoogleOidc({ clientId: 'c', clientSecret: 's' });
          const origin = new URL(await real.authorizeUrl({ state: 's', nonce: 'n', verifier: 'v', redirectUri: 'http://x/cb' })).origin;
          console.log(JSON.stringify({ build: m.TEST_ISSUER_BUILD, refused, origin }));`;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
        expect(JSON.parse(out)).toEqual({ build: false, refused: true, origin: 'https://accounts.google.com' });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a Worker bundled for a deploy, given GOOGLE_TEST_ISSUER, fails closed and never calls the fake', async () => {
    const before = fake.authorizations.length;
    const h = await startAdapter('workers', { google: fake, deployBuild: true });
    try {
      expect((await fetch(`${h.url}/api/auth/state`)).status).toBe(500);
      expect((await fetch(`${h.url}/api/app-login?callback_scheme=gospelpresenter`, { redirect: 'manual' })).status).toBe(500);
    } finally {
      await h.close();
    }
    expect(fake.authorizations.length).toBe(before);
  }, 60_000);
});

