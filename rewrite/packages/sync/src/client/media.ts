// Media blobs on a client (docs/media-and-files.md, "Media"): a picture is two immutable blobs
// named by their SHA-256, kept in `media_blobs`, which does not sync. Only the
// `images` row syncs; this uploads the blobs of a queued `addImage` (or
// `addAudio`, `addVideo`, `addSlides`) before it is pushed, downloads what the library names and this device lacks, and
// removes what nothing names. A video itself is never kept on a device: it was uploaded before its
// `addVideo` was queued, is recorded here without its bytes, and streams from the server.
import { ITEM_IMAGES_SQL, MEDIA_HASH, ORPHAN_BLOBS_SQL, ORPHAN_GRACE_MS, recordMediaBlobSql, sha256HexBytes, SLIDE_PAGES_SQL, sniffMedia } from '@gp/core';
import type { PendingMutation, SyncClient } from './client.ts';

export interface MediaBlob {
  contentType: string;
  bytes: Uint8Array;
}

/** Keeps a blob here and returns its hash. The `addImage` that names it can then be queued, online or not. */
export async function storeMediaBlob(client: SyncClient, bytes: Uint8Array, contentType: string): Promise<string> {
  const hash = await sha256HexBytes(bytes);
  await client.localWrite([recordMediaBlobSql(hash, contentType, bytes.length, bytes, Date.now())]);
  return hash;
}

export async function hasMediaBlob(client: SyncClient, hash: string): Promise<boolean> {
  return (await client.query('SELECT 1 FROM media_blobs WHERE hash = ? AND bytes IS NOT NULL', [hash])).length > 0;
}

export async function loadMediaBlob(client: SyncClient, hash: string): Promise<MediaBlob | null> {
  const [r] = await client.query('SELECT content_type, bytes FROM media_blobs WHERE hash = ? AND bytes IS NOT NULL', [hash]);
  return r ? { contentType: String(r.content_type), bytes: new Uint8Array(r.bytes as ArrayLike<number>) } : null;
}

export interface MediaSync {
  downloaded: string[];
  /** Wanted, but the server did not have it or the download failed. */
  missing: string[];
  /** Blobs dropped: unused by any image, audio file or slide deck, or evicted to stay within the budget. */
  removed: number;
}

/**
 * Which files this device fetches (docs/media-and-files.md, "Which files a device keeps").
 * Every picture's and video's thumbnail, always. The full picture, the audio, a video's still (never the
 * video itself, which streams) and the slide decks' pages (both sizes) of a presentation that is open here, or, on a device that keeps its data,
 * coming up within `days`. Every overlay's picture when either applies. Never audio for a presentation this device only
 * controls: it plays on the presenting computer.
 */
export interface MediaPolicy {
  /** Presentations open on this device now (editor, live, remote control), and whether their audio is wanted. */
  open: { presentationId: string; audio: boolean }[];
  /** Fetch coming presentations ahead: a device that keeps its data (OPFS, the desktop app, the tablet app). */
  prefetch: boolean;
  /** Today on this device, `YYYY-MM-DD`. */
  today: string;
  /** How many days ahead a presentation counts as coming: 7. */
  days: number;
  /** Most bytes kept of files no open or coming presentation needs (MEDIA-R14: 2 GiB). */
  budget: number;
  /**
   * False where the files are shown from elsewhere (a desktop host's own window, from its
   * server): nothing is wanted, so nothing is fetched, and with a budget of 0 only what
   * waits to be uploaded is kept.
   */
  fetch?: boolean;
}

export const DEFAULT_MEDIA_POLICY = { open: [], prefetch: true, days: 7, budget: 2 * 1024 * 1024 * 1024 } as const;

/** `YYYY-MM-DD` plus `days`, in the calendar (no time zone: dates in presentations are plain dates). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * The blobs this device should hold now, in the order to fetch them:
 * thumbnails, then the overlays' pictures, then what the open presentations
 * need, then those kept offline on this device, then the coming ones.
 */
