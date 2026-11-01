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
  /** Bytes of the blobs kept that nothing wants now (the cache), after the drop: the videos share the budget with them. */
  cache: number;
}

/**
 * Which files this device fetches (docs/media-and-files.md, "Which files a device keeps"; TODO.md "Video,
 * and which files a device fetches"). Every picture's and video's thumbnail, always: the library and the
 * tiles show them. Looking around fetches nothing heavier. Presenting fetches the presentation's files at
 * once: its full pictures, its audio, its videos' stills, its slide decks' pages and every overlay's
 * picture (never a video: it streams). A presentation kept offline on a device that keeps its data has
 * the same fetched and kept, whatever its date; with "Spara kommande presentationer offline" so has every
 * presentation of the coming `days`. What presenting fetched stays afterwards as cache, within `budget`.
 */
export interface MediaPolicy {
  /** The presentation this window presents (Starta presentation), or null. */
  presenting: string | null;
  /** The device keeps its data between reloads (OPFS, the desktop app, the tablet app): only then can it keep a presentation offline. */
  persistent: boolean;
  /** "Spara kommande presentationer offline": the presentations from today to `days` ahead are kept offline. */
  keepComing: boolean;
  /** Today on this device, `YYYY-MM-DD`. */
  today: string;
  /** How many days ahead a presentation counts as coming: 7. */
  days: number;
  /** Most bytes kept of files nothing wants now, the cache (MEDIA-R14: 2 GiB). */
  budget: number;
  /**
   * False where the files are shown from elsewhere (a desktop host's own window, from its
   * server): nothing is wanted, so nothing is fetched, and with a budget of 0 only what
   * waits to be uploaded is kept.
   */
  fetch?: boolean;
}

export const DEFAULT_MEDIA_POLICY = { presenting: null, persistent: true, keepComing: false, days: 7, budget: 2 * 1024 * 1024 * 1024 } as const;

/** `YYYY-MM-DD` plus `days`, in the calendar (no time zone: dates in presentations are plain dates). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

type Query = { query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> };

/**
 * The presentations kept offline on this device: those chosen by hand (`pinned_presentations`), and, with
 * `keepComing`, those dated from today to `days` ahead. None on a device that keeps nothing between reloads.
 */
export async function keptPresentations(client: Query, policy: Pick<MediaPolicy, 'persistent' | 'keepComing' | 'today' | 'days'>): Promise<string[]> {
  if (!policy.persistent) return [];
  const pinned = (await client.query(
    'SELECT p.id FROM pinned_presentations k JOIN presentations p ON p.id = k.id WHERE p.deleted_at IS NULL ORDER BY k.pinned_at',
  )) as { id: string }[];
  const coming = policy.keepComing
    ? ((await client.query('SELECT id FROM presentations WHERE deleted_at IS NULL AND is_template = 0 AND event_date >= ? AND event_date <= ? ORDER BY event_date', [
        policy.today,
        addDays(policy.today, policy.days),
      ])) as { id: string }[])
    : [];
  return [...new Set([...pinned, ...coming].map((p) => p.id))];
}

/** Every file a presentation needs live, but its videos: full pictures, audio, stills, slide pages (both sizes). */
async function presentationFiles(client: Query, presentationId: string): Promise<string[]> {
  const rows = (await client.query(
    `SELECT i.full_hash AS hash FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id
       WHERE p.presentation_id = ?
     UNION ALL
     SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'audio'
     UNION ALL
     SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'video'
     UNION ALL
     SELECT s.thumb_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?
     UNION ALL
     SELECT s.full_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?`,
    [presentationId, presentationId, presentationId, presentationId, presentationId],
  )) as { hash: string }[];
  return rows.map((r) => r.hash);
}

/** The videos of the presentations kept offline: kept whole on a device that keeps its data, outside `media_blobs`. */
export async function wantedVideos(client: Query, policy: MediaPolicy): Promise<{ hash: string; size: number }[]> {
  if (policy.fetch === false) return [];
  const kept = await keptPresentations(client, policy);
  if (!kept.length) return [];
  const rows = (await client.query(
    `SELECT DISTINCT v.hash, v.size FROM presentation_items p JOIN videos v ON v.id = p.source_id
      WHERE p.type = 'video' AND p.presentation_id IN (${kept.map(() => '?').join(',')})`,
    kept,
  )) as { hash: string; size: number }[];
  return rows.map((r) => ({ hash: String(r.hash), size: Number(r.size) }));
}

