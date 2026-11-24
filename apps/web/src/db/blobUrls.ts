// Object URLs for the media blobs a window shows or plays, made once per blob and let go when nothing holds them.
import type { MediaBytes, ReadDb } from './share.ts';

/**
 * Object URLs of blobs, by hash: a blob never changes, so one URL per window serves every use of it. Each
 * holds a copy of the bytes in this window's memory, so a URL that nothing holds any more (`holdBlobUrl`) is
 * let go BLOB_URL_GRACE_MS later: a slide shown again soon after finds it still there.
 */
const blobUrls = new Map<string, string>();
/** How many hold each blob's URL now (a picture on screen, an audio element playing it). */
const holders = new Map<string, number>();
/** URLs nothing holds, and when each is let go. */
const letGo = new Map<string, ReturnType<typeof setTimeout>>();

/** How long a URL nothing holds is kept before it is let go. */
export const BLOB_URL_GRACE_MS = 30_000;

/** Fetches from the server under way, by hash: many slides may show one picture. */
const fetching = new Map<string, Promise<MediaBytes | null>>();

function letGoLater(hash: string) {
  if ((holders.get(hash) ?? 0) > 0 || letGo.has(hash) || !blobUrls.has(hash)) return;
  letGo.set(
    hash,
    setTimeout(() => {
      letGo.delete(hash);
      if ((holders.get(hash) ?? 0) > 0) return;
      const url = blobUrls.get(hash);
      blobUrls.delete(hash);
      if (url) URL.revokeObjectURL(url);
    }, BLOB_URL_GRACE_MS),
  );
}

/** Keeps a blob's URL while something shows or plays it; the returned function lets go. */
export function holdBlobUrl(hash: string): () => void {
  holders.set(hash, (holders.get(hash) ?? 0) + 1);
  const timer = letGo.get(hash);
  if (timer) clearTimeout(timer);
  letGo.delete(hash);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const n = (holders.get(hash) ?? 1) - 1;
    if (n > 0) holders.set(hash, n);
    else holders.delete(hash);
    letGoLater(hash);
  };
}

/** How many blob URLs this window has made and not let go: for tests. */
export function blobUrlCount(): number {
  return blobUrls.size;
}

/**
 * A blob as an object URL: from this device's own copy, or, in a desktop
 * host's own window, which keeps none, from the server (`ReadDb.fetchMedia`).
 * Null while it cannot be had (the next database change asks again). Works in
 * the output window too, which reads through the operator window. A URL no one
 * holds (`holdBlobUrl`) is let go after a while, as its bytes are in memory.
 */
export async function blobUrl(db: ReadDb, hash: string): Promise<string | null> {
  const known = blobUrls.get(hash);
  if (known) return known;
  const [r] = await db.query<{ content_type: string; bytes: Uint8Array | null }>('SELECT content_type, bytes FROM media_blobs WHERE hash = ? AND bytes IS NOT NULL', [hash]);
  let blob: MediaBytes | null = r?.bytes ? { contentType: r.content_type, bytes: r.bytes } : null;
  if (!blob) {
    let p = fetching.get(hash);
    if (!p) fetching.set(hash, (p = db.fetchMedia(hash).finally(() => fetching.delete(hash))));
    blob = await p;
  }
  if (!blob) return null;
  const url = blobUrls.get(hash) ?? URL.createObjectURL(new Blob([blob.bytes as BlobPart], { type: blob.contentType }));
  blobUrls.set(hash, url);
  letGoLater(hash);
  return url;
}
