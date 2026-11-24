import type { Hono } from 'hono';

// An error nothing caught, written to the server's log beside its own events (the review, 2026-11-09): without it,
// one showed only as the platform's own failure. Where it happened and what, never a request's body or a token.

/** Logs every error `app`'s routes throw as `server-error`, and answers 500 `internal`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any app, whatever its bindings
export function logServerErrors(app: Hono<any>, log: (event: Record<string, unknown>) => void) {
  app.onError((err, c) => {
    log({ event: 'server-error', method: c.req.method, path: c.req.path, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
    return c.json({ error: 'internal' }, 500);
  });
}
