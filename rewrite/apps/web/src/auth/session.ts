import type { Me, Role, SignInResponse } from '@gp/core';
import type { Session } from '../db/protocol.ts';

// Who is signed in on this device. The session token and the identity the
// server last gave are kept in localStorage, so a signed-in device opens
// straight into its own database, also with no network (spec 06 "Device
// identity": no client-side expiry). The server decides on every request.

const SESSION_KEY = 'gp.session';
/** The token a desktop host gave this device when it was paired; kept across sign-outs. */
const DEVICE_KEY = 'gp.device';

export interface StoredSession {
  token: string;
  me: Me;
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null; // corrupt or unreadable: treated as signed out (DESK-R6)
  }
}

function write(key: string, value: unknown) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

export function storedSession(): StoredSession | null {
  const s = read<StoredSession>(SESSION_KEY);
  return s && typeof s.token === 'string' && s.me?.userId && s.me.orgId ? s : null;
}

export function saveSession(r: SignInResponse) {
  write(SESSION_KEY, r);
}

/** Forgets the session on this device. The local database stays (D3): signing in again as the same user resumes it. */
export function forgetSession() {
  write(SESSION_KEY, null);
}

export function updateMe(me: Me) {
  const s = storedSession();
  if (s) write(SESSION_KEY, { ...s, me });
}

export function deviceToken(): string | null {
  return read<string>(DEVICE_KEY);
}

export function saveDeviceToken(token: string | null) {
  write(DEVICE_KEY, token);
}

/** `?storage=memory` keeps the database in memory even where OPFS exists (development and tests). */
export function memoryOnly(): boolean {
  return new URLSearchParams(location.search).get('storage') === 'memory';
}

/** What the database worker needs to open this user's database and sync it. */
export function workerSession(s: StoredSession): Session {
  return {
    userId: s.me.userId,
    orgId: s.me.orgId,
    role: s.me.role as Role,
    token: s.token,
    device: deviceToken(),
    ...(memoryOnly() ? { storage: 'memory' as const } : {}),
  };
}

/** A name for this device in the server's lists. */
export function deviceName(): string {
  return window.gpDesktop?.deviceName ?? (navigator.userAgent.match(/iPad|iPhone|Android|Macintosh|Windows|Linux/)?.[0] ?? 'Webbläsare');
}
