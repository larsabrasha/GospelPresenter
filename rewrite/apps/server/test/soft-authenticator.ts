// A software authenticator for tests: makes passkeys with real key pairs
// (ES256, EdDSA or RS256), and answers creation and request options as a
// browser and a platform authenticator together would: client data,
// authenticator data, attestation "none" in CBOR, and signatures. Each
// answer can be spoiled in one way, to check that the server refuses it.
import type { PasskeyCreationOptions, PasskeyCredentialJson, PasskeyRequestOptions } from '@gp/core';

const enc = new TextEncoder();
export const b64url = (b: Uint8Array | ArrayBuffer | string) =>
  Buffer.from(typeof b === 'string' ? enc.encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

// ---------------------------------------------------------------- CBOR encoding (what authenticators send)

type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<number | string, Cbor>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function cbor(v: Cbor): Uint8Array {
  const out: number[] = [];
  const put = (x: Cbor) => {
    if (typeof x === 'number') out.push(...(x >= 0 ? head(0, x) : head(1, -1 - x)));
    else if (typeof x === 'string') {
      const b = enc.encode(x);
      out.push(...head(3, b.length), ...b);
    } else if (x instanceof Uint8Array) out.push(...head(2, x.length), ...x);
    else if (Array.isArray(x)) {
      out.push(...head(4, x.length));
      x.forEach(put);
    } else if (x instanceof Map) {
      out.push(...head(5, x.size));
      for (const [k, val] of x) {
        put(k);
        put(val);
      }
    } else out.push(x === false ? 0xf4 : x === true ? 0xf5 : 0xf6);
  };
  put(v);
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- keys

export type Alg = -7 | -8 | -257;

async function newKey(alg: Alg): Promise<CryptoKeyPair> {
  if (alg === -7) return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  if (alg === -8) return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
}

async function coseKey(alg: Alg, key: CryptoKey): Promise<Uint8Array> {
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as Record<string, string>;
  if (alg === -7) return cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x!)], [-3, fromB64url(jwk.y!)]]));
  if (alg === -8) return cbor(new Map<number, Cbor>([[1, 1], [3, -8], [-1, 6], [-2, fromB64url(jwk.x!)]]));
  return cbor(new Map<number, Cbor>([[1, 3], [3, -257], [-1, fromB64url(jwk.n!)], [-2, fromB64url(jwk.e!)]]));
}

/** r||s as Web Crypto signs, to ASN.1 DER as authenticators send ES256. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    return v[0]! & 0x80 ? [0x02, v.length + 1, 0, ...v] : [0x02, v.length, ...v];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function sign(alg: Alg, key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (alg === -7) return rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data as BufferSource)));
  if (alg === -8) return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, data as BufferSource));
  return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data as BufferSource));
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Ways one answer can be wrong. */
export type Spoil =
  | 'origin'
  | 'rp-id'
  | 'no-uv'
  | 'no-up'
  | 'signature'
  | 'type'
  | 'cross-origin'
  | 'user-handle'
  | 'challenge'
  | 'attestation'
  | 'counter-regress';

interface Credential {
  id: Uint8Array;
  alg: Alg;
  keys: CryptoKeyPair;
  rpId: string;
  userHandle: string;
  signCount: number;
}

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];

  /**
   * @param origin what the "browser" puts in the client data.
   * @param counter how the signature counter moves: 'none' keeps it at 0, as synced passkeys do.
   */
  constructor(
    readonly origin: string,
    private readonly opts: { alg?: Alg; counter?: 'increment' | 'none'; fmt?: 'none' | 'packed' } = {},
  ) {}

  private clientData(type: string, challenge: string, spoil?: Spoil): Uint8Array {
    return enc.encode(
      JSON.stringify({
        type: spoil === 'type' ? (type === 'webauthn.create' ? 'webauthn.get' : 'webauthn.create') : type,
        challenge: spoil === 'challenge' ? b64url(crypto.getRandomValues(new Uint8Array(32))) : challenge,
        origin: spoil === 'origin' ? 'https://evil.example' : this.origin,
        crossOrigin: spoil === 'cross-origin',
      }),
    );
  }

  private async authData(rpId: string, signCount: number, spoil: Spoil | undefined, attested?: Uint8Array): Promise<Uint8Array> {
    const flags = (spoil === 'no-up' ? 0 : 0x01) | (spoil === 'no-uv' ? 0 : 0x04) | (attested ? 0x40 : 0);
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, signCount);
    return concat(await sha256(enc.encode(spoil === 'rp-id' ? 'evil.example' : rpId)), new Uint8Array([flags]), count, attested ?? new Uint8Array());
  }

  /** `navigator.credentials.create()`, answered. */
  async create(o: PasskeyCreationOptions, spoil?: Spoil): Promise<PasskeyCredentialJson> {
    const alg = this.opts.alg ?? -7;
    if (!o.pubKeyCredParams.some((p) => p.alg === alg)) throw new Error(`alg ${alg} not offered`);
    if (o.excludeCredentials.some((c) => this.credentials.some((k) => b64url(k.id) === c.id))) throw new Error('InvalidStateError: excluded');
    const cred: Credential = {
      id: crypto.getRandomValues(new Uint8Array(32)),
      alg,
      keys: await newKey(alg),
      rpId: o.rp.id,
      userHandle: o.user.id,
      signCount: this.opts.counter === 'none' ? 0 : 1,
    };
    const idLen = new Uint8Array([0, cred.id.length]);
    const attested = concat(new Uint8Array(16), idLen, cred.id, await coseKey(alg, cred.keys.publicKey));
    const authData = await this.authData(o.rp.id, cred.signCount, spoil, attested);
    const clientDataJSON = this.clientData('webauthn.create', o.challenge, spoil);
    const fmt = this.opts.fmt ?? 'none';
    let attStmt = new Map<number | string, Cbor>();
    if (fmt === 'packed') {
      const sig = await sign(alg, cred.keys.privateKey, concat(authData, await sha256(clientDataJSON)));
      attStmt = new Map<string, Cbor>([
        ['alg', alg],
        ['sig', spoil === 'attestation' ? sig.map((b) => b ^ 1) : sig],
      ]);
    } else if (spoil === 'attestation') attStmt.set('sig', new Uint8Array([1]));
    this.credentials.push(cred);
    return {
      id: b64url(cred.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(cbor(new Map<string, Cbor>([['fmt', fmt], ['attStmt', attStmt], ['authData', authData]]))),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** `navigator.credentials.get()` with an empty allow list: the newest passkey for the RP ID (or `pick`). */
  async get(o: PasskeyRequestOptions, spoil?: Spoil, pick?: string): Promise<PasskeyCredentialJson> {
    const cred = this.credentials.toReversed().find((c) => c.rpId === o.rpId && (!pick || b64url(c.id) === pick));
    if (!cred) throw new Error('NotAllowedError: no passkey for this RP ID');
    if (this.opts.counter !== 'none') cred.signCount += 1;
    const count = spoil === 'counter-regress' ? Math.max(0, cred.signCount - 2) : cred.signCount;
    const authData = await this.authData(o.rpId, count, spoil);
    const clientDataJSON = this.clientData('webauthn.get', o.challenge, spoil);
    let signature = await sign(cred.alg, cred.keys.privateKey, concat(authData, await sha256(clientDataJSON)));
    if (spoil === 'signature') signature = await sign(cred.alg, (await newKey(cred.alg)).privateKey, concat(authData, await sha256(clientDataJSON)));
    return {
      id: b64url(cred.id),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: spoil === 'user-handle' ? b64url('someone-else') : cred.userHandle,
      },
    };
  }
}
