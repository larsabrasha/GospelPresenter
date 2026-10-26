// Secrets on every runtime through Web Crypto alone: Node, Workers and
// Electron all have it, and nothing needs a native build.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * A bearer secret: `prefix` + 43 base64url characters (32 random bytes), the
 * shape of spec 01's device token. Shown once; only its hash is stored (AUTH-R13).
 */
export function newSecret(prefix: string): string {
  return prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A random id that names a row, never a secret. */
export function newRowId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** A code of `digits` decimal digits, uniformly random. */
export function newDigits(digits: number): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x1_0000_0000 / max) * max; // reject the biased tail
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n! < limit) return String(n! % max).padStart(digits, '0');
  }
}

/** How a secret is looked up: its SHA-256, hex. Secrets have 256 bits, so no salt is needed. */
export async function sha256(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(secret)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares without an early exit, so the time taken says nothing about where two values differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * PBKDF2-HMAC-SHA256 at OWASP's 2023 figure. Web Crypto has no scrypt or
 * argon2, and PBKDF2 is the one KDF that runs unchanged in Node, Workers and
 * Electron without a native module (README, "Assumptions").
 */
export const PBKDF2_ITERATIONS = 600_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`: the parameters travel with the hash, so they can be raised later. */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}

/** Hashed with the same cost when there is no account, so a wrong email takes as long as a wrong password. */
const DUMMY = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, iter, salt, hash] = (stored ?? DUMMY).split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash || !Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  const actual = b64url(await pbkdf2(password, fromB64url(salt), iterations));
  return constantTimeEqual(actual, hash) && stored !== null;
}
