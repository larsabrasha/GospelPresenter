import { BIBLE_LIMITS, MEDIA_LIMITS, VIDEO_LIMITS } from '@gp/core';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

// A cap on what a request may send, counted as its body is read, so one sent without its length (chunked) is stopped
// too, rather than read whole into memory (the review, 2026-11-09); one that says its length is refused before it is
// read. One middleware at the server's root (node.ts, the Worker), so no path goes without: the larger bodies by path,
// every other at most a megabyte. On Cloudflare the platform caps a body at about 100 MB besides.

const MB = 1024 * 1024;

/** The paths that take more than the default, and how much: the routes check no size of their own beside a kind's limit. */
const CAPS: [RegExp, number][] = [
  // The rows of an export zip, in one request: far above a church's, under Cloudflare's cap.
  [/^\/api\/import\/legacy$/, 96 * MB],
  // A sync push: a batch of mutations, whose files go up apart.
  [/^\/api\/sync\/push$/, 16 * MB],
  [/^\/api\/media\/[^/]+$/, MEDIA_LIMITS.audioBytes],
  [/^\/api\/media\/[^/]+\/upload\/[^/]+$/, VIDEO_LIMITS.partBytes],
  [/^\/api\/bibles\/[^/]+$/, BIBLE_LIMITS.textBytes],
  // A bug report with its picture and state.
  [/^\/api\/reports(\/|$)/, 4 * MB],
];
const DEFAULT_CAP = MB;

const limits = new Map([...CAPS.map(([, max]) => max), DEFAULT_CAP].map((max) => [max, bodyLimit({ maxSize: max, onError: (c) => c.json({ error: 'too-large' }, 413) })]));

/** Refuses a body past its path's cap with 413 `too-large`. */
export const capBodies: MiddlewareHandler = (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const max = CAPS.find(([path]) => path.test(c.req.path))?.[1] ?? DEFAULT_CAP;
  return limits.get(max)!(c, next);
};
