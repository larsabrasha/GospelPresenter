// CORS for the phone app's origins on /api/ (src/cors.ts): its preflights answered, its answers marked as its to
// read, and every other origin answered as before.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { appCors } from '../src/cors.ts';

function app() {
  const a = new Hono();
  a.use('/api/*', appCors());
  a.get('/api/auth/state', (c) => c.json({ passkeys: true }));
  // As an answer passed on from a Durable Object: its headers cannot be changed.
  a.get('/api/sync/pull', () => Response.redirect('https://gp.example/elsewhere', 302));
  return a;
}

describe('appCors', () => {
  it("answers the iOS app's preflight with the headers it may send", async () => {
    const res = await app().request('/api/auth/state', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'GET' } });

    expect([res.status, res.headers.get('access-control-allow-origin'), res.headers.get('access-control-allow-headers')]).toEqual([
      204,
      'capacitor://localhost',
      'authorization, content-type, x-gp-device, range',
    ]);
  });

  it("marks an answer as the Android app's to read", async () => {
    const res = await app().request('/api/auth/state', { headers: { origin: 'https://localhost' } });

    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });

  it('marks an answer whose headers cannot be changed, by a copy', async () => {
    const res = await app().request('/api/sync/pull', { headers: { origin: 'capacitor://localhost' } });

    expect([res.status, res.headers.get('access-control-allow-origin')]).toEqual([302, 'capacitor://localhost']);
  });

  it('gives another origin no CORS headers', async () => {
    const res = await app().request('/api/auth/state', { headers: { origin: 'https://evil.example' } });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