export async function wantedBlobs(client: SyncClient, policy: MediaPolicy): Promise<string[]> {
  if (policy.fetch === false) return [];
  const thumbs = (await client.query(
    'SELECT hash FROM (SELECT thumb_hash AS hash, created_at FROM images UNION ALL SELECT thumb_hash AS hash, created_at FROM videos) ORDER BY created_at DESC',
  )) as { hash: string }[];
  const coming = policy.prefetch
    ? ((await client.query('SELECT id FROM presentations WHERE deleted_at IS NULL AND event_date >= ? AND event_date <= ? ORDER BY event_date', [
        policy.today,
        addDays(policy.today, policy.days),
      ])) as { id: string }[])
    : [];
  // Kept offline on this device ("Tillgänglig offline"), whatever the date: only where the data survives a reload.
  const pinned = policy.prefetch
    ? ((await client.query(
        'SELECT p.id FROM pinned_presentations k JOIN presentations p ON p.id = k.id WHERE p.deleted_at IS NULL ORDER BY k.pinned_at',
      )) as { id: string }[])
    : [];
  const order = [...policy.open, ...pinned.map((c) => ({ presentationId: c.id, audio: true })), ...coming.map((c) => ({ presentationId: c.id, audio: true }))];
  const hashes: string[] = thumbs.map((t) => t.hash);
  // Every overlay's picture: any of them can be switched on during live. Ahead where data is kept, else once a presentation is open.
  if (policy.prefetch || policy.open.length) {
    const overlayImages = (await client.query('SELECT i.full_hash AS hash FROM overlays o JOIN images i ON i.id = o.image_id ORDER BY o.sort')) as { hash: string }[];
    hashes.push(...overlayImages.map((o) => o.hash));
  }
  for (const { presentationId, audio } of order) {
    const items = (await client.query(
      `SELECT i.full_hash AS hash FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id
         WHERE p.presentation_id = ?
       UNION ALL
       SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id
         WHERE p.presentation_id = ? AND p.type = 'audio' AND ?
       UNION ALL
       SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id
         WHERE p.presentation_id = ? AND p.type = 'video'
       UNION ALL
       SELECT s.thumb_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?
       UNION ALL
       SELECT s.full_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?`,
      [presentationId, presentationId, audio ? 1 : 0, presentationId, presentationId, presentationId],
    )) as { hash: string }[];
    hashes.push(...items.map((i) => i.hash));
  }
  return [...new Set(hashes)];
}

/**
 * Fetches the blobs `wantedBlobs` names that this device lacks, checking
 * each one's hash. Then removes blobs nothing names (after the grace period,
 * and never what a queued add names), and, while the files no open or
 * coming presentation needs are above the budget, the oldest of those.
 * `download` returns the bytes, or null if the server has none. Callers
 * serialise this with their own imports.
 */
export async function syncMedia(
  client: SyncClient,
  download: (hash: string) => Promise<Uint8Array | null>,
  now = Date.now(),
  policy: MediaPolicy = { ...DEFAULT_MEDIA_POLICY, open: [], today: new Date(now).toISOString().slice(0, 10) },
): Promise<MediaSync> {
  const result: MediaSync = { downloaded: [], missing: [], removed: 0 };
  const wanted = await wantedBlobs(client, policy);
  const have = new Set(((await client.query('SELECT hash FROM media_blobs WHERE bytes IS NOT NULL')) as { hash: string }[]).map((r) => r.hash));
  for (const hash of wanted) {
    if (have.has(hash)) continue;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await download(hash);
    } catch {
      bytes = null;
    }
    const type = bytes && (await sha256HexBytes(bytes)) === hash ? (sniffMedia(bytes)?.type ?? null) : null;
    if (!bytes || !type) {
      result.missing.push(hash);
      continue;
    }
    // A row without bytes on a device is a video's, which is never wanted here; a stale one is replaced all the same.
    await client.localWrite([{ sql: 'DELETE FROM media_blobs WHERE hash = ?', params: [hash] }, recordMediaBlobSql(hash, type, bytes.length, bytes, now)]);
    result.downloaded.push(hash);
  }

  const queued = new Set<string>();
  for (const mutation of await client.pending()) {
    if (!BLOB_ADDS.has(mutation.name)) continue;
    for (const hash of blobsOf(mutation)) queued.add(hash);
  }
  const unused = (await client.query(ORPHAN_BLOBS_SQL, [now - ORPHAN_GRACE_MS])) as { hash: string }[];
  const drop = unused.map((u) => u.hash).filter((h) => !queued.has(h));

  // Within the budget: what nobody needs now goes, oldest first; what is wanted, or waiting to be uploaded, stays.
  const keep = new Set([...wanted, ...queued, ...drop]);
  const spare = ((await client.query('SELECT hash, size FROM media_blobs WHERE bytes IS NOT NULL ORDER BY received_at, hash')) as { hash: string; size: number }[]).filter(
    (b) => !keep.has(b.hash),
  );
  let spareBytes = spare.reduce((n, b) => n + Number(b.size), 0);
  for (const b of spare) {
    if (spareBytes <= policy.budget) break;
    drop.push(b.hash);
    spareBytes -= Number(b.size);
  }

  if (drop.length) await client.localWrite(drop.map((h) => ({ sql: 'DELETE FROM media_blobs WHERE hash = ?', params: [h] })));
  result.removed = drop.length;
  return result;
}

/**
 * What a presentation's items need from the media library, and how much of
 * it this device has: for "Allt finns på den här datorn" before going live.
 * Every overlay's picture counts, since any overlay can be shown.
 */
