// A fake Google for tests: an OpenID Connect issuer in this process, with its
// own signing key, JWKS, authorization endpoint and token endpoint. A server
// uses it only through `GoogleConfig.testIssuer`, which a deploy build refuses
// (src/google.ts). It never shows a page: the authorization endpoint answers
// at once as the account the test chose with `next`.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeAccount {
  sub: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}

/** Ways the next ID token can be wrong. */
export type Tamper = 'aud' | 'iss' | 'expired' | 'signature' | 'nonce' | 'unverified' | 'alg-none';

export interface FakeGoogle {
  /** The issuer and base URL, for `GoogleConfig.testIssuer`. */
  url: string;
  clientId: string;
  clientSecret: string;
  /** Who signs in at the next authorization request (and how the ID token is spoiled); null declines. */
  next(account: FakeAccount | null, tamper?: Tamper): void;
  /** Every authorization request's query, for checking what the server asked for. */
  authorizations: URLSearchParams[];
  /** Token requests answered, and refused. */
  tokens: { ok: number; refused: number };
  close(): Promise<void>;
}

const enc = new TextEncoder();
const b64url = (b: Uint8Array | string) => Buffer.from(typeof b === 'string' ? enc.encode(b) : b).toString('base64url');

async function rsaKey() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ]);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let s = '';
  for await (const chunk of req) s += String(chunk);
  return s;
}

export async function startFakeGoogle(opts: { clientId?: string; clientSecret?: string } = {}): Promise<FakeGoogle> {
  const clientId = opts.clientId ?? 'fake-client.apps.example';
  const clientSecret = opts.clientSecret ?? 'fake-client-secret';
  const kid = 'fake-key-1';
  const key = await rsaKey();
  const other = await rsaKey(); // signs the tokens a test wants to fail on signature
  const jwk = (await crypto.subtle.exportKey('jwk', key.publicKey)) as { n: string; e: string };
  let nextAccount: FakeAccount | null = null;
  let nextTamper: Tamper | undefined;
  const codes = new Map<string, { account: FakeAccount; tamper?: Tamper; nonce: string; challenge: string; redirectUri: string }>();
  const authorizations: URLSearchParams[] = [];
  const tokens = { ok: 0, refused: 0 };
  let url = '';

  async function idToken(account: FakeAccount, nonce: string, tamper?: Tamper): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: tamper === 'alg-none' ? 'none' : 'RS256', kid, typ: 'JWT' };
    const claims = {
      iss: tamper === 'iss' ? 'https://accounts.evil.example' : url,
      aud: tamper === 'aud' ? 'someone-elses-client.apps.example' : clientId,
      azp: clientId,
      sub: account.sub,
      email: account.email,
      email_verified: tamper === 'unverified' ? false : (account.emailVerified ?? true),
      name: account.name ?? account.email,
      nonce: tamper === 'nonce' ? 'not-the-nonce-that-was-sent' : nonce,
      iat: tamper === 'expired' ? now - 7200 : now,
      exp: tamper === 'expired' ? now - 3600 : now + 3600,
    };
    const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    if (tamper === 'alg-none') return `${signing}.`;
    const signer = tamper === 'signature' ? other.privateKey : key.privateKey;
    return `${signing}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, enc.encode(signing))))}`;
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', url);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === '/certs') return json(200, { keys: [{ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] });

    if (u.pathname === '/auth') {
      const q = u.searchParams;
      authorizations.push(q);
      const redirectUri = q.get('redirect_uri') ?? '';
      // What Google itself would refuse, so a wrong request fails here as it would there.
      const wrong =
        q.get('client_id') !== clientId ||
        q.get('response_type') !== 'code' ||
        q.get('code_challenge_method') !== 'S256' ||
        !q.get('code_challenge') ||
        !q.get('nonce') ||
        !q.get('state') ||
        !(q.get('scope') ?? '').split(' ').includes('openid') ||
        !/^https?:\/\//.test(redirectUri);
      if (wrong) return json(400, { error: 'invalid_request' });
      const back = new URL(redirectUri);
      back.searchParams.set('state', q.get('state')!);
      if (!nextAccount) back.searchParams.set('error', 'access_denied');
      else {
        const code = crypto.randomUUID();
        codes.set(code, { account: nextAccount, tamper: nextTamper, nonce: q.get('nonce')!, challenge: q.get('code_challenge')!, redirectUri });
        back.searchParams.set('code', code);
      }
      nextAccount = null;
      nextTamper = undefined;
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (u.pathname === '/token' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      const grant = codes.get(f.get('code') ?? '');
      codes.delete(f.get('code') ?? ''); // a code is good once
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(f.get('code_verifier') ?? ''))));
      const ok =
        grant &&
        f.get('grant_type') === 'authorization_code' &&
        f.get('client_id') === clientId &&
        f.get('client_secret') === clientSecret &&
        f.get('redirect_uri') === grant.redirectUri &&
        challenge === grant.challenge;
      if (!ok) {
        tokens.refused++;
        return json(400, { error: 'invalid_grant' });
      }
      tokens.ok++;
      return json(200, { access_token: 'fake', token_type: 'Bearer', expires_in: 3600, id_token: await idToken(grant.account, grant.nonce, grant.tamper) });
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    clientId,
    clientSecret,
    next(account, tamper) {
      nextAccount = account;
      nextTamper = tamper;
    },
    authorizations,
    tokens,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/**
 * A browser for tests: follows redirects by hand and keeps cookies per
 * origin, as a real one would for these flows. Stops at a page (non-redirect)
 * or at a URL that leaves http (an app's callback scheme).
 */
export class TestBrowser {
  private jar = new Map<string, Map<string, string>>();

  cookies(origin: string): Map<string, string> {
    let m = this.jar.get(origin);
    if (!m) this.jar.set(origin, (m = new Map()));
    return m;
  }

  async fetch(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
    const u = new URL(url);
    const jar = this.cookies(u.origin);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, { ...init, redirect: 'manual', headers: { ...init.headers, ...(cookie ? { cookie } : {}) } });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [k, ...v] = pair!.split('=');
      const value = v.join('=');
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) jar.delete(k!.trim());
      else jar.set(k!.trim(), value);
    }
    return res;
  }

  /** Opens `url` and follows redirects. Ends at a page, or at the first URL that is not http(s). */
  async open(url: string): Promise<{ url: string; status: number; html: string }> {
    let at = url;
    for (let i = 0; i < 10; i++) {
      if (!/^https?:/.test(at)) return { url: at, status: 0, html: '' };
      const res = await this.fetch(at);
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        at = new URL(location, at).toString();
        continue;
      }
      return { url: at, status: res.status, html: await res.text() };
    }
    throw new Error('too many redirects');
  }
}

/** The `#app-callback` link of the handover page (spec 01), decoded from HTML. */
export function appCallbackLink(html: string): string | null {
  const m = /id="app-callback" href="([^"]+)"/.exec(html);
  return m ? m[1]!.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))) : null;
}
