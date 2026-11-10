import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { capped, IMPORT_BODY_MAX, PUSH_BODY_MAX } from './body-cap.ts';
import {
  BIBLE_LIMITS,
  bibleTextHash,
  bibleTextSchema,
  bookChunk,
  can,
  DISPLAY_CODE,
  DISPLAY_MUTATORS,
  REMOTE_CONTROL_MUTATORS,
  joinBibleText,
  LOAD_BIBLE_TEXT_SQL,
  MEDIA_HASH,
  MEDIA_LIMITS,
  VIDEO_LIMITS,
  mediaKey,
  SCREEN_ID,
  ORPHAN_BLOBS_SQL,
  ORPHAN_GRACE_MS,
  recordMediaBlobSql,
  serializeBibleText,
  sha256HexBytes,
  sniffMedia,
  type WatchEvent,
  storeBibleTextSql,
  type PullRequest,
  type PushRequest,
} from '@gp/core';
import { currentSeq, dump, handlePull, handlePush, type OrgStore, type PokeCoalescer, type SerialQueue } from '@gp/sync/server';
import type { Caller } from './auth/index.ts';
import { legacyRoutes } from './legacy-routes.ts';
import type { LiveHub } from './live-hub.ts';
import type { Viewer } from './live-viewers.ts';
import type { MediaStorage } from './media.ts';
import type { PlayTokens } from './play-tokens.ts';
import { serveVideo, videoBlob, videoRoutes } from './video-routes.ts';
import type { WatchRegistry } from './watch.ts';

// What the package exports: only what the desktop app imports (its server is ./node). The tests import the modules.
export type { GoogleConfig } from './google.ts';
export type { PasskeyConfig } from './webauthn.ts';

/** An organisation's runtime: its database, its write queue, its poke hub and its live sessions. */
export interface Org {
  store: OrgStore;
  queue: SerialQueue;
  poke: PokeCoalescer;
  live?: LiveHub;
}

/**
 * The pushes after which blobs may be unused: a purge, the expired trash, and
 * an add (whose upload may have left a refused add's blobs behind), of pictures,
 * audio, videos and PDFs, and a slideshow's change, which may leave a PDF's pages behind (a new PDF, a page
 * removed).
 */
const MEDIA_GC_MUTATORS: readonly string[] = [
  'purgeImage',
  'purgeExpiredTrash',
  'addImage',
  // An edit, and going back to the original, leave the edit before behind.
  'editImage',
  'revertImage',
  'purgeAudio',
  'addAudio',
  'purgeVideo',
  'addVideo',
  'addSlides',
  'createCustomSlide',
  'updateCustomSlide',
  'purgeCustomSlide',
];

/**
 * Removes the stored blobs nothing names, once they are older than the grace
 * period: what a purged image or slide deck leaves behind, and what
 * an upload whose add never came leaves. Run inside the organisation's queue.
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
export interface SyncRouteOptions {
  debug: boolean;
  media?: MediaStorage | null;
  /** How long a blob nothing names is kept (tests shorten it). */
  mediaGraceMs?: number;
  /** The global index of public output codes; kept up to date after a push that changed outputs. */
  watch?: WatchRegistry | null;
  /** Where the tokens a `<video src>` streams with are kept (global); without it, no video streams. */
  playTokens?: PlayTokens | null;
  /** The size of a video upload's parts but the last (tests). */
  videoPartBytes?: number;
}

