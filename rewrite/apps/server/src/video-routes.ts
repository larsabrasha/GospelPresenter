import { Hono, type Context } from 'hono';
import {
  can,
  MEDIA_HASH,
  mediaKey,
  partCount,
  probeVideo,
  recordMediaBlobSql,
  Sha256,
  sniffVideoContainer,
  VIDEO_LIMITS,
  type Sha256State,
  type VideoProbe,
} from '@gp/core';
import type { OrgStore } from '@gp/sync/server';
import type { Caller } from './auth/index.ts';
import type { Org } from './app.ts';
import { streamBytes, type ByteRange, type MediaStorage } from './media.ts';
import type { PlayTokens } from './play-tokens.ts';

// Videos on the server (TODO.md "Video"): an upload in parts that goes on
// where it was cut off, known by the video's hash; streaming with HTTP Range;
// and the token a `<video src>` streams with. See docs/media-and-files.md, "Video".

/**
 * An upload under way, one row per video (by its hash), in the organisation's
 * own database; it never syncs. `sha` is the running hash of the parts so far
 * (a part is a multiple of 64 bytes, so it has no tail), so the server never
 * reads the whole file back to check it. `parts` holds what each stored part
 * returned, for finishing.
 */
const UPLOADS_DDL = `CREATE TABLE IF NOT EXISTS media_uploads (hash TEXT PRIMARY KEY NOT NULL, upload_id TEXT NOT NULL, size INTEGER NOT NULL,
  next_part INTEGER NOT NULL, parts TEXT NOT NULL, sha TEXT NOT NULL, updated_at INTEGER NOT NULL)`;

/** An upload left this long is given up: R2 drops an unfinished multipart upload after seven days. */
const UPLOAD_KEPT_MS = 6 * 24 * 60 * 60 * 1000;

interface UploadRow {
  upload_id: string;
  size: number;
  next_part: number;
  parts: string;
  sha: string;
  updated_at: number;
}

const ready = new WeakSet<OrgStore>();
function uploads(store: OrgStore): OrgStore {
  if (!ready.has(store)) {
    store.query(UPLOADS_DDL);
    ready.add(store);
  }
  return store;
}

const uploadOf = (store: OrgStore, hash: string) => uploads(store).query('SELECT upload_id, size, next_part, parts, sha, updated_at FROM media_uploads WHERE hash = ?', [hash])[0] as unknown as UploadRow | undefined;

/** What an upload has, as the client resumes from it: the bytes received, always whole parts. */
const receivedOf = (row: Pick<UploadRow, 'next_part' | 'size'>, partBytes: number) => Math.min(row.size, (row.next_part - 1) * partBytes);

/**
 * The byte range a `Range` header asks for, within `size`: null for none (or
 * one this does not serve, such as several ranges: the whole file is the
 * answer then), 'unsatisfiable' for one that starts past the end.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    const suffix = Math.min(Number(m[2]), size);
    return suffix > 0 ? { offset: size - suffix, length: suffix } : 'unsatisfiable';
  }
  const start = Number(m[1]);
  if (start >= size) return 'unsatisfiable';
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return end < start ? null : { offset: start, length: end - start + 1 };
}

/**
 * Streams a stored video, whole or the range asked for, never read into
 * memory. `no-store`: on the desktop host the video is on the server's disk
 * already, so Chromium's HTTP cache must not keep a second copy of it in the
 * window's profile, as `immutable` would let it (TODO.md "Video").
 */
export async function serveVideo(c: Context, media: MediaStorage, key: string, blob: { type: string; size: number; hash: string }): Promise<Response> {
  const range = parseRange(c.req.header('range'), blob.size);
  c.header('accept-ranges', 'bytes');
  c.header('cache-control', 'no-store');
  c.header('x-content-type-options', 'nosniff');
  c.header('etag', `"${blob.hash}"`);
  if (range === 'unsatisfiable') {
    c.header('content-range', `bytes */${blob.size}`);
    return c.body(null, 416);
  }
  const wanted = range ?? { offset: 0, length: blob.size };
  const body = await media.read(key, wanted);
  if (!body) return c.json({ error: 'not-found' }, 404);
  c.header('content-type', blob.type);
  c.header('content-length', String(wanted.length));
  if (!range) return c.body(body, 200);
  c.header('content-range', `bytes ${wanted.offset}-${wanted.offset + wanted.length - 1}/${blob.size}`);
  return c.body(body, 206);
}

/** A stored video blob this organisation knows, or undefined. */
export function videoBlob(store: OrgStore, hash: string): { type: string; size: number; hash: string } | undefined {
  const [row] = store.query(`SELECT content_type, size FROM media_blobs WHERE hash = ? AND content_type LIKE 'video/%'`, [hash]) as { content_type: string; size: number }[];
  return row && { type: row.content_type, size: Number(row.size), hash };
}

