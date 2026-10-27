import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { GoogleConfig, PasskeyConfig } from '@gp/server';
import { startNodeServer } from '@gp/server/node';

/** Whether the host listens on the LAN (`GP_LAN=1`) rather than on this machine only. */
export const onLan = () => process.env.GP_LAN === '1';

/** The https port when a certificate is given: the http port's neighbour by default. */
export const TLS_PORT = 47843;

/**
 * The certificate for https on the LAN (README, "https on the LAN"), or null
 * for none. `GP_TLS_CERT` and `GP_TLS_KEY` are paths to the operator's own
 * PEM files. `GP_TLS=self-signed` instead has the host make one, kept in its
 * data folder so a device that accepted it once keeps accepting it; each
 * device then accepts it in its browser's warning. `GP_TLS_PORT` is the port.
 */
export function tlsConfig(dataDir: string): { key: string; cert: string; port: number } | null {
  const port = Number(process.env.GP_TLS_PORT || TLS_PORT);
  if (process.env.GP_TLS === 'self-signed') {
    const paths = selfSigned(join(dataDir, 'tls'));
    return { cert: readFileSync(paths.cert, 'utf8'), key: readFileSync(paths.key, 'utf8'), port };
  }
  const cert = process.env.GP_TLS_CERT;
  const key = process.env.GP_TLS_KEY;
  if (!cert && !key) return null;
  if (!cert || !key) throw new Error('GP_TLS_CERT and GP_TLS_KEY go together: set both, or neither');
  return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8'), port };
}

/**
 * A self-signed certificate for this machine: its LAN addresses, its
 * `.local` name and localhost, valid for ten years. Made once with openssl
 * (macOS and Linux have it) and kept. It is made again only when this machine
 * has a name the certificate lacks: not when its networks are listed in
 * another order, nor when one goes away, for every device would then have to
 * accept a new one.
 */
function selfSigned(dir: string): { key: string; cert: string } {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const namesFile = join(dir, 'names');
  const needed = new Set(['DNS:localhost', `DNS:${hostname().replace(/\.local$/, '')}.local`, 'IP:127.0.0.1', ...lanAddresses().map((a) => `IP:${a}`)]);
  const covered = existsSync(namesFile) ? new Set(readFileSync(namesFile, 'utf8').split(',')) : new Set<string>();
  if (existsSync(cert) && existsSync(key) && [...needed].every((n) => covered.has(n))) return { key, cert };
  // A new certificate names what this one did as well, so a network that comes back is still named.
  const names = [...new Set([...needed, ...covered])].filter(Boolean).toSorted().join(',');
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert,
      '-days', '3650', '-subj', '/CN=Gospel Presenter', '-addext', `subjectAltName=${names}`,
    ], { stdio: 'ignore' });
  } catch {
    throw new Error('GP_TLS=self-signed needs openssl on this machine; or give GP_TLS_CERT and GP_TLS_KEY');
  }
  writeFileSync(namesFile, names);
  return { key, cert };
}

/** This machine's IPv4 LAN addresses. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
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
  const tls = tlsConfig(opts.dataDir);
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
    // Comma-separated addresses or CIDR blocks of reverse proxies (README, "Behind a reverse proxy").
    trustedProxies: process.env.GP_TRUSTED_PROXIES?.split(','),
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
  return lanAddresses().map((a) => `${scheme}://${a}:${p}`);
}

/** The page. `GP_STORAGE=memory` keeps its database in memory, as on a machine without OPFS. */
export function pageUrl(base: string, route = 'songs') {
  const q = process.env.GP_STORAGE === 'memory' ? '?storage=memory' : '';
  return `${base}/${route}${q}`;
}