export function syncRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, opts: SyncRouteOptions) {
  const { debug, media = null, mediaGraceMs = ORPHAN_GRACE_MS, watch = null, playTokens = null } = opts;
  const app = new Hono();
  // Before the routes, so every body below is capped as it is read (body-cap.ts): the routes check no size of their own,
  // only a kind's own limit once the bytes are known.
  app.use('/api/sync/push', capped(PUSH_BODY_MAX));
  app.use('/api/bibles/:hash', capped(BIBLE_LIMITS.textBytes));
  app.use('/api/media/:hash', capped(MEDIA_LIMITS.audioBytes));
  app.use('/api/media/:hash/upload/:part', capped(opts.videoPartBytes ?? VIDEO_LIMITS.partBytes));
  app.use('/api/import/legacy', capped(IMPORT_BODY_MAX));
  app.route('/', videoRoutes(resolve, { media, playTokens, partBytes: opts.videoPartBytes }));
  app.route('/', legacyRoutes(resolve, watch));

  app.post('/api/sync/push', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const { org, caller } = r;
    const body = await c.req.json<PushRequest>();
    const result = await org.queue.run(async () => {
      const before = currentSeq(org.store);
      const res = await handlePush(org.store, caller.ctx, body);
      const after = currentSeq(org.store);
      if (after > before) org.poke.changed(body.clientId, after);
      // Only after a push that can leave blobs behind: not every edit pays for a scan.
      if (after > before && media && body.mutations.some((m) => MEDIA_GC_MUTATORS.includes(m.name))) {
        await collectMedia(org, caller.orgId, media, mediaGraceMs).catch(() => undefined); // a failed clean-up waits for the next one
      }
      // Not only when this push changed something: if registering failed after the mutations were saved,
      // the client sends the same push again, which changes nothing but must register the codes.
      if (watch && body.mutations.some((m) => DISPLAY_MUTATORS.includes(m.name))) {
        await watch.sync(caller.orgId, org.store.query('SELECT id, code FROM displays') as { id: string; code: string }[]);
        org.live?.displaysChanged(); // a deleted output, or a new code, disconnects its viewers at once
      }
      if (after > before && body.mutations.some((m) => REMOTE_CONTROL_MUTATORS.includes(m.name))) org.live?.remoteControlChanged();
      return res;
    });
    return c.json(result.body, result.status);
  });

  app.post('/api/sync/pull', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const body = await c.req.json<PullRequest>();
    const result = await r.org.queue.run(() => handlePull(r.org.store, r.caller.ctx, body));
    return c.json(result.body, result.status);
  });

  // ------------------------------------------------------------ Bible texts
  // A translation's verses are an immutable text named by its SHA-256 (docs/bibles-and-themes.md,
  // "Bibles"). The importing device uploads it before it pushes `importBible`;
  // every device downloads it once. Neither goes through the change log.

  const HASH = /^[0-9a-f]{64}$/;

  app.put('/api/bibles/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageBibles')) return c.json({ error: 'forbidden' }, 403);
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'invalid-hash' }, 400);
    const body = await c.req.text();
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
  app.get('/api/bibles/:hash', async (c) => {
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
  // A picture is two immutable blobs named by their SHA-256 (docs/media-and-files.md, "Media").
  // The importing device uploads them before it pushes `addImage`; every
  // device downloads what it lacks. Neither goes through the change log. The
  // bytes live in the media storage; `media_blobs` records which are there, so
  // `addImage` can check and an organisation never reads another's.

  app.put('/api/media/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageImages') && !can(r.caller.ctx.role, 'ManageAudios')) return c.json({ error: 'forbidden' }, 403);
    if (!media) return c.json({ error: 'media-disabled' }, 503);
    const hash = c.req.param('hash');
    if (!MEDIA_HASH.test(hash)) return c.json({ error: 'invalid-hash' }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) return c.json({ error: 'empty' }, 400);
    if ((await sha256HexBytes(bytes)) !== hash) return c.json({ error: 'hash-mismatch' }, 400);
    // The signature, not the type the client claims, decides what is kept (MEDIA-A6): a stored picture, a sound or a PDF.
    const kind = sniffMedia(bytes);
    if (!kind) return c.json({ error: 'invalid-image' }, 400);
    if (bytes.length > kind.maxBytes) return c.json({ error: 'too-large' }, 413);
    const type = kind.type;
    const orgId = r.caller.orgId;
    await r.org.queue.run(async () => {
      // Known already: the upload says it is about to be used, so its grace period starts over. Its bytes are stored
      // again all the same (the same key is the same bytes): a clean-up cut off between removing the bytes and the row
      // leaves a row without them, which nothing else would ever mend.
      if (r.org.store.query('UPDATE media_blobs SET received_at = ? WHERE hash = ? RETURNING hash', [Date.now(), hash]).length) {
        await media.put(mediaKey(orgId, hash), bytes);
        return;
      }
      await media.put(mediaKey(orgId, hash), bytes); // bytes first, then the row (MEDIA-R6)
      const s = recordMediaBlobSql(hash, type, bytes.length, null, Date.now());
      r.org.store.query(s.sql, s.params);
    });
    return c.body(null, 204);
  });

  app.get('/api/media/:hash', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ViewImages')) return c.json({ error: 'forbidden' }, 403);
    if (!media) return c.json({ error: 'media-disabled' }, 503);
    const hash = c.req.param('hash');
    // Only this organisation's blobs are known to its store, and its key starts with its id (MEDIA-R11).
    const known = MEDIA_HASH.test(hash) ? await r.org.queue.run(async () => r.org.store.query('SELECT content_type, size FROM media_blobs WHERE hash = ?', [hash])) : [];
    // A video streams, a range at a time; it is never read whole.
    const type = String(known[0]?.content_type ?? '');
    if (type.startsWith('video/')) return serveVideo(c, media, mediaKey(r.caller.orgId, hash), { type, size: Number(known[0]!.size), hash });
    const bytes = known.length ? await media.get(mediaKey(r.caller.orgId, hash)) : null;
    if (!bytes) return c.json({ error: 'not-found' }, 404);
    c.header('cache-control', 'private, max-age=31536000, immutable'); // content-addressed (D28)
    c.header('content-type', String(known[0]!.content_type));
    c.header('x-content-type-options', 'nosniff');
    // A song's PDF is read by the app, never shown at this address: a browser that is sent here downloads it, and
    // anything in it runs nowhere (spec 02 "Song material").
    if (known[0]!.content_type === 'application/pdf') {
      c.header('content-disposition', 'attachment');
      c.header('content-security-policy', 'sandbox');
    }
    c.header('etag', `"${hash}"`);
    return c.body(bytes as Uint8Array<ArrayBuffer>);
  });

  if (debug) {
    app.get('/api/debug/dump', async (c) => {
      const r = await resolve(c);
      if (r instanceof Response) return r;
      return c.json(await r.org.queue.run(() => dump(r.org.store)));
    });
  }
  return app;
}

