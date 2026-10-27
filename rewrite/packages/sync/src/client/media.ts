// Media blobs on a client (README, "Media"): a picture is two immutable blobs
// named by their SHA-256, kept in `media_blobs`, which does not sync. Only the
// `images` row syncs; this uploads the blobs of a queued `addImage` before it
// is pushed, downloads what the library names and this device lacks, and
// removes what nothing names.
import { MEDIA_HASH, ORPHAN_BLOBS_SQL, ORPHAN_GRACE_MS, recordMediaBlobSql, sha256HexBytes, sniffStoredImage } from '@gp/core';
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
  /** Named by an image, but the server did not have it or the download failed. */
  missing: string[];
  removed: number;
}

/**
 * Downloads the blobs (thumbnails first, so a grid fills quickly) that images
 * name and this device lacks, then removes blobs nothing names that are older
 * than the grace period, keeping any a queued `addImage` names. `download`
 * returns the bytes, or null if the server has none. Callers serialise this
 * with their own imports.
 */
export async function syncMedia(client: SyncClient, download: (hash: string) => Promise<Uint8Array | null>, now = Date.now()): Promise<MediaSync> {
  const result: MediaSync = { downloaded: [], missing: [], removed: 0 };
  const wanted = (await client.query(
    `SELECT hash FROM (
       SELECT thumb_hash AS hash, 0 AS rank FROM images UNION SELECT full_hash AS hash, 1 AS rank FROM images)
     WHERE hash NOT IN (SELECT hash FROM media_blobs WHERE bytes IS NOT NULL) GROUP BY hash ORDER BY min(rank)`,
  )) as { hash: string }[];
  for (const { hash } of wanted) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await download(hash);
    } catch {
      bytes = null;
    }
    const type = bytes && (await sha256HexBytes(bytes)) === hash ? sniffStoredImage(bytes) : null;
    if (!bytes || !type) {
      result.missing.push(hash);
      continue;
    }
    // A row from before (without bytes) cannot exist on a device, but a stale one is replaced all the same.
    await client.localWrite([{ sql: 'DELETE FROM media_blobs WHERE hash = ?', params: [hash] }, recordMediaBlobSql(hash, type, bytes.length, bytes, now)]);
    result.downloaded.push(hash);
  }

  const queued = new Set<string>();
  for (const mutation of (await client.pending()).filter((p) => p.name === 'addImage')) {
    const a = JSON.parse(mutation.args) as { fullHash?: unknown; thumbHash?: unknown };
    queued.add(String(a.fullHash));
    queued.add(String(a.thumbHash));
  }
  const unused = (await client.query(ORPHAN_BLOBS_SQL, [now - ORPHAN_GRACE_MS])) as { hash: string }[];
  const drop = unused.map((u) => u.hash).filter((h) => !queued.has(h));
  if (drop.length) await client.localWrite(drop.map((h) => ({ sql: 'DELETE FROM media_blobs WHERE hash = ?', params: [h] })));
  result.removed = drop.length;
  return result;
}

/** Sends a blob to the server (`PUT /media/{hash}`) and returns the HTTP status. Throws when the server cannot be reached. */
export type MediaBlobUpload = (hash: string, bytes: Uint8Array) => Promise<number>;

/**
 * Uploads the blobs of every queued `addImage` before the mutation is pushed,
 * so a picture imported offline reaches the server with its bytes. Give
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
      if (m.name !== 'addImage') continue;
      const args = JSON.parse(m.args) as { fullHash?: unknown; thumbHash?: unknown };
      for (const hash of new Set([String(args.fullHash), String(args.thumbHash)])) {
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
