import { Hono, type Context } from 'hono';
import {
  BIBLE_LIMITS,
  bibleTextHash,
  bibleTextSchema,
  bookChunk,
  can,
  joinBibleText,
  LOAD_BIBLE_TEXT_SQL,
  MEDIA_HASH,
  MEDIA_LIMITS,
  mediaKey,
  ORPHAN_BLOBS_SQL,
  ORPHAN_GRACE_MS,
  recordMediaBlobSql,
  serializeBibleText,
  sha256HexBytes,
  sniffStoredImage,
  storeBibleTextSql,
  type PullRequest,
  type PushRequest,
} from '@gp/core';
import { currentSeq, dump, handlePull, handlePush, type OrgStore, type PokeCoalescer, type SerialQueue } from '@gp/sync/server';
import type { Caller } from './auth.ts';
import type { MediaStorage } from './media.ts';

export { authenticate, authRoutes, credentials, isApiPath, isLoopback, pairingGuard, WS_PROTOCOL, type AuthDeps, type Caller, type Pairing } from './auth.ts';
export { GoogleOidc, TEST_ISSUER_BUILD, type GoogleConfig, type GoogleIdentity, type TokenProblem } from './google.ts';
export { Accounts, globalDdl, migrateGlobal, GLOBAL_SCHEMA_VERSION, globalSchemaPlan, type GlobalSql } from './global.ts';
export { Passkeys, type PasskeyConfig } from './webauthn.ts';
export { memoryStorage, r2Storage, type MediaStorage, type R2Like } from './media.ts';

/** An organisation's runtime: its database, its write queue and its poke hub. */
export interface Org {
  store: OrgStore;
  queue: SerialQueue;
  poke: PokeCoalescer;
}

/**
 * Removes the stored blobs no image names, once they are older than the grace
 * period: what a purged image leaves behind, and what an upload whose
 * `addImage` never came leaves. Run inside the organisation's queue.
 */
async function collectMedia(org: Org, orgId: string, media: MediaStorage, graceMs: number) {
  const orphans = org.store.query(ORPHAN_BLOBS_SQL, [Date.now() - graceMs]) as { hash: string }[];
  for (const { hash } of orphans) {
    await media.delete(mediaKey(orgId, hash)); // the bytes first: a row without bytes is only a 404, bytes without a row are a leak
    org.store.query('DELETE FROM media_blobs WHERE hash = ?', [hash]);
  }
}

/**
 * The sync endpoints. `resolve` finds the caller and their organisation for a
 * request. `media` is where picture blobs are kept; without it the media
 * endpoints answer 503 (MEDIA-R18) and nothing else is affected.
 */
