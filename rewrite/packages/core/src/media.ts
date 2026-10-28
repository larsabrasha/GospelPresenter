// The media library (spec 05 "Media"): limits, how a picture is fitted, and
// how a blob is recognised. The picture's pixels are handled by the client
// (ADR 0007 decision 9: clients compress before upload); the server only
// checks what it is given.

/** Spec 05 MEDIA-R1 and R3. Trashed files do not count towards the maximums. */
export const MEDIA_LIMITS = {
  /** What a user may pick, before it is compressed: 10 MiB. */
  sourceBytes: 10 * 1024 * 1024,
  /** What the server takes for one stored picture blob: the same, so a client that kept the original still passes. */
  blobBytes: 10 * 1024 * 1024,
  /** An audio file, stored as it is (MEDIA-R5): 20 MiB. */
  audioBytes: 20 * 1024 * 1024,
  fileName: 200,
  images: 1000,
  audios: 500,
} as const;

/** What a user may pick as audio (MEDIA-R1), by the type the browser reports or the extension (MEDIA-R13). */
export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/x-m4a'] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

const AUDIO_EXTENSIONS: Record<string, AudioType> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/x-m4a',
  mp4: 'audio/mp4',
  m4b: 'audio/mp4',
  webm: 'audio/webm',
};

export function audioTypeFromName(fileName: string): AudioType | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (AUDIO_EXTENSIONS[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

/**
 * What audio bytes are, by their first bytes, or null. The server stores the
 * file as it is (MEDIA-R5), but serves it with the type it has seen the
 * signature of, never one a client claims.
 */
export function sniffAudio(bytes: Uint8Array): AudioType | null {
  const ascii = (from: number, text: string) => bytes.length >= from + text.length && [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (ascii(0, 'ID3') || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(4, 'ftyp')) return ascii(8, 'M4A ') ? 'audio/x-m4a' : 'audio/mp4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  return null;
}

/** A blob the server takes: a stored picture (up to 10 MiB) or an audio file (up to 20 MiB). */
export function sniffMedia(bytes: Uint8Array): { type: string; maxBytes: number } | null {
  const image = sniffStoredImage(bytes);
  if (image) return { type: image, maxBytes: MEDIA_LIMITS.blobBytes };
  const audio = sniffAudio(bytes);
  return audio ? { type: audio, maxBytes: MEDIA_LIMITS.audioBytes } : null;
}

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

/** How long a blob nothing names is kept, so one uploaded just before its `addImage` or `addSlides` is pushed survives. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Every page of every slide deck item (`SlidesItemContent`), with the
 * presentation it is in: the pictures a deck names. A row per page.
 */
export const SLIDE_PAGES_SQL = `SELECT p.presentation_id, json_extract(j.value, '$.full') AS full_hash, json_extract(j.value, '$.thumb') AS thumb_hash
  FROM presentation_items p, json_each(p.content, '$.pages') j WHERE p.type = 'slides'`;

/** The blobs no image, audio file or slide deck names, older than the grace period: what a clean-up may remove. */
export const ORPHAN_BLOBS_SQL = `SELECT hash FROM media_blobs
  WHERE received_at < ?
    AND hash NOT IN (SELECT full_hash FROM images)
    AND hash NOT IN (SELECT thumb_hash FROM images)
    AND hash NOT IN (SELECT hash FROM audios)
    AND hash NOT IN (SELECT full_hash FROM (${SLIDE_PAGES_SQL}))
    AND hash NOT IN (SELECT thumb_hash FROM (${SLIDE_PAGES_SQL}))`;
