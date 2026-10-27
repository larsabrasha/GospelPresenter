import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { GoogleConfig, PasskeyConfig } from '@gp/server';
import { startNodeServer } from '@gp/server/node';

/** Whether the host listens on the LAN (`GP_LAN=1`) rather than on this machine only. */
export const onLan = () => process.env.GP_LAN === '1';

/** The https port when a certificate is given: the http port's neighbour by default. */
export const TLS_PORT = 47843;

/**
 * The operator's own certificate (README, "https on the LAN"): `GP_TLS_CERT`
 * and `GP_TLS_KEY` are paths to PEM files, `GP_TLS_PORT` the port. Both files,
 * or neither; a file that cannot be read stops the host at start.
 */
export function tlsConfig(): { key: string; cert: string; port: number } | null {
  const cert = process.env.GP_TLS_CERT;
  const key = process.env.GP_TLS_KEY;
  if (!cert && !key) return null;
  if (!cert || !key) throw new Error('GP_TLS_CERT and GP_TLS_KEY go together: set both, or neither');
  return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8'), port: Number(process.env.GP_TLS_PORT || TLS_PORT) };
}

/**
 * The embedded server: the sync and auth server plus the built web app, on
 * one port. It refuses every API request from a device it has not paired
 * (ADR 0007, decision 6), on localhost too; the host's own window carries
 * `hostToken`, which the main process adds to its requests. It listens on
 * localhost unless `GP_LAN=1`. Without a host token (the development server)
 * there is no pairing, unless it listens on the LAN. With a certificate
 * (`tlsConfig`) it also serves https, and the LAN gets that instead of http.
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
  const tls = tlsConfig();
  return startNodeServer({
    dataDir: join(opts.dataDir, 'server'),
    driver: 'node:sqlite',
    // With a certificate the LAN gets https only; plain http stays on this machine, for the host's own window.
    hostname: onLan() && !tls ? '0.0.0.0' : '127.0.0.1',
    tls: tls ? { ...tls, hostname: onLan() ? '0.0.0.0' : '127.0.0.1' } : undefined,
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

/**
 * Addresses other devices can open the host at: its IPv4 LAN addresses, when
 * it listens there; over https on the https port when it has a certificate.
 * The certificate decides which names a device accepts: `GP_TLS_HOSTNAME`
 * (e.g. the Mac's `name.local`) is used instead of the addresses when set.
 */
export function lanUrls(port: number, tlsPort: number | null = null): string[] {
  if (!onLan()) return [];
  const scheme = tlsPort ? 'https' : 'http';
  const p = tlsPort ?? port;
  if (tlsPort && process.env.GP_TLS_HOSTNAME) return [`https://${process.env.GP_TLS_HOSTNAME}:${p}`];
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `${scheme}://${i!.address}:${p}`);
}

/** The page. `GP_STORAGE=memory` keeps its database in memory, as on a machine without OPFS. */
export function pageUrl(base: string, route = 'songs') {
  const q = process.env.GP_STORAGE === 'memory' ? '?storage=memory' : '';
  return `${base}/${route}${q}`;
}