export async function presentationMediaState(
  client: { query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> },
  presentationId: string,
  audio = true,
): Promise<{ needed: number; present: number }> {
  const rows = (await client.query(
    `SELECT h.hash, EXISTS (SELECT 1 FROM media_blobs b WHERE b.hash = h.hash AND b.bytes IS NOT NULL) AS present FROM (
       SELECT i.full_hash AS hash FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id WHERE p.presentation_id = ?
       UNION SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'audio' AND ?
       UNION SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'
       UNION SELECT s.full_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?
       UNION SELECT i.full_hash AS hash FROM overlays o JOIN images i ON i.id = o.image_id) h`,
    [presentationId, presentationId, audio ? 1 : 0, presentationId, presentationId],
  )) as { hash: string; present: number }[];
  return { needed: rows.length, present: rows.filter((r) => Number(r.present)).length };
}

/** The mutations that name blobs the device must upload first. */
const BLOB_ADDS: ReadonlySet<string> = new Set(['addImage', 'addAudio', 'addVideo', 'addSlides']);

/**
 * The blobs a queued add names: a picture's two, an audio file's one, a video's three, or two per page of a
 * slide deck. A video's own blob has no bytes here: it was uploaded before the add, so it is only kept named.
 */
function blobsOf(m: PendingMutation): Set<string> {
  const a = JSON.parse(m.args) as { fullHash?: unknown; thumbHash?: unknown; hash?: unknown; stillHash?: unknown; pages?: unknown };
  if (m.name === 'addAudio') return new Set([String(a.hash)]);
  if (m.name === 'addVideo') return new Set([String(a.hash), String(a.stillHash), String(a.thumbHash)]);
  if (m.name === 'addSlides') {
    const pages = Array.isArray(a.pages) ? (a.pages as { full?: unknown; thumb?: unknown }[]) : [];
    return new Set(pages.flatMap((p) => [String(p?.full), String(p?.thumb)]));
  }
  return new Set([String(a.fullHash), String(a.thumbHash)]);
}

/** Sends a blob to the server (`PUT /media/{hash}`) and returns the HTTP status. Throws when the server cannot be reached. */
export type MediaBlobUpload = (hash: string, bytes: Uint8Array) => Promise<number>;

/**
 * Uploads the blobs of every queued `addImage`, `addAudio`, `addVideo` (its still) and `addSlides`
 * before the mutation is pushed, so a file imported offline reaches the server with its bytes. Give
 * `beforePush` to the SyncClient, alone or through `chainBeforePush`.
 *
 * An upload that cannot reach the server, or fails on its side (5xx), holds
 * that add and every mutation after it back until the next push. One the
 * server refuses (4xx) lets the add go, to be refused with a reason the user
 * sees (`media-missing`).
 */
export class MediaUploads {
  /**
   * Blobs this session has uploaded, and when. One whose add has waited half
   * the server's grace period is uploaded again, which starts that period
   * over, so the server never removes it before its add arrives. A restart
   * uploads a queued one again; the server takes it twice.
   */
  private uploaded = new Map<string, number>();

  constructor(
    private upload: MediaBlobUpload,
    private now: () => number = Date.now,
  ) {}

  beforePush = async (pending: PendingMutation[], client: SyncClient): Promise<number | undefined> => {
    for (const [i, m] of pending.entries()) {
      if (!BLOB_ADDS.has(m.name)) continue;
      for (const hash of blobsOf(m)) {
        const at = this.uploaded.get(hash);
        if (!MEDIA_HASH.test(hash) || (at !== undefined && this.now() - at < ORPHAN_GRACE_MS / 2)) continue;
        const blob = await loadMediaBlob(client, hash);
        if (!blob) continue; // nothing to send: the server refuses the add
        let status: number;
        try {
          status = await this.upload(hash, blob.bytes);
        } catch {
          return i; // unreachable: this add and what follows wait
        }
        if (status >= 500) return i;
        if (status < 300) this.uploaded.set(hash, this.now());
      }
    }
    return undefined;
  };
}

type BeforePush = (pending: PendingMutation[], client: SyncClient) => Promise<number | undefined>;

/** Runs several `beforePush` hooks in turn; the push is cut where the earliest one says. */
export function chainBeforePush(...hooks: BeforePush[]): BeforePush {
  return async (pending, client) => {
    let cut: number | undefined;
    for (const hook of hooks) {
      const at = await hook(pending, client);
      if (at !== undefined) cut = Math.min(cut ?? at, at);
    }
    return cut;
  };
}

/** Keeps a presentation's files on this device whatever its date, or stops doing so ("Tillgänglig offline"). */
export async function setPinned(client: SyncClient, presentationId: string, on: boolean, now = Date.now()): Promise<void> {
  await client.localWrite([
    on
      ? { sql: 'INSERT INTO pinned_presentations (id, pinned_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING', params: [presentationId, now] }
      : { sql: 'DELETE FROM pinned_presentations WHERE id = ?', params: [presentationId] },
  ]);
}
