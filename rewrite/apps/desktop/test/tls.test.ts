// The self-signed certificate of GP_TLS=self-signed (docs/lan-https-and-addresses.md, "https on the LAN"):
// every device has accepted it once, so it must not be made anew without need.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tlsConfig } from '../src/host.ts';

// This machine's networks, as each test sets them.
const nics: { current: Record<string, { family: string; internal: boolean; address: string }[]> } = { current: {} };
vi.mock('node:os', async (real) => {
  const os = await real<typeof import('node:os')>();
  return { ...os, networkInterfaces: () => nics.current, hostname: () => 'kyrkans-mac.local' };
});
const nic = (address: string) => [{ family: 'IPv4', internal: false, address }];

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)('a self-signed certificate', () => {
  afterEach(() => vi.unstubAllEnvs());

  const certFor = (dir: string) => {
    vi.stubEnv('GP_TLS', 'self-signed');
    return tlsConfig(dir)!.cert;
  };
  const named = (cert: string) => execFileSync('openssl', ['x509', '-noout', '-ext', 'subjectAltName'], { input: cert }).toString();

  it('is kept when the networks are listed in another order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-tls-'));
    nics.current = { en0: nic('192.168.1.59'), en1: nic('192.168.1.211') };
    const first = certFor(dir);
    nics.current = { en1: nic('192.168.1.211'), en0: nic('192.168.1.59') };
    expect(certFor(dir)).toBe(first);
  });

  it('is kept when a network goes away, and still names it when it comes back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-tls-'));
    nics.current = { en0: nic('192.168.1.59'), en1: nic('192.168.1.211') };
    const first = certFor(dir);
    nics.current = { en0: nic('192.168.1.59') };
    expect(certFor(dir)).toBe(first);
    nics.current = { en0: nic('192.168.1.59'), en1: nic('192.168.1.211') };
    expect(certFor(dir)).toBe(first);
  });

  it('is made anew for an address it does not name, and names the old ones as well', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-tls-'));
    nics.current = { en0: nic('192.168.1.59') };
    const first = certFor(dir);
    nics.current = { en0: nic('10.0.0.7') };
    const second = certFor(dir);
    expect(second).not.toBe(first);
    expect(named(second)).toContain('IP Address:10.0.0.7');
    expect(named(second)).toContain('IP Address:192.168.1.59');
    expect(named(second)).toContain('DNS:kyrkans-mac.local');
  });
});
