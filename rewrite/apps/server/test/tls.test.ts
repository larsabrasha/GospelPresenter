// https on the LAN (README, "https on the LAN"): the desktop host serves the
// same app over https with a certificate the operator provides, beside its
// plain http on 127.0.0.1. Pages, the API and both sockets work over it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { socketProtocols } from '@gp/sync/client';
import { startNodeServer, type RunningServer } from '@gp/server/node';
import { setRole, tokenOf, type Harness } from './harness.ts';

/** A self-signed certificate for 127.0.0.1, made with openssl for this test only. */
function certificate(dir: string): { key: string; cert: string } | null {
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
      '-subj', '/CN=gospel-presenter-test', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ], { stdio: 'ignore' });
    return { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
  } catch {
    return null; // no openssl here
  }
}

/** A GET over https that trusts only `ca`. */
function get(url: string, ca: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; type: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? ''), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const dir = mkdtempSync(join(tmpdir(), 'gp-tls-'));
const pem = certificate(dir);

describe.skipIf(!pem)('https beside http', () => {
  let server: RunningServer;
  let h: Harness;

  beforeAll(async () => {
    const web = join(dir, 'web');
    execFileSync('mkdir', ['-p', web]);
    execFileSync('sh', ['-c', `printf '<!doctype html><title>Gospel Presenter</title>' > '${join(web, 'index.html')}'`]);
    execFileSync('mkdir', ['-p', join(web, 'assets')]);
    execFileSync('sh', ['-c', `printf 'self;' > '${join(web, 'sw.js')}'; printf 'x;' > '${join(web, 'assets', 'index-abc.js')}'`]);
    server = await startNodeServer({ dataDir: join(dir, 'data'), debug: true, webRoot: web, tls: { ...pem!, port: 0 }, log: () => undefined });
    h = { name: 'node', url: server.url, mediaKeys: async () => [], close: () => server.close() };
  });
  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('listens on both: http for this machine, https with the given certificate', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.tls!.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    const state = await get(`${server.tls!.url}/api/auth/state`, pem!.cert);
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toHaveProperty('setupRequired', true);
    // A page address is the app, over https as over http.
    const page = await get(`${server.tls!.url}/presentations`, pem!.cert);
    expect([page.status, page.type, page.body]).toEqual([200, expect.stringContaining('text/html'), expect.stringContaining('Gospel Presenter')]);
  });

  it('serves the service worker under the CSP, and asks again for the files whose names stay from build to build', async () => {
    const sw = await get(`${server.tls!.url}/sw.js`, pem!.cert);
    expect([sw.status, sw.type]).toEqual([200, expect.stringContaining('javascript')]);
    expect(sw.headers['content-security-policy']).toContain("worker-src 'self'");
    for (const path of ['/sw.js', '/index.html', '/presentations']) expect((await get(`${server.tls!.url}${path}`, pem!.cert)).headers['cache-control'], path).toBe('no-cache');
    // A hashed asset's name changes with its content.
    expect((await get(`${server.tls!.url}/assets/index-abc.js`, pem!.cert)).headers['cache-control']).toBeUndefined();
  });

  it('a client that does not trust the certificate cannot connect', async () => {
    await expect(get(`${server.tls!.url}/api/auth/state`, '')).rejects.toThrow();
  });

  it('the sync and live sockets work over wss', async () => {
    await setRole(h, 'anna', 'org-tls', 'admin');
    const protocols = socketProtocols({ token: tokenOf(h, 'org-tls', 'anna') });
    for (const path of ['/api/sync/poke?clientId=x', '/api/live/socket']) {
      const ws = new WebSocket(`${server.tls!.url.replace('https', 'wss')}${path}`, protocols, { ca: pem!.cert });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      ws.close();
    }
  });
});
