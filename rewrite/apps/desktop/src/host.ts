import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from '@gp/core';
import { startNodeServer } from '@gp/server/node';

/** The organisation and operator of milestone 1, until sign-in exists. */
export const ORG = 'church';
export const OPERATOR = { userId: 'operator', role: 'admin' as Role };

/**
 * The embedded server: the sync server plus the built web app, on one port.
 * It listens on localhost only. The LAN comes with pairing (ADR 0007,
 * decision 6); `GP_LAN=1` opens it anyway, for testing.
 */
export async function startHost(opts: { dataDir: string; webRoot: string; port?: number }) {
  mkdirSync(opts.dataDir, { recursive: true });
  return startNodeServer({
    dataDir: join(opts.dataDir, 'server'),
    driver: 'node:sqlite',
    hostname: process.env.GP_LAN === '1' ? '0.0.0.0' : '127.0.0.1',
    port: opts.port ?? 0,
    webRoot: opts.webRoot,
    members: [
      { userId: OPERATOR.userId, orgId: ORG, role: OPERATOR.role },
      // A second user for a second client in development and tests.
      { userId: 'second', orgId: ORG, role: 'user' },
    ],
  });
}

/** The page for a user, with the placeholder session in the query (see apps/web/src/session.ts). */
export function pageUrl(base: string, user: { userId: string; role: Role }, route = 'songs') {
  const q = new URLSearchParams({ user: user.userId, role: user.role, org: ORG });
  return `${base}/?${q}#/${route}`;
}
