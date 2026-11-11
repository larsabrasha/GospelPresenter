import type { MiddlewareHandler } from 'hono';

// The phone app (Capacitor) runs from an origin of its own, not the server's, so its calls to `/api/` are cross-origin
// (Lars, 2026-11-03). It signs in with a bearer token, never a cookie, so letting its two origins in lets in no one's
// session: a page elsewhere has no token to send. Every other origin is answered as before, with no CORS headers.

/** iOS's app scheme, and Android's `https://localhost`. */
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

const PREFLIGHT = {
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
  'access-control-allow-headers': 'authorization, content-type, x-gp-device, range',
  'access-control-max-age': '600',
};

/** CORS for the phone app's origins on `/api/`: preflights answered here, answers marked as theirs to read. */
export function appCors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (!origin || !APP_ORIGINS.has(origin)) return next();
    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...PREFLIGHT, 'access-control-allow-origin': origin, vary: 'origin' } });
    await next();
    // A WebSocket's upgrade is not read by the page: left as it is.
    if (c.res.status === 101) return;
    // A copy: an answer from a Durable Object (the cloud) has headers that cannot be changed.
    const res = new Response(c.res.body, c.res);
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('access-control-expose-headers', 'content-range, content-length, accept-ranges');
    res.headers.append('vary', 'origin');
    c.res = res;
  };
}
