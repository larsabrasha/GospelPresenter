// Who is calling: the credentials a request carries and the session they name.
import type { AuthError, MutatorCtx } from '@gp/core';
import type { Accounts } from '../global/index.ts';

export interface Caller {
  orgId: string;
  sessionId: string;
  ctx: MutatorCtx;
  /** When the sign-in that made the session happened. */
  signedInAt: number;
  /** The session was made by pairing at a desktop host, not by the user signing in. */
  paired: boolean;
}

/** The WebSocket subprotocol a poke socket is answered with; the others carry credentials. */
export const WS_PROTOCOL = 'gp.v1';

/**
 * The bearer token and the paired-device token of a request. Browsers cannot
 * set headers on a WebSocket, so a poke socket offers them as subprotocols
 * (`gp.auth.<token>`, `gp.device.<token>`) rather than in the URL, which
 * would put them in logs.
 */
export function credentials(req: Request): { token: string | null; device: string | null } {
  const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const fromProtocol = (prefix: string) => offered.find((p) => p.startsWith(prefix))?.slice(prefix.length) || null;
  const auth = req.headers.get('authorization');
  return {
    token: auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : fromProtocol('gp.auth.'),
    device: req.headers.get('x-gp-device') ?? fromProtocol('gp.device.'),
  };
}

const refuse = (status: 401 | 403, error: AuthError) => Response.json({ error }, { status });

/**
 * Who is calling: a session that exists, is not revoked or idle too long,
 * and whose user is still a member of its organisation, with the role read
 * now (D22). The organisation is the session's, never the client's (SYNC-R1).
 */
export async function authenticate(req: Request, accounts: Accounts): Promise<Caller | Response> {
  const { token } = credentials(req);
  const s = token ? await accounts.session(token) : null;
  if (!s) return refuse(401, 'unauthenticated');
  if (!s.role) return refuse(403, 'not-a-member');
  return { orgId: s.orgId, sessionId: s.sessionId, ctx: { userId: s.userId, role: s.role }, signedInAt: s.createdAt, paired: s.paired };
}