/** An output, found by its code or a temporary screen's id (anonymous): its organisation's runtime and live hub. */
export interface WatchTargetRuntime {
  org: Org;
  live: LiveHub;
  orgId: string;
  orgName: string;
  displayId: string;
  code: string;
}

/**
 * The three anonymous outputs (spec 04 §5, §6): a public output at
 * `/api/watch/{code}`, a saved screen at `/api/display/{code}`, and a
 * temporary screen at `/api/screen/{id}`, whose id is its secret.
 */
export type OutputKind = 'watch' | 'display' | 'screen';

const OUTPUT_KEY: Record<OutputKind, RegExp> = { watch: DISPLAY_CODE, display: DISPLAY_CODE, screen: SCREEN_ID };

/** The output's name, or null when the key no longer names an output of this kind (a new code, a deleted output, a released screen). */
function outputName(kind: OutputKind, t: WatchTargetRuntime): string | null {
  // A temporary screen was found paired in the global tables; the session that paired it may not have taken it in yet (a QR token).
  if (kind === 'screen') return '';
  const [d] = t.org.store.query('SELECT name FROM displays WHERE id = ? AND code = ? AND kind = ?', [t.displayId, t.code, kind === 'watch' ? 'public' : 'screen']) as {
    name: string;
  }[];
  return d?.name ?? null;
}

/** How often an open stream is pinged (LIVE-R35). */
const PING_MS = 15_000;

