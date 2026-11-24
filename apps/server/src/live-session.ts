import type { Role } from '@gp/core';
import { sha256 } from './crypto.ts';
import type { Accounts } from './global/index.ts';

// A live socket's session, checked again after a message now and then (the security review, 2026-11-09): HTTP asks
// for the session on every request, but a socket was let in once. Signing out, a revoked session, a removed member or a
// new role ends the socket within this time of its next message. The check runs after the message, so a slide change
// never waits for the database; at most one more message gets through.

/** How long a live socket's session is trusted before its next message checks it again. */
export const LIVE_SESSION_CHECK_MS = 60_000;

/** The hash of the session token a socket was let in with, which is all it keeps. */
export const liveTokenHash = (token: string | null) => (token ? sha256(token) : Promise.resolve(null));

/** Whether the session behind `tokenHash` still stands for `who`: not signed out or revoked, a member with the same role. */
async function liveSessionHolds(accounts: Accounts, tokenHash: string | null, who: { userId: string; role: Role }): Promise<boolean> {
  const s = tokenHash ? await accounts.members.sessionByHash(tokenHash) : null;
  return !!s && s.userId === who.userId && s.role === who.role;
}

/** Whether a socket whose session was checked at `checkedAt` is due for its next check. */
export const recheckDue = (checkedAt: number, ms: number, now = Date.now()) => now - checkedAt >= ms;

/**
 * Closes the socket (`close`) when its session no longer holds, with the code a page reconnects on and is refused. A
 * check that fails (the database out of reach) leaves it open: the next message checks again.
 */
export async function endIfGone(accounts: Accounts, tokenHash: string | null, who: { userId: string; role: Role }, close: (code: number, reason: string) => void): Promise<void> {
  if (!(await liveSessionHolds(accounts, tokenHash, who).catch(() => true))) close(4401, 'session-ended');
}
