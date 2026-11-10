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
export async function liveSessionHolds(accounts: Accounts, tokenHash: string | null, who: { userId: string; role: Role }): Promise<boolean> {
  const s = tokenHash ? await accounts.members.sessionByHash(tokenHash) : null;
  return !!s && s.userId === who.userId && s.role === who.role;
}
