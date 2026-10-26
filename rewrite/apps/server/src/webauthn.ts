// Passkeys (WebAuthn level 3): the registration and authentication
// ceremonies, verified here with Web Crypto alone, so the same code runs on
// Node, Workers and in Electron with no dependency, as google.ts does. Only
// what a relying party that asks for no attestation needs: a small CBOR
// reader, COSE keys for ES256, EdDSA and RS256, and the checks of the spec's
// sections 7.1 and 7.2.
import type { PasskeyCreationOptions, PasskeyCredentialJson, PasskeyRequestOptions } from '@gp/core';
import { b64url, fromB64url } from './crypto.ts';

/** Where passkeys are valid. A passkey is bound to its RP ID: one made for one RP ID never works for another. */
export interface PasskeyConfig {
  /** A domain, e.g. `app.example.org`, or `localhost`. Never an IP address: browsers refuse those. */
  rpId: string;
  /** The exact origins a ceremony may come from, e.g. `https://app.example.org`; each must be the RP ID or below it. */
  origins: string[];
  /** Shown by the authenticator beside the account. */
  rpName?: string;
}

/** Why a ceremony was refused. Logged, never shown: the user sees one generic error (spec 01). */
export type PasskeyProblem =
  | 'malformed'
  | 'type'
  | 'origin'
  | 'cross-origin'
  | 'rp-id'
  | 'user-present'
  | 'user-verified'
  | 'flags'
  | 'credential-id'
  | 'alg'
  | 'key'
  | 'attestation'
  | 'signature'
  | 'user-handle'
  | 'counter';

/** COSE algorithms offered, in order of preference: ES256, EdDSA (Ed25519), RS256. */
export const PASSKEY_ALGS = [-7, -8, -257] as const;

/** How long the browser may wait for the authenticator. The flow itself lives PASSKEY_FLOW.ttlMs. */
const TIMEOUT_MS = 4 * 60_000;
const MAX_CREDENTIAL_ID = 1023; // bytes (WebAuthn L3 5.1)

const enc = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

// ---------------------------------------------------------------- CBOR (RFC 8949), the subset WebAuthn uses

export type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<number | string, Cbor>;

class CborError extends Error {}

/**
 * Decodes one CBOR item at `offset`; returns it and where it ends. Definite
 * lengths only, integers within 2^53, map keys that are integers or text, no
 * duplicate keys, no tags and no floats: WebAuthn needs nothing else, and
 * anything else is refused.
 */
export function decodeCbor(bytes: Uint8Array, offset = 0, depth = 0): { value: Cbor; end: number } {
  if (depth > 16) throw new CborError('too deep');
  const need = (n: number) => {
    if (offset + n > bytes.length) throw new CborError('truncated');
  };
  need(1);
  const head = bytes[offset++]!;
  const major = head >> 5;
  const info = head & 0x1f;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) {
    need(1);
    n = bytes[offset++]!;
  } else if (info === 25) {
    need(2);
    n = (bytes[offset]! << 8) | bytes[offset + 1]!;
    offset += 2;
  } else if (info === 26) {
    need(4);
    n = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    offset += 4;
  } else if (info === 27) {
    need(8);
    const big = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError('integer too large');
    n = Number(big);
    offset += 8;
  } else throw new CborError('indefinite or reserved length');

  switch (major) {
    case 0:
      return { value: n, end: offset };
    case 1:
      return { value: -1 - n, end: offset };
    case 2:
      need(n);
      return { value: bytes.slice(offset, offset + n), end: offset + n };
    case 3:
      need(n);
      try {
        return { value: strictUtf8.decode(bytes.subarray(offset, offset + n)), end: offset + n };
      } catch {
        throw new CborError('bad utf-8');
      }
    case 4: {
      const items: Cbor[] = [];
      for (let i = 0; i < n; i++) {
        const r = decodeCbor(bytes, offset, depth + 1);
        items.push(r.value);
        offset = r.end;
      }
      return { value: items, end: offset };
    }
    case 5: {
      const map = new Map<number | string, Cbor>();
      for (let i = 0; i < n; i++) {
        const k = decodeCbor(bytes, offset, depth + 1);
        if (typeof k.value !== 'number' && typeof k.value !== 'string') throw new CborError('map key');
        if (map.has(k.value)) throw new CborError('duplicate key');
        const v = decodeCbor(bytes, k.end, depth + 1);
        map.set(k.value, v.value);
        offset = v.end;
      }
      return { value: map, end: offset };
    }
    case 7:
      if (info === 20) return { value: false, end: offset };
      if (info === 21) return { value: true, end: offset };
      if (info === 22) return { value: null, end: offset };
      throw new CborError('simple value');
    default:
      throw new CborError('tag');
  }
}

