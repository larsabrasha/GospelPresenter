import { createHash } from 'node:crypto';
import { IMAGE_VARIANTS, MEDIA_LIMITS, sniffAudio, sniffStoredImage, type SlidePage, type StoredImageType } from '@gp/core';
import sharp from 'sharp';
import type { OldData } from './old-db.ts';

// 1.x's files, from its object storage (Garage) to blobs named by their SHA-256 (docs/media-and-files.md,
// "Media"). A library picture keeps its two stored sizes when they are a type and size 2.0 stores; anything
// else is made again with sharp, as the web app makes a picked one (MEDIA-R4: JPEG stays JPEG, the rest is WebP).

/** Where 1.x's objects are read from, by their key (`ImageUrlHelper`). Null for a key that is not there. */
export interface ObjectStore {
  get(key: string): Promise<Uint8Array | null>;
}

/** Where the blobs go: once per hash, however many rows name it. */
export type BlobSink = (hash: string, bytes: Uint8Array) => Promise<void>;

export interface StoredImage {
  fullHash: string;
  thumbHash: string;
  width: number;
  height: number;
  contentType: StoredImageType;
}

export interface Media {
  /** By 1.x's image id. */
  images: Map<string, StoredImage>;
  /** By 1.x's audio id. */
  audios: Map<string, { hash: string; size: number; contentType: string }>;
  /** An overlay's own picture, by the overlay's id: it becomes a library picture. */
  overlayImages: Map<string, StoredImage>;
  /** A slide deck's pages, by the deck's id and the page's number. */
  decks: Map<string, Map<number, SlidePage>>;
  /** The objects that were not there or not usable, with why. */
  problems: string[];
}

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function variant(input: Uint8Array, type: StoredImageType, size: { width: number; height: number; quality: number }) {
  const resized = sharp(input).rotate().resize({ width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true });
  const quality = Math.round(size.quality * 100);
  const { data, info } = await (type === 'image/jpeg' ? resized.jpeg({ quality }) : resized.webp({ quality })).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}

/** Whether `bytes` are `type` and fit `size`, so they can be kept as they are. */
async function keeps(bytes: Uint8Array | null, type: StoredImageType, size: { width: number; height: number }): Promise<Uint8Array | null> {
  if (!bytes || sniffStoredImage(bytes) !== type || bytes.length > MEDIA_LIMITS.blobBytes) return null;
  const m = await sharp(bytes).metadata();
  return m.width && m.height && m.width <= size.width && m.height <= size.height ? bytes : null;
}

/** A picture in the two sizes 2.0 stores, keeping 1.x's bytes where they already are that. */
async function storeImage(full: Uint8Array, thumb: Uint8Array | null, sink: BlobSink): Promise<StoredImage> {
  const type: StoredImageType = sniffStoredImage(full) === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const keptFull = await keeps(full, type, IMAGE_VARIANTS.full);
  const f = keptFull ? { bytes: keptFull, ...(await sharp(keptFull).metadata()) } : await variant(full, type, IMAGE_VARIANTS.full);
  const t = (await keeps(thumb, type, IMAGE_VARIANTS.thumb)) ?? (await variant(f.bytes, type, IMAGE_VARIANTS.thumb)).bytes;
  const fullHash = sha256Hex(f.bytes);
  const thumbHash = sha256Hex(t);
  await sink(fullHash, f.bytes);
  await sink(thumbHash, t);
  return { fullHash, thumbHash, width: f.width!, height: f.height!, contentType: type };
}

/** A picture as `storeImage` stores it, or the reason it cannot be: a file sharp cannot read is reported, not fatal. */
async function tryStore(what: string, full: Uint8Array, thumb: Uint8Array | null, sink: BlobSink, problems: string[]): Promise<StoredImage | null> {
  try {
    return await storeImage(full, thumb, sink);
  } catch (e) {
    problems.push(`${what}: not a picture that can be read (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/** Every file the organisation's rows name, read once each; `progress` is told after each object. */
export async function collectMedia(data: OldData, store: ObjectStore, sink: BlobSink, progress: (done: number, total: number) => void = () => {}): Promise<Media> {
  const org = data.org.Id;
  const media: Media = { images: new Map(), audios: new Map(), overlayImages: new Map(), decks: new Map(), problems: [] };
  const slideItems = data.items.filter((i) => i.Type === 4 && i.SourceId);
  const pagesOf = new Map<string, Set<number>>();
  const partsByItem = new Map<string, string[]>();
  for (const p of data.itemParts) (partsByItem.get(p.PresentationItemId) ?? partsByItem.set(p.PresentationItemId, []).get(p.PresentationItemId)!).push(p.Content);
  for (const i of slideItems) {
    const pages = pagesOf.get(i.SourceId!) ?? pagesOf.set(i.SourceId!, new Set()).get(i.SourceId!)!;
    for (const p of partsByItem.get(i.Id) ?? []) if (/^\d+$/.test(p)) pages.add(Number(p));
  }
  const overlays = data.overlays.filter((o) => o.HasImage);
  const total = data.images.length + data.audios.length + overlays.length + [...pagesOf.values()].reduce((n, s) => n + s.size, 0);
  let done = 0;
  const step = () => progress(++done, total);

  for (const image of data.images) {
    const full = await store.get(`org/${org}/images/${image.Id}/full`);
    const stored = full && (await tryStore(`picture ${image.FileName}`, full, await store.get(`org/${org}/images/${image.Id}/thumb`), sink, media.problems));
    if (!full) media.problems.push(`picture ${image.FileName}: no file`);
    else if (stored) media.images.set(image.Id, stored);
    step();
  }
  for (const audio of data.audios) {
    const bytes = await store.get(`org/${org}/audios/${audio.Id}/file`);
    const type = bytes && sniffAudio(bytes);
    if (!bytes) media.problems.push(`sound ${audio.FileName}: no file`);
    else if (!type) media.problems.push(`sound ${audio.FileName}: not a sound 2.0 plays`);
    else if (bytes.length > MEDIA_LIMITS.audioBytes) media.problems.push(`sound ${audio.FileName}: over 20 MB`);
    else {
      const hash = sha256Hex(bytes);
      await sink(hash, bytes);
      media.audios.set(audio.Id, { hash, size: bytes.length, contentType: type });
    }
    step();
  }
  for (const overlay of overlays) {
    const bytes = await store.get(`org/${org}/overlays/${overlay.Id}/image`);
    const stored = bytes && (await tryStore(`overlay ${overlay.Title}`, bytes, null, sink, media.problems));
    if (!bytes) media.problems.push(`overlay ${overlay.Title}: no picture`);
    else if (stored) media.overlayImages.set(overlay.Id, stored);
    step();
  }
  for (const [deckId, pages] of pagesOf) {
    const kept = new Map<number, SlidePage>();
    for (const page of [...pages].toSorted((a, b) => a - b)) {
      const bytes = await store.get(`org/${org}/slides/${deckId}/page-${page}.webp`);
      const stored = bytes && (await tryStore(`slide deck ${deckId}, page ${page}`, bytes, null, sink, media.problems));
      if (!bytes) media.problems.push(`slide deck ${deckId}: no page ${page}`);
      else if (stored) kept.set(page, { full: stored.fullHash, thumb: stored.thumbHash });
      step();
    }
    media.decks.set(deckId, kept);
  }
  return media;
}
