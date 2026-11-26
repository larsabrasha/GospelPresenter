// Which server the desktop app is a client of, if any (D8; Lars, 2026-11-26): our cloud, chosen first at the first
// start, another server, or none, when this machine is the host. Kept in `connection.json` in the app's data folder,
// so the next start goes the same way; `GP_SERVER` in the environment wins (the e2e tests, development).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Our cloud, what the first start offers first; `GP_CLOUD` stands in for it in the e2e tests, never our own. */
export const CLOUD = process.env.GP_CLOUD?.replace(/\/$/, '') ?? 'https://app.gospelpresenter.com';

const file = (dataDir: string) => join(dataDir, 'connection.json');

/** What connection.json holds: the server, and whether this computer lets the church's devices in (Enheter i nätverket). */
function saved(dataDir: string): { server?: unknown; lan?: unknown } {
  try {
    return JSON.parse(readFileSync(file(dataDir), 'utf8')) as { server?: unknown; lan?: unknown };
  } catch {
    return {};
  }
}

function save(dataDir: string, value: { server?: string; lan?: boolean }) {
  if (value.server || value.lan) writeFileSync(file(dataDir), JSON.stringify(value));
  else rmSync(file(dataDir), { force: true });
}

/** The server saved, or null: this machine is the host. */
export function savedServer(dataDir: string): string | null {
  const { server } = saved(dataDir);
  return typeof server === 'string' && serverUrl(server) === server ? server : null;
}

export function saveServer(dataDir: string, server: string | null) {
  save(dataDir, { server: server ?? undefined, lan: savedLan(dataDir) || undefined });
}

/** Whether this computer, used without an account, lets the church's phones and screens in on the network. */
export function savedLan(dataDir: string): boolean {
  return saved(dataDir).lan === true;
}

export function saveLan(dataDir: string, lan: boolean) {
  save(dataDir, { server: savedServer(dataDir) ?? undefined, lan: lan || undefined });
}

/** Whether a host name is this machine or the local network, where a desktop host is reached over plain http. */
function local(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/**
 * A server's address as typed, made its origin (`app.gospelpresenter.com` → `https://app.gospelpresenter.com`), or
 * null when it is not one: https anywhere, plain http only on this machine or the local network, no user or password.
 */
export function serverUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local(u.hostname))) return u.origin;
  return null;
}

/**
 * Whether a Gospel Presenter server answers at `origin`, within a few seconds: its pairing status, which every server
 * gives (the web asks it first) and a desktop host gives a device it has not paired with too.
 */
export async function answers(origin: string, timeoutMs = 8000): Promise<boolean> {
  try {
    const r = await fetch(`${origin}/api/pair/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return false;
    const status = (await r.json()) as { required?: unknown };
    return typeof status.required === 'boolean';
  } catch {
    return false;
  }
}