/** One CBOR item that fills `bytes` exactly. */
function decodeWhole(bytes: Uint8Array): Cbor {
  const { value, end } = decodeCbor(bytes);
  if (end !== bytes.length) throw new CborError('trailing bytes');
  return value;
}

// ---------------------------------------------------------------- COSE keys (RFC 9053) and signatures

interface PublicKey {
  alg: number;
  key: CryptoKey;
}

const bytesOf = (m: Map<number | string, Cbor>, k: number, len?: number) => {
  const v = m.get(k);
  return v instanceof Uint8Array && (len === undefined || v.length === len) ? v : null;
};

/** Imports a COSE public key. Null for any key this server does not accept. */
export async function importCoseKey(cose: Uint8Array): Promise<PublicKey | null> {
  let m: Cbor;
  try {
    m = decodeWhole(cose);
  } catch {
    return null;
  }
  if (!(m instanceof Map)) return null;
  const kty = m.get(1);
  const alg = m.get(3);
  try {
    if (alg === -7 && kty === 2 && m.get(-1) === 1) {
      const x = bytesOf(m, -2, 32);
      const y = bytesOf(m, -3, 32);
      if (!x || !y) return null;
      const jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y), ext: true };
      return { alg, key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) };
    }
    if (alg === -8 && kty === 1 && m.get(-1) === 6) {
      const x = bytesOf(m, -2, 32);
      if (!x) return null;
      return { alg, key: await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: b64url(x), ext: true }, { name: 'Ed25519' }, false, ['verify']) };
    }
    if (alg === -257 && kty === 3) {
      const n = bytesOf(m, -1);
      const e = bytesOf(m, -2);
      // At least 2048 bits, as NIST and the FIDO metadata require.
      if (!n || !e || n.length < 256 || n[0] === 0 || e.length > 8) return null;
      const jwk = { kty: 'RSA', n: b64url(n), e: b64url(e), alg: 'RS256', ext: true };
      return { alg, key: await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) };
    }
  } catch {
    return null; // e.g. a point that is not on the curve
  }
  return null;
}

/**
 * An ECDSA signature as WebAuthn sends it (ASN.1 DER: SEQUENCE of two
 * INTEGERs) in the fixed-width r||s that Web Crypto verifies. Null if it is
 * not strict DER for a `size`-byte curve.
 */
export function derToRaw(der: Uint8Array, size = 32): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const out = new Uint8Array(size * 2);
  let at = 2;
  for (let i = 0; i < 2; i++) {
    if (der[at] !== 0x02) return null;
    const len = der[at + 1]!;
    if (len < 1 || at + 2 + len > der.length) return null;
    let int = der.subarray(at + 2, at + 2 + len);
    // DER: a leading zero only to keep a high bit from reading as negative.
    if (int[0]! & 0x80) return null;
    if (int.length > 1 && int[0] === 0 && !(int[1]! & 0x80)) return null;
    if (int[0] === 0) int = int.subarray(1);
    if (int.length > size) return null;
    out.set(int, (i + 1) * size - int.length);
    at += 2 + len;
  }
  return at === der.length ? out : null;
}

async function verifySignature(k: PublicKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    if (k.alg === -7) {
      const raw = derToRaw(signature);
      return !!raw && (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.key, raw as BufferSource, data as BufferSource));
    }
    if (k.alg === -8) return await crypto.subtle.verify({ name: 'Ed25519' }, k.key, signature as BufferSource, data as BufferSource);
    if (k.alg === -257) return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k.key, signature as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------- authenticator data (WebAuthn 6.1)

const FLAG = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40, ed: 0x80 } as const;

interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credential?: { id: Uint8Array; publicKey: Uint8Array };
}

