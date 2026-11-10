import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

// A cap on what a request may send, counted as its body is read, so one sent without its length (chunked) is stopped
// too, rather than read whole into memory (the security review, 2026-11-09). A route's own check of `content-length`
// answers sooner; this is what holds when there is none. On Cloudflare the platform caps a body at about 100 MB besides.

/** The rows of an export zip, sent in one request (`/api/import/legacy`): far above a church's, under Cloudflare's cap. */
export const IMPORT_BODY_MAX = 96 * 1024 * 1024;
/** A sync push: a batch of mutations, whose files go up apart. */
export const PUSH_BODY_MAX = 16 * 1024 * 1024;
/** A bug report with its picture and state; the auth routes' JSON is far smaller. */
export const REPORT_BODY_MAX = 4 * 1024 * 1024;
export const AUTH_BODY_MAX = 1024 * 1024;

/** Refuses a body past `maxSize` bytes with 413 `too-large`. */
export const capped = (maxSize: number): MiddlewareHandler => bodyLimit({ maxSize, onError: (c) => c.json({ error: 'too-large' }, 413) });
