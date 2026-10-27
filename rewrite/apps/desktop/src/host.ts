import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { GoogleConfig, PasskeyConfig } from '@gp/server';
import { startNodeServer } from '@gp/server/node';

/** Whether the host listens on the LAN (`GP_LAN=1`) rather than on this machine only. */
export const onLan = () => process.env.GP_LAN === '1';

/**
 * The embedded server: the sync and auth server plus the built web app, on
 * one port. It refuses every API request from a device it has not paired
 * (ADR 0007, decision 6), on localhost too; the host's own window carries
 * `hostToken`, which the main process adds to its requests. It listens on
 * localhost unless `GP_LAN=1`. Without a host token (the development server)
 * there is no pairing, unless it listens on the LAN.
 */
export async function startHost(opts: {
  dataDir: string;
  webRoot: string;
  hostToken: string | null;
  port?: number;
  google?: GoogleConfig;
  passkeys?: PasskeyConfig;
}) {
  mkdirSync(opts.dataDir, { recursive: true });
  return startNodeServer({
    dataDir: join(opts.dataDir, 'server'),
    driver: 'node:sqlite',
    hostname: onLan() ? '0.0.0.0' : '127.0.0.1',
    port: opts.port ?? 0,
    webRoot: opts.webRoot,
    // Off only for the localhost development server (serve.ts); never on the LAN.
    pairing: opts.hostToken || onLan() ? { hostToken: opts.hostToken ?? `gphost_${randomBytes(32).toString('base64url')}` } : undefined,
    setupToken: process.env.GP_SETUP_TOKEN || undefined,
    // The redirect is to this server on this machine: the system browser beside it comes back here.
    google: opts.google,
    passkeys: opts.passkeys,
  });
}

/** Addresses other devices can open the host at: its IPv4 LAN addresses, when it listens there. */
export function lanUrls(port: number): string[] {
  if (!onLan()) return [];
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
}

/** The page. `GP_STORAGE=memory` keeps its database in memory, as on a machine without OPFS. */
export function pageUrl(base: string, route = 'songs') {
  const q = process.env.GP_STORAGE === 'memory' ? '?storage=memory' : '';
  return `${base}/${route}${q}`;
}