/** Reads ranges of a stored object, for `probeVideo`. */
const storageReader = (media: MediaStorage, key: string, size: number) => async (offset: number, length: number) => {
  const wanted = { offset, length: Math.max(0, Math.min(length, size - offset)) };
  const stream = wanted.length ? await media.read(key, wanted) : null;
  return stream ? streamBytes(stream) : new Uint8Array();
};

export interface VideoRouteOptions {
  media: MediaStorage | null;
  playTokens: PlayTokens | null;
  /** The size of every part but the last (tests may not shrink it below R2's 5 MiB on workerd). */
  partBytes?: number;
}

/** The upload, the streaming for a signed-in caller, and the play tokens: all under `/api/media/{hash}`, for the caller's organisation. */
export function videoRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, opts: VideoRouteOptions) {
  const { media, playTokens } = opts;
  const partBytes = opts.partBytes ?? VIDEO_LIMITS.partBytes;
  const app = new Hono();

  /** The caller, if they may upload videos and there is storage; otherwise the refusal. */
  const uploader = async (c: Context) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageVideos')) return c.json({ error: 'forbidden' }, 403);
    if (!media) return c.json({ error: 'media-disabled' }, 503);
    const hash = c.req.param('hash') ?? '';
    if (!MEDIA_HASH.test(hash)) return c.json({ error: 'invalid-hash' }, 400);
    return { ...r, media, hash, key: mediaKey(r.caller.orgId, hash) };
  };

  // Starts an upload, or says where one stands: the client sends the parts from `received` on.
  app.post('/api/media/:hash/upload', async (c) => {
    const u = await uploader(c);
    if (u instanceof Response) return u;
    const body = (await c.req.json().catch(() => null)) as { size?: unknown } | null;
    const size = body?.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) return c.json({ error: 'invalid-size' }, 400);
    if (size > VIDEO_LIMITS.bytes) return c.json({ error: 'too-large' }, 413);
    const store = u.org.store;
    return u.org.queue.run(async () => {
      const now = Date.now();
      // Known already: nothing to send, and the grace period of a blob nothing names yet starts over.
      if (store.query('UPDATE media_blobs SET received_at = ? WHERE hash = ? RETURNING hash', [now, u.hash]).length) return c.json({ done: true, partBytes, received: size });
      for (const old of uploads(store).query('SELECT hash, upload_id FROM media_uploads WHERE updated_at < ?', [now - UPLOAD_KEPT_MS]) as { hash: string; upload_id: string }[]) {
        await u.media.abortUpload(mediaKey(u.caller.orgId, old.hash), old.upload_id);
        store.query('DELETE FROM media_uploads WHERE hash = ?', [old.hash]);
      }
      let row = uploadOf(store, u.hash);
      // Another size for the same hash: one of the two is wrong, so it starts over.
      if (row && Number(row.size) !== size) {
        await u.media.abortUpload(u.key, row.upload_id);
        store.query('DELETE FROM media_uploads WHERE hash = ?', [u.hash]);
        row = undefined;
      }
      if (!row) {
        const uploadId = await u.media.startUpload(u.key);
        store.query('INSERT INTO media_uploads (hash, upload_id, size, next_part, parts, sha, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)', [
          u.hash,
          uploadId,
          size,
          '[]',
          JSON.stringify(new Sha256().state()),
          now,
        ]);
        row = uploadOf(store, u.hash)!;
      }
      return c.json({ done: false, partBytes, received: receivedOf(row, partBytes) });
    });
  });

  // One part, the next one: an earlier part again is answered with where it stands, a later one is refused.
  app.put('/api/media/:hash/upload/:part', async (c) => {
    const u = await uploader(c);
    if (u instanceof Response) return u;
    const part = Number(c.req.param('part'));
    if (!Number.isInteger(part) || part < 1) return c.json({ error: 'invalid-part' }, 400);
    if (Number(c.req.header('content-length') ?? 0) > partBytes) return c.json({ error: 'too-large' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const store = u.org.store;
    const before = await u.org.queue.run(async () => {
      const row = uploadOf(store, u.hash);
      if (!row) return c.json({ error: 'no-upload' }, 404);
      const received = receivedOf(row, partBytes);
      if (part < row.next_part) return c.json({ received });
      if (part > row.next_part) return c.json({ error: 'out-of-order', received }, 409);
      const last = partCount(Number(row.size), partBytes);
      const expected = part < last ? partBytes : Number(row.size) - (last - 1) * partBytes;
      if (part > last || bytes.length !== expected) return c.json({ error: 'part-size', received }, 400);
      // The signature, not the type the client claims: a video starts with its `ftyp` box (MEDIA-A6).
      if (part === 1 && !sniffVideoContainer(bytes)) return c.json({ error: 'invalid-video', problem: 'container' }, 400);
      return row;
    });
    if (before instanceof Response) return before;
    const sha = Sha256.from(JSON.parse(before.sha) as Sha256State).update(bytes).state();
    const token = await u.media.putPart(u.key, before.upload_id, part, (part - 1) * partBytes, bytes);
    return u.org.queue.run(async () => {
      // Only if no one else stored this part meanwhile: then theirs counts, and this one's bytes were the same.
      store.query('UPDATE media_uploads SET next_part = ?, parts = ?, sha = ?, updated_at = ? WHERE hash = ? AND upload_id = ? AND next_part = ?', [
        part + 1,
        JSON.stringify([...(JSON.parse(before.parts) as string[]), token]),
        JSON.stringify(sha),
        Date.now(),
        u.hash,
        before.upload_id,
        part,
      ]);
      const row = uploadOf(store, u.hash);
      return c.json({ received: row ? receivedOf(row, partBytes) : Number(before.size) });
    });
  });

  // Every part is there: the hash is checked, the object made, and its codec read from it before it is kept.
  app.post('/api/media/:hash/upload/finish', async (c) => {
    const u = await uploader(c);
    if (u instanceof Response) return u;
    const store = u.org.store;
    const known = () => store.query('SELECT content_type FROM media_blobs WHERE hash = ?', [u.hash])[0] as { content_type: string } | undefined;
    const row = await u.org.queue.run(async () => (known() ? null : uploadOf(store, u.hash)));
    if (row === null) return c.json({ done: true, type: known()!.content_type });
    if (!row) return c.json({ error: 'no-upload' }, 404);
    const size = Number(row.size);
    if (row.next_part - 1 !== partCount(size, partBytes)) return c.json({ error: 'incomplete', received: receivedOf(row, partBytes) }, 409);
    const forget = async () => {
      await u.media.abortUpload(u.key, row.upload_id);
      await u.org.queue.run(async () => void store.query('DELETE FROM media_uploads WHERE hash = ? AND upload_id = ?', [u.hash, row.upload_id]));
    };
    if (Sha256.from(JSON.parse(row.sha) as Sha256State).hex() !== u.hash) {
      await forget();
      return c.json({ error: 'hash-mismatch' }, 400);
    }
    try {
      await u.media.finishUpload(u.key, row.upload_id, JSON.parse(row.parts) as string[]);
    } catch (e) {
      // Finished by a second request meanwhile: that one keeps it.
      if (await u.org.queue.run(async () => known())) return c.json({ done: true, type: known()!.content_type });
      throw e;
    }
    const probe: VideoProbe = await probeVideo(storageReader(u.media, u.key, size), size);
    if (!probe.ok) {
      await u.media.delete(u.key);
      await forget();
      return c.json({ error: 'invalid-video', problem: probe.problem, ...(probe.entry ? { entry: probe.entry } : {}) }, 400);
    }
    await u.org.queue.run(async () => {
      const s = recordMediaBlobSql(u.hash, probe.type, size, null, Date.now());
      store.query(s.sql, s.params);
      store.query('DELETE FROM media_uploads WHERE hash = ?', [u.hash]);
    });
    return c.json({ done: true, type: probe.type, codec: probe.codec });
  });

  // A token for `<video src>`: this caller's organisation, this video, a few hours.
  app.post('/api/media/:hash/play', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ViewVideos')) return c.json({ error: 'forbidden' }, 403);
    const hash = c.req.param('hash') ?? '';
    if (!media || !playTokens) return c.json({ error: 'media-disabled' }, 503);
    const blob = MEDIA_HASH.test(hash) ? await r.org.queue.run(async () => videoBlob(r.org.store, hash)) : undefined;
    if (!blob) return c.json({ error: 'not-found' }, 404);
    const { token, expiresAt } = await playTokens.mint(r.caller.orgId, r.caller.sessionId, hash);
    return c.json({ url: `/api/play/${token}/${hash}`, expiresAt });
  });

  return app;
}

/**
 * `GET /api/play/{token}/{hash}`: a video streamed to whoever holds a token
 * for it, as a `<video src>` does. `resolve` checks the token and finds the
 * organisation (on Workers the Worker has done so and names it).
 */
export function playRoutes(resolve: (c: Context, token: string, hash: string) => Promise<{ org: Org; orgId: string } | null>, media: MediaStorage | null) {
  const app = new Hono();
  app.get('/api/play/:token/:hash', async (c) => {
    const hash = c.req.param('hash');
    const t = media && MEDIA_HASH.test(hash) ? await resolve(c, c.req.param('token'), hash) : null;
    const blob = t ? await t.org.queue.run(async () => videoBlob(t.org.store, hash)) : undefined;
    if (!t || !blob || !media) return c.json({ error: 'not-found' }, 404);
    return serveVideo(c, media, mediaKey(t.orgId, hash), blob);
  });
  return app;
}