/**
 * The blobs this device should hold now, in the order to fetch them:
 * thumbnails, then what the presented presentation needs (the overlays' pictures first), then what the
 * presentations kept offline need.
 */
export async function wantedBlobs(client: SyncClient, policy: MediaPolicy): Promise<string[]> {
  if (policy.fetch === false) return [];
  const thumbs = (await client.query(
    'SELECT hash FROM (SELECT thumb_hash AS hash, created_at FROM images UNION ALL SELECT thumb_hash AS hash, created_at FROM videos) ORDER BY created_at DESC',
  )) as { hash: string }[];
  const hashes: string[] = thumbs.map((t) => t.hash);
  const order = [...new Set([...(policy.presenting ? [policy.presenting] : []), ...(await keptPresentations(client, policy))])];
  // Every overlay's picture: any of them can be switched on during live.
  if (order.length) {
    const overlayImages = (await client.query('SELECT i.full_hash AS hash FROM overlays o JOIN images i ON i.id = o.image_id ORDER BY o.sort')) as { hash: string }[];
    hashes.push(...overlayImages.map((o) => o.hash));
  }
  for (const presentationId of order) hashes.push(...(await presentationFiles(client, presentationId)));
  return [...new Set(hashes)];
}

/**
 * Fetches the blobs `wantedBlobs` names that this device lacks, checking
 * each one's hash. Then removes blobs nothing names (after the grace period,
 * and never what a queued add names), and, while the files nothing wants
 * now (the cache) are above the budget, the oldest of those.
 * `download` returns the bytes, or null if the server has none. Callers
 * serialise this with their own imports.
 */