/** A public output's routes, or a screen's: the same stream and pictures (spec 04 §5 renders as `/live` does). */
export function outputRoutes(kind: OutputKind, resolve: (c: Context, key: string) => Promise<WatchTargetRuntime | Response | null>, media: MediaStorage | null) {
  const app = new Hono();
  const base = `/api/${kind}/:code`;
  const find = async (c: Context, key: string) => {
    const t = OUTPUT_KEY[kind].test(key) ? await resolve(c, key) : null;
    if (!t || t instanceof Response) return t;
    const name = await t.org.queue.run(async () => outputName(kind, t));
    return name === null ? null : { ...t, name };
  };

  // Whether a code exists, for a page whose stream did not open; it registers no viewer.
  app.get(`${base}/exists`, async (c) => {
    const t = await find(c, (c.req.param('code') ?? ''));
    if (t instanceof Response) return t;
    return t ? c.json({ ok: true }) : c.json({ error: 'not-found' }, 404);
  });

  app.get(`${base}/stream`, async (c) => {
    const code = (c.req.param('code') ?? '');
    const viewerId = c.req.query('v') ?? '';
    if (!/^[0-9a-f]{16}$/.test(viewerId)) return c.json({ error: 'viewer-id' }, 400);
    const t = await find(c, code);
    if (t instanceof Response) return t;
    if (!t) return c.json({ error: 'not-found' }, 404);
    const display = { name: t.name };
    c.header('cache-control', 'no-cache, no-store');
    c.header('x-accel-buffering', 'no');
    return streamSSE(c, async (stream) => {
      const live = { open: true, end: () => {} };
      const done = new Promise<void>((resolveDone) => {
        const viewer: Viewer = {
          // Only the newest state matters (LIVE-R36): a write that fails ends the stream.
          send: (e: WatchEvent) => void stream.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => viewer.close()),
          close: () => {
            if (!live.open) return;
            live.open = false;
            void t.org.queue.run(() => t.live.unwatch(t.displayId, viewerId, viewer)).catch(() => undefined); // the server may be closing
            resolveDone();
          },
        };
        live.end = () => viewer.close();
        stream.onAbort(() => viewer.close());
        void t.org.queue.run(() => t.live.watch(t.displayId, code, viewerId, viewer, { orgName: t.orgName, outputName: display.name }, kind !== 'watch')).catch(() => viewer.close());
      });
      while (live.open) {
        await Promise.race([done, stream.sleep(PING_MS)]);
        // A named event, not a comment, so the page can tell a stream gone silent (watchStream.ts); a ping that cannot be
        // written ends the stream, so a viewer gone away is no longer counted, nor a screen shown as online.
        if (live.open) await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => live.end());
      }
    });
  });

  app.get(`${base}/image/:hash`, async (c) => {
    const code = (c.req.param('code') ?? '');
    const hash = (c.req.param('hash') ?? '');
    const t = MEDIA_HASH.test(hash) ? await find(c, code) : null;
    if (t instanceof Response) return t;
    if (!t || !media) return c.json({ error: 'not-found' }, 404);
    const shown = await t.org.queue.run(async () => {
      if (!t.live.showing(t.displayId, hash, kind !== 'watch')) return null;
      return t.org.store.query('SELECT content_type FROM media_blobs WHERE hash = ?', [hash])[0] as { content_type: string } | undefined;
    });
    const bytes = shown ? await media.get(mediaKey(t.orgId, hash)) : null;
    if (!bytes) return c.json({ error: 'not-found' }, 404);
    c.header('content-type', shown!.content_type);
    // Not `public` (LIVE-R34): a shared cache would go on serving the picture after it left the screen.
    c.header('cache-control', 'private, max-age=3600');
    c.header('x-content-type-options', 'nosniff');
    return c.body(bytes as Uint8Array<ArrayBuffer>);
  });

  // A paired screen streams the video on its canvas itself, muted (TODO.md "Video on the outputs"); a public output never does.
  if (kind !== 'watch') {
    app.get(`${base}/video/:hash`, async (c) => {
      const hash = c.req.param('hash') ?? '';
      const t = MEDIA_HASH.test(hash) ? await find(c, c.req.param('code') ?? '') : null;
      if (t instanceof Response) return t;
      if (!t || !media) return c.json({ error: 'not-found' }, 404);
      const blob = await t.org.queue.run(async () => (t.live.showingVideo(t.displayId, hash) ? videoBlob(t.org.store, hash) : undefined));
      if (!blob) return c.json({ error: 'not-found' }, 404);
      return serveVideo(c, media, mediaKey(t.orgId, hash), blob);
    });
  }

  return app;
}
