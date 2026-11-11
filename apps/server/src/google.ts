// Sign-in with Google (spec 01): the authorization code flow with PKCE,
// `state` and `nonce`, and the ID token verified here against Google's keys.
// Web Crypto and fetch only, so the same code runs on Node, Workers and in
// Electron with no dependency.
import { fromB64url, pkceChallenge } from './crypto.ts';

/**
 * Set by the bundler, never at runtime. Only test builds define it as true
 * (the Vitest config and the Miniflare harness); the Worker's deploy build
 * and wrangler.toml define it false, and without a definition it is false.
 */
declare const GP_TEST_ISSUER: boolean | undefined;

/** Whether this build may talk to a fake Google (`GoogleConfig.testIssuer`). */
export const TEST_ISSUER_BUILD: boolean = typeof GP_TEST_ISSUER === 'boolean' && GP_TEST_ISSUER;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Where Google sends the browser back: `{redirectBaseUrl}/api/auth/google/callback`
   * must be registered with the OAuth client. Without it, the origin of the
   * request that starts the sign-in is used (tests and the desktop host).
   */
  redirectBaseUrl?: string;
  /**
   * Tests only: the base URL of a fake issuer (`apps/server/test/fake-google.ts`)
   * to use instead of Google. Refused unless TEST_ISSUER_BUILD.
   */
  testIssuer?: string;
}

interface Endpoints {
  issuers: string[];
  authorize: string;
  token: string;
  jwks: string;
}

const GOOGLE: Endpoints = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
};

/** A verified Google identity. `sub` is what a login is linked by; the email is only filled in. */
export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
}

/** Why an ID token was refused. Logged, never shown: the user sees one generic error (spec 01). */
export type TokenProblem =
  | 'malformed'
  | 'alg'
  | 'unknown-key'
  | 'signature'
  | 'iss'
  | 'aud'
  | 'expired'
  | 'not-yet-valid'
  | 'nonce'
  | 'email-unverified'
  | 'sub';

/** Seconds of clock difference allowed on `exp` and `iat`. */
const LEEWAY_S = 60;

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

const dec = new TextDecoder();

function decodePart<T>(part: string): T | null {
  try {
    return JSON.parse(dec.decode(fromB64url(part))) as T;
  } catch {
    return null;
  }
}

export class GoogleOidc {
  private readonly endpoints: Endpoints;
  private keys = new Map<string, CryptoKey>();
  private keysFetchedAt = 0;
  private keysMaxAgeMs = 0;

  constructor(
    readonly config: GoogleConfig,
    private readonly now: () => number = Date.now,
  ) {
    if (config.testIssuer !== undefined) {
      // A build that may not use a fake refuses to start rather than quietly using Google.
      if (!TEST_ISSUER_BUILD) throw new Error('a test issuer is configured, but this build does not allow one');
      const base = config.testIssuer.replace(/\/$/, '');
      this.endpoints = { issuers: [base], authorize: `${base}/api/auth`, token: `${base}/token`, jwks: `${base}/certs` };
    } else {
      this.endpoints = GOOGLE;
    }
  }

  redirectUri(requestUrl: string): string {
    return `${(this.config.redirectBaseUrl ?? new URL(requestUrl).origin).replace(/\/$/, '')}/api/auth/google/callback`;
  }

  /** Where the browser goes to sign in. `prompt=select_account` always asks which account (spec 01). */
  async authorizeUrl(a: { state: string; nonce: string; verifier: string; redirectUri: string }): Promise<string> {
    const q = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: a.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: a.state,
      nonce: a.nonce,
      code_challenge: await pkceChallenge(a.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${this.endpoints.authorize}?${q}`;
  }

  /** Trades the code for an ID token at the token endpoint. Throws on any failure. */
  async exchange(code: string, verifier: string, redirectUri: string): Promise<string> {
    const res = await fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
    if (!res.ok || typeof body?.id_token !== 'string') throw new Error(`token endpoint: ${res.status} ${String(body?.error ?? '')}`);
    return body.id_token;
  }

  /**
   * Checks an ID token: RS256 signature against the issuer's published keys,
   * `iss`, `aud` (and `azp` when there are several audiences), `exp`, `iat`,
   * the `nonce` this sign-in sent, a `sub`, and `email_verified`.
   */
  async verify(idToken: string, nonce: string): Promise<GoogleIdentity | { problem: TokenProblem }> {
    const parts = idToken.split('.');
    if (parts.length !== 3) return { problem: 'malformed' };
    const [h, p, s] = parts as [string, string, string];
    const header = decodePart<{ alg?: unknown; kid?: unknown }>(h);
    const claims = decodePart<Record<string, unknown>>(p);
    if (!header || !claims) return { problem: 'malformed' };
    // Only RS256: never `none`, and never an HMAC keyed with a public key.
    if (header.alg !== 'RS256') return { problem: 'alg' };
    if (typeof header.kid !== 'string') return { problem: 'unknown-key' };
    const key = await this.key(header.kid);
    if (!key) return { problem: 'unknown-key' };
    let signature: Uint8Array;
    try {
      signature = fromB64url(s);
    } catch {
      return { problem: 'malformed' };
    }
    const signed = new TextEncoder().encode(`${h}.${p}`);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, signed))) return { problem: 'signature' };

    if (typeof claims.iss !== 'string' || !this.endpoints.issuers.includes(claims.iss)) return { problem: 'iss' };
    const aud = claims.aud;
    const audOk = Array.isArray(aud) ? aud.includes(this.config.clientId) && claims.azp === this.config.clientId : aud === this.config.clientId;
    if (!audOk) return { problem: 'aud' };
    const nowS = this.now() / 1000;
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S <= nowS) return { problem: 'expired' };
    if (typeof claims.iat === 'number' && claims.iat - LEEWAY_S > nowS) return { problem: 'not-yet-valid' };
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) return { problem: 'nonce' };
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return { problem: 'sub' };
    if (claims.email_verified !== true && claims.email_verified !== 'true') return { problem: 'email-unverified' };
    return {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase().slice(0, 320) : null,
      name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : null,
    };
  }

  /** The signing key `kid`, from the published keys, fetched again when they are stale or the key is new. */
  private async key(kid: string): Promise<CryptoKey | null> {
    const now = this.now();
    const stale = now - this.keysFetchedAt > this.keysMaxAgeMs;
    // A key we have not seen is worth one fetch a minute: keys rotate, but a forged kid must not cost a fetch each time.
    if (stale || (!this.keys.has(kid) && now - this.keysFetchedAt > 60_000)) {
      try {
        await this.fetchKeys();
      } catch {
        // Keep the keys we have; an unknown kid is refused below.
      }
    }
    return this.keys.get(kid) ?? null;
  }

  private async fetchKeys() {
    const res = await fetch(this.endpoints.jwks, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`jwks: ${res.status}`);
    const { keys } = (await res.json()) as { keys?: Jwk[] };
    const next = new Map<string, CryptoKey>();
    for (const k of keys ?? []) {
      if (k.kty !== 'RSA' || !k.kid || !k.n || !k.e || (k.alg && k.alg !== 'RS256') || (k.use && k.use !== 'sig')) continue;
      next.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    this.keys = next;
    this.keysFetchedAt = this.now();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.keysMaxAgeMs = Math.min(maxAge, 24 * 3600) * 1000;
  }
}
