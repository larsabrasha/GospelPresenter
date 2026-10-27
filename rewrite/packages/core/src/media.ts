// The media library (spec 05 "Media"): limits, how a picture is fitted, and
// how a blob is recognised. The picture's pixels are handled by the client
// (ADR 0007 decision 9: clients compress before upload); the server only
// checks what it is given.

/** Spec 05 MEDIA-R1 and R3. Trashed images do not count towards the maximum. */
export const MEDIA_LIMITS = {
  /** What a user may pick, before it is compressed: 10 MiB. */
  sourceBytes: 10 * 1024 * 1024,
  /** What the server takes for one stored blob: the same, so a client that kept the original still passes. */
  blobBytes: 10 * 1024 * 1024,
  fileName: 200,
  images: 1000,
} as const;

/** The two sizes every picture is stored in (MEDIA-R4). */
export const IMAGE_VARIANTS = { full: { width: 1920, height: 1080, quality: 0.9 }, thumb: { width: 400, height: 225, quality: 0.8 } } as const;

/** What a user may pick (MEDIA-R1), by the type the browser reports or the extension (MEDIA-R13). */
export const PICKABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type PickableImageType = (typeof PICKABLE_IMAGE_TYPES)[number];

/** What is stored (MEDIA-R4): JPEG stays JPEG, PNG, WebP and GIF become WebP. */
export const STORED_IMAGE_TYPES = ['image/jpeg', 'image/webp'] as const;
export type StoredImageType = (typeof STORED_IMAGE_TYPES)[number];

const EXTENSION_TYPES: Record<string, PickableImageType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** The type a file name's extension says, or null (MEDIA-R13: the extension decides on a device). */
export function imageTypeFromName(fileName: string): PickableImageType | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (EXTENSION_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

export function storedTypeFor(picked: PickableImageType): StoredImageType {
  return picked === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
}

/**
 * The size of a picture fitted within a box, aspect kept and never upscaled:
 * scale = min(maxW / w, maxH / h), rounded (MEDIA-R4).
 */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * What the bytes are, by their first bytes: a stored image type, or null. The
 * server uses this, not the type a client claims, so it serves only a picture
 * it has seen the signature of.
 */
export function sniffStoredImage(bytes: Uint8Array): StoredImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, text: string) => bytes.length >= from + text.length && [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

export const MEDIA_HASH = /^[0-9a-f]{64}$/;

/**
 * The key of a blob in the media storage (MEDIA-R11): always under its
 * organisation, from the caller's session and never from input. The hash
 * names the content, so the same picture twice is one object.
 */
export function mediaKey(orgId: string, hash: string): string {
  if (!MEDIA_HASH.test(hash)) throw new Error('not a media hash');
  // Dots are escaped too, so no organisation id can be a `..` path segment on a disk.
  return `org/${encodeURIComponent(orgId).replace(/\./g, '%2E')}/media/${hash}`;
}

/** Records a blob in `media_blobs` where this runs: with its bytes on a device, without them on the server. */
export function recordMediaBlobSql(hash: string, contentType: string, size: number, bytes: Uint8Array | null, now: number) {
  return {
    sql: `INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (hash) DO NOTHING`,
    params: [hash, contentType, size, bytes, now],
  };
}

/** How long a blob nothing names is kept, so one uploaded just before its `addImage` is pushed survives. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/** The blobs no image names, older than the grace period: what a clean-up may remove. */
export const ORPHAN_BLOBS_SQL = `SELECT hash FROM media_blobs
  WHERE received_at < ?
    AND hash NOT IN (SELECT full_hash FROM images)
    AND hash NOT IN (SELECT thumb_hash FROM images)`;