function parseAuthData(bytes: Uint8Array): AuthData | null {
  try {
    if (bytes.length < 37) return null;
    const flags = bytes[32]!;
    const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
    let at = 37;
    let credential: AuthData['credential'];
    if (flags & FLAG.at) {
      if (bytes.length < at + 18) return null;
      const idLen = (bytes[at + 16]! << 8) | bytes[at + 17]!;
      at += 18; // the AAGUID, then the id's length
      if (idLen < 16 || idLen > MAX_CREDENTIAL_ID || bytes.length < at + idLen) return null;
      const id = bytes.slice(at, at + idLen);
      at += idLen;
      const key = decodeCbor(bytes, at);
      credential = { id, publicKey: bytes.slice(at, key.end) };
      at = key.end;
    }
    if (flags & FLAG.ed) at = decodeCbor(bytes, at).end; // extension outputs: none asked for, none used
    if (at !== bytes.length) return null;
    return { rpIdHash: bytes.subarray(0, 32), flags, signCount, credential };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- client data (WebAuthn 5.8.1)

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin: boolean;
  /** The bytes as sent, which the signature covers through their hash. */
  raw: Uint8Array;
}

/** The client data of a credential, for finding its flow by challenge before anything is verified. */
export function parseClientData(b64: string): ClientData | null {
  try {
    const raw = fromB64url(b64);
    const j = JSON.parse(strictUtf8.decode(raw)) as Record<string, unknown>;
    if (typeof j.type !== 'string' || typeof j.challenge !== 'string' || typeof j.origin !== 'string') return null;
    if (j.crossOrigin !== undefined && typeof j.crossOrigin !== 'boolean') return null;
    return { type: j.type, challenge: j.challenge, origin: j.origin, crossOrigin: j.crossOrigin === true, raw };
  } catch {
    return null;
  }
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** A credential that registration verified, ready to store. */
export interface NewPasskey {
  /** base64url, as `user_logins.subject`. */
  id: string;
  /** The COSE key, base64url. */
  publicKey: string;
  signCount: number;
  transports: string[];
}

/** A stored passkey, as authentication needs it. */
export interface StoredPasskey {
  publicKey: string;
  signCount: number;
  userId: string;
}

const TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']);

/** The user handle a user's passkeys carry: their id, which is random and says nothing about them. */
export const userHandle = (userId: string) => b64url(enc.encode(userId));

const isIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');

export class Passkeys {
  readonly rpId: string;
  readonly origins: ReadonlySet<string>;
  private readonly rpName: string;
  private rpIdHash: Promise<Uint8Array>;

  constructor(config: PasskeyConfig) {
    const rpId = config.rpId.trim().toLowerCase();
    // A wrong configuration fails at start, not at the first sign-in.
    if (!rpId || isIp(rpId) || !/^[a-z0-9.-]+$/.test(rpId)) throw new Error(`passkeys: "${config.rpId}" is not a valid RP ID (a domain, never an IP address)`);
    if (!config.origins.length) throw new Error('passkeys: no allowed origins');
    for (const o of config.origins) {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new Error(`passkeys: "${o}" is not an origin`);
      }
      if (u.origin !== o) throw new Error(`passkeys: "${o}" is not an origin (no path, no trailing slash)`);
      if (u.hostname !== rpId && !u.hostname.endsWith(`.${rpId}`)) throw new Error(`passkeys: ${o} is not on the RP ID ${rpId}`);
      // WebAuthn needs a secure context: https, or http on localhost.
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname.endsWith('.localhost')))) {
        throw new Error(`passkeys: ${o} is not a secure context`);
      }
    }
    this.rpId = rpId;
    this.origins = new Set(config.origins);
    this.rpName = config.rpName ?? 'Gospel Presenter';
    this.rpIdHash = sha256(enc.encode(rpId));
  }

  /**
   * Options for making a discoverable passkey that needs user verification,
   * with no attestation. `exclude` keeps one authenticator from getting a
   * second passkey for the same user.
   */
  creationOptions(a: { challenge: string; userId: string; name: string; displayName: string; exclude: { id: string; transports: string[] }[] }): PasskeyCreationOptions {
    return {
      challenge: a.challenge,
      rp: { id: this.rpId, name: this.rpName },
      user: { id: userHandle(a.userId), name: a.name, displayName: a.displayName },
      pubKeyCredParams: PASSKEY_ALGS.map((alg) => ({ type: 'public-key', alg })),
      timeout: TIMEOUT_MS,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: a.exclude.map((c) => ({ type: 'public-key', id: c.id, ...(c.transports.length ? { transports: c.transports } : {}) })),
    };
  }

  /** Options for signing in with any passkey for this RP ID: no user is named, the passkey says who (discoverable). */
  requestOptions(challenge: string): PasskeyRequestOptions {
    return { challenge, rpId: this.rpId, timeout: TIMEOUT_MS, userVerification: 'required', allowCredentials: [] };
  }

  /** Steps shared by both ceremonies: the client data, the RP ID hash and the flags (7.1 steps 5–17, 7.2 steps 8–19). */
  private async common(cd: ClientData, type: string, auth: AuthData): Promise<PasskeyProblem | null> {
    if (cd.type !== type) return 'type';
    if (!this.origins.has(cd.origin)) return 'origin';
    if (cd.crossOrigin) return 'cross-origin';
    if (!sameBytes(auth.rpIdHash, await this.rpIdHash)) return 'rp-id';
    if (!(auth.flags & FLAG.up)) return 'user-present';
    if (!(auth.flags & FLAG.uv)) return 'user-verified';
    if (auth.flags & FLAG.bs && !(auth.flags & FLAG.be)) return 'flags';
    return null;
  }

  /**
   * Registration (WebAuthn 7.1). The caller has already found the flow by
   * the client data's challenge. Attestation is not trusted for anything:
   * "none" is asked for, and a statement sent anyway is ignored, except a
   * packed self-attestation, which is cheap to check and is checked.
   */
  async verifyRegistration(cred: PasskeyCredentialJson, cd: ClientData): Promise<NewPasskey | { problem: PasskeyProblem }> {
    let att: Cbor;
    try {
      att = decodeWhole(fromB64url(cred.response.attestationObject ?? ''));
    } catch {
      return { problem: 'malformed' };
    }
    if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !(att.get('attStmt') instanceof Map) || !(att.get('authData') instanceof Uint8Array)) {
      return { problem: 'malformed' };
    }
    const authBytes = att.get('authData') as Uint8Array;
    const auth = parseAuthData(authBytes);
    if (!auth) return { problem: 'malformed' };
    const problem = await this.common(cd, 'webauthn.create', auth);
    if (problem) return { problem };
    if (!(auth.flags & FLAG.at) || !auth.credential) return { problem: 'malformed' };
    if (b64url(auth.credential.id) !== cred.id) return { problem: 'credential-id' };
    const key = await importCoseKey(auth.credential.publicKey);
    if (!key) return { problem: 'key' };
    if (!(PASSKEY_ALGS as readonly number[]).includes(key.alg)) return { problem: 'alg' };

    const fmt = att.get('fmt') as string;
    const stmt = att.get('attStmt') as Map<number | string, Cbor>;
    if (fmt === 'none' && stmt.size !== 0) return { problem: 'attestation' };
    if (fmt === 'packed' && !stmt.has('x5c')) {
      const sig = stmt.get('sig');
      if (stmt.get('alg') !== key.alg || !(sig instanceof Uint8Array)) return { problem: 'attestation' };
      if (!(await verifySignature(key, sig, concat(authBytes, await sha256(cd.raw))))) return { problem: 'attestation' };
    }
    return {
      id: cred.id,
      publicKey: b64url(auth.credential.publicKey),
      signCount: auth.signCount,
      transports: [...new Set((cred.response.transports ?? []).filter((t) => TRANSPORTS.has(t)))],
    };
  }

  /**
   * Authentication (WebAuthn 7.2) with a stored passkey. Answers the new
   * signature counter. A counter of 0 on both sides means the authenticator
   * keeps none (passkeys that sync usually do not); otherwise it must have
   * grown, or the passkey may have been cloned and is refused.
   */
  async verifyAssertion(cred: PasskeyCredentialJson, cd: ClientData, stored: StoredPasskey): Promise<{ signCount: number } | { problem: PasskeyProblem }> {
    const r = cred.response;
    if (!r.authenticatorData || !r.signature) return { problem: 'malformed' };
    // Discoverable sign-in names no user first, so the passkey must say whose it is, and be theirs.
    if (!r.userHandle || r.userHandle !== userHandle(stored.userId)) return { problem: 'user-handle' };
    let authBytes: Uint8Array;
    let signature: Uint8Array;
    try {
      authBytes = fromB64url(r.authenticatorData);
      signature = fromB64url(r.signature);
    } catch {
      return { problem: 'malformed' };
    }
    const auth = parseAuthData(authBytes);
    if (!auth || auth.credential) return { problem: 'malformed' };
    const problem = await this.common(cd, 'webauthn.get', auth);
    if (problem) return { problem };
    const key = await importCoseKey(fromB64url(stored.publicKey));
    if (!key) return { problem: 'key' };
    if (!(await verifySignature(key, signature, concat(authBytes, await sha256(cd.raw))))) return { problem: 'signature' };
    if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) return { problem: 'counter' };
    return { signCount: auth.signCount };
  }
}