export async function syncMedia(
  client: SyncClient,
  download: (hash: string) => Promise<Uint8Array | null>,
  now = Date.now(),
  policy: MediaPolicy = { ...DEFAULT_MEDIA_POLICY, today: new Date(now).toISOString().slice(0, 10) },
): Promise<MediaSync> {
  const result: MediaSync = { downloaded: [], missing: [], removed: 0, cache: 0 };
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
  result.cache = spareBytes;
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

/**
 * How much of a presentation kept offline is on this device (the icon, docs/media-and-files.md "Kept
 * offline"): every file it needs live, its videos whole too, as a share from 0 to 1 (a video counts by
 * the bytes it has so far), and whether all of it is here.
 */
export async function presentationOfflineState(client: Query, presentationId: string): Promise<{ share: number; complete: boolean; files: number }> {
  const small = (await client.query(
    `SELECT h.hash, EXISTS (SELECT 1 FROM media_blobs b WHERE b.hash = h.hash AND b.bytes IS NOT NULL) AS present FROM (
       SELECT i.full_hash AS hash FROM (${ITEM_IMAGES_SQL}) p JOIN images i ON i.id = p.image_id WHERE p.presentation_id = ?
       UNION SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'audio'
       UNION SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'
       UNION SELECT s.full_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?
       UNION SELECT s.thumb_hash AS hash FROM (${SLIDE_PAGES_SQL}) s WHERE s.presentation_id = ?
       UNION SELECT i.full_hash AS hash FROM overlays o JOIN images i ON i.id = o.image_id) h`,
    [presentationId, presentationId, presentationId, presentationId, presentationId],
  )) as { hash: string; present: number }[];
  const videos = (await client.query(
    `SELECT DISTINCT v.hash, v.size, COALESCE(f.received, 0) AS received FROM presentation_items p JOIN videos v ON v.id = p.source_id
       LEFT JOIN video_files f ON f.hash = v.hash WHERE p.presentation_id = ? AND p.type = 'video'`,
    [presentationId],
  )) as { hash: string; size: number; received: number }[];
  const files = small.length + videos.length;
  if (!files) return { share: 1, complete: true, files: 0 };
  const done = small.filter((r) => Number(r.present)).length + videos.reduce((n, v) => n + Math.min(1, Number(v.received) / Math.max(1, Number(v.size))), 0);
  const complete = small.every((r) => Number(r.present)) && videos.every((v) => Number(v.received) >= Number(v.size));
  return { share: complete ? 1 : Math.min(0.99, done / files), complete, files };
}

/** The mutations that name blobs the device must upload first. */
const BLOB_ADDS: ReadonlySet<string> = new Set(['addImage', 'addAudio', 'addVideo', 'addSlides', 'addSongFile']);

/**
 * The blobs a queued add names: a picture's two, an audio file's or a song's PDF's one, a video's three, or two per
 * page of a slide deck. A video's own blob has no bytes here: it was uploaded before the add, so it is only kept named.
 */
function blobsOf(m: PendingMutation): Set<string> {
  const a = JSON.parse(m.args) as { fullHash?: unknown; thumbHash?: unknown; hash?: unknown; stillHash?: unknown; pages?: unknown };
  if (m.name === 'addAudio' || m.name === 'addSongFile') return new Set([String(a.hash)]);
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

/** A video kept whole on this device, as `video_files` records it. */
export interface KeptVideo {
  hash: string;
  size: number;
  received: number;
  usedAt: number;
}

/**
 * The video files to drop: those nothing keeps offline any more are cache, sharing the budget with the
 * blobs' cache (`room` is what the blobs left of it), dropped oldest first; a part nothing keeps goes at
 * once. What is kept offline is never dropped: it is bounded by the disk only.
 */
export function videosToDrop(files: KeptVideo[], kept: ReadonlySet<string>, room: number): string[] {
  const spare = files.filter((f) => !kept.has(f.hash)).toSorted((a, b) => a.usedAt - b.usedAt || a.hash.localeCompare(b.hash));
  const drop = spare.filter((f) => f.received < f.size).map((f) => f.hash);
  const whole = spare.filter((f) => f.received >= f.size);
  let bytes = whole.reduce((n, f) => n + f.size, 0);
  for (const f of whole) {
    if (bytes <= room) break;
    drop.push(f.hash);
    bytes -= f.size;
  }
  return drop;
}

/** How this device's files are used (Mina inställningar, "Lagring på den här enheten"). Bytes; a file shared by two presentations counts once in the totals. */
export interface StorageReport {
  /** Every file kept here: pictures, audio, stills, pages, and videos so far. */
  total: number;
  /** Each presentation kept offline, with the bytes of the files it needs that are here (shared ones too). */
  offline: { presentationId: string; bytes: number }[];
  /** The files of all presentations kept offline, each once. */
  offlineTotal: number;
  /** What nothing wants now: the cache, which the limit bounds and "Rensa cache" empties. */
  cache: number;
}

/**
 * The storage report. The cache is what is neither a thumbnail, nor waiting to be uploaded, nor needed by
 * the presentation shown now or one kept offline: what "Rensa cache" may drop.
 */
export async function storageReport(client: SyncClient, policy: MediaPolicy): Promise<StorageReport> {
  const blobs = ((await client.query('SELECT hash, size FROM media_blobs WHERE bytes IS NOT NULL')) as { hash: string; size: number }[]).map((b) => ({ hash: b.hash, size: Number(b.size) }));
  const videos = ((await client.query('SELECT hash, received FROM video_files')) as { hash: string; received: number }[]).map((v) => ({ hash: v.hash, size: Number(v.received) }));
  const sizes = new Map([...blobs, ...videos].map((f) => [f.hash, f.size]));
  const queued = new Set<string>();
  for (const m of await client.pending()) if (BLOB_ADDS.has(m.name)) for (const hash of blobsOf(m)) queued.add(hash);
  const wanted = new Set([...(await wantedBlobs(client, policy)), ...queued, ...(await wantedVideos(client, policy)).map((v) => v.hash)]);
  const sum = (hashes: Iterable<string>) => [...new Set(hashes)].reduce((n, h) => n + (sizes.get(h) ?? 0), 0);
  const kept = await keptPresentations(client, policy);
  const overlays = ((await client.query('SELECT i.full_hash AS hash FROM overlays o JOIN images i ON i.id = o.image_id')) as { hash: string }[]).map((o) => o.hash);
  const offline: StorageReport['offline'] = [];
  const keptFiles: string[] = [];
  for (const presentationId of kept) {
    const own = (await client.query(`SELECT v.hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'`, [presentationId])) as {
      hash: string;
    }[];
    const files = [...overlays, ...(await presentationFiles(client, presentationId)), ...own.map((v) => v.hash)];
    keptFiles.push(...files);
    offline.push({ presentationId, bytes: sum(files) });
  }
  return { total: sum(sizes.keys()), offline, offlineTotal: sum(keptFiles), cache: sum([...sizes.keys()].filter((h) => !wanted.has(h))) };
}