export function syncRoutes(
  resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>,
  debug: boolean,
  media: MediaStorage | null = null,
  /** How long a blob nothing names is kept (tests shorten it). */
  mediaGraceMs: number = ORPHAN_GRACE_MS,
) {
  const app = new Hono();

  app.post('/sync/push', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const { org, caller } = r;
    const body = await c.req.json<PushRequest>();
    const result = await org.queue.run(async () => {
      const before = currentSeq(org.store);
      const res = await handlePush(org.store, caller.ctx, body);
      const after = currentSeq(org.store);
      if (after > before) org.poke.changed(body.clientId, after);
      if (after > before && media) await collectMedia(org, caller.orgId, media, mediaGraceMs).catch(() => undefined); // a failed clean-up waits for the next push
      return res;
    });
    return c.json(result.body, result.status);
  });

  app.post('/sync/pull', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const body = await c.req.json<PullRequest>();
    const result = await r.org.queue.run(() => handlePull(r.org.store, r.caller.ctx, body));
    return c.json(result.body, result.status);
  });

  // ------------------------------------------------------------ Bible texts
  // A translation's verses are an immutable text named by its SHA-256 (README,
  // "Bibles"). The importing device uploads it before it pushes `importBible`;
  // every device downloads it once. Neither goes through the change log.

  const HASH = /^[0-9a-f]{64}$/;

  app.put('/bibles/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageBibles')) return c.json({ error: 'forbidden' }, 403);
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'invalid-hash' }, 400);
    if (Number(c.req.header('content-length') ?? 0) > BIBLE_LIMITS.textBytes) return c.json({ error: 'too-large' }, 413);
    const body = await c.req.text();
    if (body.length > BIBLE_LIMITS.textBytes) return c.json({ error: 'too-large' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return c.json({ error: 'invalid-text' }, 400);
    }
    const text = bibleTextSchema.safeParse(parsed);
    if (!text.success) return c.json({ error: 'invalid-text', detail: text.error.message }, 400);
    // Hashed in its canonical form, so what the server hands back is exactly what was named.
    if ((await bibleTextHash(serializeBibleText(text.data.books))) !== hash) return c.json({ error: 'hash-mismatch' }, 400);
    if (text.data.books.some((b) => bookChunk(b).length > BIBLE_LIMITS.bookBytes)) return c.json({ error: 'too-large' }, 413);
    await r.org.queue.run(() =>
      r.org.store.transaction(async () => {
        if (r.org.store.query('SELECT 1 FROM bible_blobs WHERE hash = ?', [hash]).length) return;
        for (const s of storeBibleTextSql(hash, text.data.books)) r.org.store.query(s.sql, s.params);
      }),
    );
    return c.body(null, 204);
  });

  // Not compressed here: Cloudflare compresses at its edge (a gzip body from
  // here would be gzipped twice), and the desktop's server is on the same machine.
  app.get('/bibles/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ViewBibles')) return c.json({ error: 'forbidden' }, 403);
    const hash = c.req.param('hash');
    // Only this organisation's store is looked in: another's text is not found (BIBLE-A8).
    const rows = await r.org.queue.run(() =>
      HASH.test(hash) && r.org.store.query('SELECT 1 FROM bible_blobs WHERE hash = ?', [hash]).length
        ? (r.org.store.query(LOAD_BIBLE_TEXT_SQL, [hash]) as { code: string; chunk: string }[])
        : null,
    );
    if (!rows) return c.json({ error: 'not-found' }, 404);
    c.header('cache-control', 'private, max-age=31536000, immutable'); // content-addressed (D28)
    c.header('content-type', 'application/json; charset=utf-8');
    return c.body(joinBibleText(rows));
  });

  // ------------------------------------------------------------ Media blobs
  // A picture is two immutable blobs named by their SHA-256 (README, "Media").
  // The importing device uploads them before it pushes `addImage`; every
  // device downloads what it lacks. Neither goes through the change log. The
  // bytes live in the media storage; `media_blobs` records which are there, so
  // `addImage` can check and an organisation never reads another's.

  app.put('/media/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageImages')) return c.json({ error: 'forbidden' }, 403);
    if (!media) return c.json({ error: 'media-disabled' }, 503);
    const hash = c.req.param('hash');
    if (!MEDIA_HASH.test(hash)) return c.json({ error: 'invalid-hash' }, 400);
    if (Number(c.req.header('content-length') ?? 0) > MEDIA_LIMITS.blobBytes) return c.json({ error: 'too-large' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) return c.json({ error: 'empty' }, 400);
    if (bytes.length > MEDIA_LIMITS.blobBytes) return c.json({ error: 'too-large' }, 413);
    if ((await sha256HexBytes(bytes)) !== hash) return c.json({ error: 'hash-mismatch' }, 400);
    // The signature, not the type the client claims, decides what is kept (MEDIA-A6).
    const type = sniffStoredImage(bytes);
    if (!type) return c.json({ error: 'invalid-image' }, 400);
    const orgId = r.caller.orgId;
    await r.org.queue.run(async () => {
      if (r.org.store.query('SELECT 1 FROM media_blobs WHERE hash = ?', [hash]).length) return;
      await media.put(mediaKey(orgId, hash), bytes); // bytes first, then the row (MEDIA-R6)
      const s = recordMediaBlobSql(hash, type, bytes.length, null, Date.now());
      r.org.store.query(s.sql, s.params);
    });
    return c.body(null, 204);
  });

  app.get('/media/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ViewImages')) return c.json({ error: 'forbidden' }, 403);
    if (!media) return c.json({ error: 'media-disabled' }, 503);
    const hash = c.req.param('hash');
    // Only this organisation's blobs are known to its store, and its key starts with its id (MEDIA-R11).
    const known = MEDIA_HASH.test(hash) ? await r.org.queue.run(async () => r.org.store.query('SELECT content_type FROM media_blobs WHERE hash = ?', [hash])) : [];
    const bytes = known.length ? await media.get(mediaKey(r.caller.orgId, hash)) : null;
    if (!bytes) return c.json({ error: 'not-found' }, 404);
    c.header('cache-control', 'private, max-age=31536000, immutable'); // content-addressed (D28)
    c.header('content-type', String(known[0]!.content_type));
    c.header('x-content-type-options', 'nosniff');
    c.header('etag', `"${hash}"`);
    return c.body(bytes as Uint8Array<ArrayBuffer>);
  });

  if (debug) {
    app.get('/debug/dump', async (c) => {
      const r = await resolve(c);
      if (r instanceof Response) return r;
      return c.json(await r.org.queue.run(() => dump(r.org.store)));
    });
  }
  return app;
}
