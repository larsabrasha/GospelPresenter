// Pairing on a desktop host: which device a request comes from, and the
// guard that refuses every API request from a device that is not paired.
import type { Context, MiddlewareHandler } from 'hono';
import type { AuthError } from '@gp/core';
import { constantTimeEqual } from '../crypto.ts';
import type { Accounts } from '../global/index.ts';
import { credentials } from './caller.ts';

/** Pairing on a desktop host: only the host's own window and paired devices may use the API. */
export interface Pairing {
  /** Held by the host's main process, which adds it to its own window's requests; never stored. */
  hostToken: string;
}

export async function deviceOf(req: Request, accounts: Accounts, pairing: Pairing): Promise<'host' | 'paired' | null> {
  const { device } = credentials(req);
  if (!device) return null;
  if (constantTimeEqual(device, pairing.hostToken)) return 'host';
  return (await accounts.pairing.pairedDevice(device)) ? 'paired' : null;
}

/**
 * The anonymous outputs (spec 04 §5, §6): public outputs, saved screens and temporary screens. And a video's
 * stream (`/api/play/{token}/…`), whose token, minted for a paired device's session, is its credential:
 * a `<video src>` cannot send the device's header.
 */
const ANONYMOUS_PREFIXES = ['/api/watch/', '/api/display/', '/api/screen/', '/api/play/'];
/** Paths an unpaired device may reach: the pairing itself. Everything outside the API is the static app. */
const OPEN_PATHS = new Set(['/api/pair/status', '/api/pair/claim']);
/**
 * The host's own sign-in, which runs in the system browser of the host's
 * machine (spec 01 device sign-in): Google, or a passkey ceremony. That
 * browser is not paired, so these answer it, but only from this machine: a
 * device on the LAN never signs in against the host, it pairs.
 */
const LOOPBACK_PATHS = new Set([
  '/api/app-login',
  '/api/auth/google/start',
  '/api/auth/google/callback',
  '/api/auth/app-callback.js',
  '/api/auth/passkey/start',
  '/api/auth/passkey/finish',
  '/api/auth/passkey.js',
]);
/** Everything the server answers itself is under `/api/`; every other path is the web app. */
export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/** Whether a socket address is this machine. */
export function isLoopback(address: string): boolean {
  return address === '::1' || /^(::ffff:)?127\./.test(address);
}

/** Refuses every API request from a device that is not paired, before anything else runs. */
export function pairingGuard(accounts: Accounts, pairing: Pairing, clientAddress: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    // Public outputs and screens are for anyone on the LAN, paired or not (spec 04 §5, §6): a TV is no device that signs in.
    if (!isApiPath(c.req.path) || OPEN_PATHS.has(c.req.path) || ANONYMOUS_PREFIXES.some((p) => c.req.path.startsWith(p)) || c.req.path === '/api/screen') return next();
    if (LOOPBACK_PATHS.has(c.req.path) && isLoopback(clientAddress(c))) return next();
    if (!(await deviceOf(c.req.raw, accounts, pairing))) return c.json({ error: 'device-not-paired' satisfies AuthError }, 403);
    return next();
  };
}
