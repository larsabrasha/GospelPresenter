// Behind a reverse proxy (docs/lan-https-and-addresses.md, "Behind a reverse proxy"): the throttles
// count the client the proxy names, but only a trusted proxy is believed.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startNodeServer, type RunningServer } from '@gp/server/node';
import { forwardedClient, plainAddress, trustedProxies } from '../src/proxy.ts';

describe('the client behind trusted proxies', () => {
  const proxies = trustedProxies(['127.0.0.1', '10.0.0.0/8', 'fd00::/8']);

  it('is the socket itself when that is not a trusted proxy, whatever the header says', () => {
    expect(forwardedClient('192.168.1.20', '1.2.3.4', proxies)).toBe('192.168.1.20');
  });

  it('is the address a trusted proxy appended', () => {
    expect(forwardedClient('127.0.0.1', '192.168.1.20', proxies)).toBe('192.168.1.20');
    expect(forwardedClient('::ffff:127.0.0.1', '192.168.1.20', proxies)).toBe('192.168.1.20');
  });

  it('walks a chain of proxies from the right, and what the client wrote at the left is not believed', () => {
    expect(forwardedClient('127.0.0.1', '6.6.6.6, 192.168.1.20, 10.0.0.5', proxies)).toBe('192.168.1.20');
    expect(forwardedClient('127.0.0.1', '2001:db8::7, fd00::1', proxies)).toBe('2001:db8::7');
  });

  it('stops at an entry that is no address, at the hop before it', () => {
    expect(forwardedClient('127.0.0.1', 'garbage, 10.0.0.5', proxies)).toBe('10.0.0.5');
  });

  it('is the proxy itself when it sends no header', () => {
    expect(forwardedClient('127.0.0.1', undefined, proxies)).toBe('127.0.0.1');
  });

  it('takes brackets and ports off an address', () => {
    expect([plainAddress('[::1]:443'), plainAddress('1.2.3.4:80'), plainAddress('::ffff:1.2.3.4'), plainAddress('nope')]).toEqual(['::1', '1.2.3.4', '1.2.3.4', null]);
  });

  it('refuses a setting that is not an address or a CIDR block', () => {
    for (const bad of ['localhost', '10.0.0.0/33', '10.0.0.0/8/1', 'fd00::/129']) expect(() => trustedProxies([bad]), bad).toThrow(/GP_TRUSTED_PROXIES/);
    expect(() => trustedProxies(['', ' 127.0.0.1 '])).not.toThrow();
  });
});

describe('the setup throttle behind a proxy', () => {
  let server: RunningServer | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = undefined;
  });

  const start = async (trusted?: string[]) => {
    dir = mkdtempSync(join(tmpdir(), 'gp-proxy-'));
    server = await startNodeServer({ dataDir: dir, setupToken: 'gpst_right', trustedProxies: trusted, log: () => undefined });
    return server;
  };
  const guess = (s: RunningServer, forwardedFor: string) =>
    fetch(`${s.url}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify({ setupToken: 'gpst_guess', name: 'Anna', orgName: 'Kyrkan' }),
    }).then((r) => r.status);
  const lockOut = async (s: RunningServer, forwardedFor: string) => {
    for (let i = 0; i < 25 && (await guess(s, forwardedFor)) !== 429; i++);
    return guess(s, forwardedFor);
  };

  it('locks out the client that guessed, and not the others behind the same proxy', async () => {
    const s = await start(['127.0.0.1', '::1']);
    expect(await lockOut(s, '192.168.1.20')).toBe(429);
    expect(await guess(s, '192.168.1.21')).toBe(403);
  });

  it('without the setting ignores the header: everyone behind the proxy is one client', async () => {
    const s = await start();
    expect(await lockOut(s, '192.168.1.20')).toBe(429);
    expect(await guess(s, '192.168.1.21')).toBe(429);
  });
});
