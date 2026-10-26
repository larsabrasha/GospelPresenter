import type { Role } from '@gp/core';
import type { Session } from './db/protocol.ts';

/**
 * Who is signed in. Placeholder until milestone 2: the desktop app passes
 * `?user=` and `?role=`, and a browser falls back to the operator. The server
 * checks the membership; the role here only drives optimistic checks.
 */
export function currentSession(): Session {
  const q = new URLSearchParams(location.search);
  const role = q.get('role');
  return {
    userId: q.get('user') ?? 'operator',
    orgId: q.get('org') ?? 'church',
    role: role === 'user' || role === 'superAdmin' ? (role as Role) : 'admin',
  };
}
