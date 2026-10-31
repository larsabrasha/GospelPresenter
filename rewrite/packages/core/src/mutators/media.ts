import { count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { MEDIA_LIMITS } from '../media.ts';
import { audios, images, mediaBlobs, presentationItems, videos } from '../schema.ts';
import { VIDEO_CODECS, VIDEO_LIMITS, VIDEO_TYPES } from '../video.ts';
import { imageItemIds, MAX_ITEM_IMAGES, MAX_SLIDE_PAGES, type SlidesItemContent } from '../slides.ts';
import { id, limit, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { insertItem, changePresentation } from './presentations.ts';

// ------------------------------------------------------------------ images (spec 05 "Media")

const mediaHash = z.string().regex(/^[0-9a-f]{64}$/);

export const addImageArgs = z.object({
  id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  contentType: z.enum(['image/jpeg', 'image/webp']),
  /** The two blobs, uploaded first (`PUT /media/{hash}`) and recorded in `media_blobs` where this runs. */
  fullHash: mediaHash,
  thumbHash: mediaHash,
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1080),
  createdAt: z.number().int(),
});
/**
 * Adds a picture to the library (MEDIA-R3, R6). Both blobs must be known
 * where this runs: on the server the uploads recorded them, on the importing
 * device the import did. Bytes first, then the row, so a refused add leaves
 * only blobs a clean-up removes. At most 1 000 pictures, the trash not counted.
 */
export async function addImage(tx: Tx, a: z.output<typeof addImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  const [existing] = await tx.select({ id: images.id }).from(images).where(eq(images.id, a.id));
  if (existing) return; // a replay of an add that already landed
  for (const hash of new Set([a.fullHash, a.thumbHash])) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a picture has not been uploaded');
  }
  const [n] = await tx.select({ n: count() }).from(images).where(isNull(images.deletedAt));
  limit((n?.n ?? 0) >= MEDIA_LIMITS.images, 'images');
  await tx.insert(images).values({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    fullHash: a.fullHash,
    thumbHash: a.thumbHash,
    width: a.width,
    height: a.height,
    createdAt: a.createdAt,
    deletedAt: null,
  });
}

export const trashImageArgs = z.object({ id, at: z.number().int() });
/** Soft delete (MEDIA-R8): still served, so presentations that use it keep working. */
export async function trashImage(tx: Tx, a: z.output<typeof trashImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  await tx.update(images).set({ deletedAt: a.at }).where(eq(images.id, a.id));
}

export const restoreImageArgs = z.object({ id });
/** Restoring may exceed the maximum (MEDIA-R8). */
export async function restoreImage(tx: Tx, a: z.output<typeof restoreImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  await tx.update(images).set({ deletedAt: null }).where(eq(images.id, a.id));
}

export const purgeImageArgs = z.object({ id });
/** Permanent delete: only of an image in the trash where this runs. Its blobs go with the next clean-up. */
export async function purgeImage(tx: Tx, a: z.output<typeof purgeImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageImages');
  const [i] = await tx.select({ deletedAt: images.deletedAt }).from(images).where(eq(images.id, a.id));
  if (!i) return;
  if (i.deletedAt === null) throw new MutationError('not-in-trash', 'image is not in the trash');
  await tx.delete(images).where(eq(images.id, a.id));
}

const imageIds = z.array(id).min(1).max(MAX_ITEM_IMAGES);

export const addImageToPresentationArgs = z.object({
  itemId: id,
  presentationId: id,
  /** The pictures, in order: one slide each (Presentation.razor's AddImages). */
  imageIds: imageIds.optional(),
  /** One picture, as clients before several could be picked sent it. */
  imageId: id.optional(),
  /** "N bilder" for several, sent by the client in its language; one picture is titled by its file name. */
  title: z.string().trim().min(1).max(200).optional(),
  afterItemId: id.nullable().optional(),
});
/**
 * Adds library pictures as one item, a slide each. Like a song it is a reference, so a trashed
 * picture still shows (MEDIA-R8) and a purged one leaves the item without it. One picture is
 * titled by its file name at add time.
 */
export async function addImageToPresentation(tx: Tx, a: z.output<typeof addImageToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewImages');
  const ids = a.imageIds ?? (a.imageId ? [a.imageId] : []);
  if (!ids.length) throw new MutationError('invalid', 'no images');
  await changePresentation(tx, a.presentationId, ctx);
  const [first] = await tx.select({ fileName: images.fileName }).from(images).where(eq(images.id, ids[0]!));
  if (!first) throw new MutationError('not-found', 'image not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'image',
    title: ids.length === 1 ? first.fileName : (a.title ?? `${ids.length}`),
    sourceId: ids[0]!,
    arrangementId: null,
    content: ids.length === 1 ? null : JSON.stringify({ images: ids }),
  });
}

/** An image item, by id, with its pictures; null when it is gone or not an image item. */
async function imageItem(tx: Tx, itemId: string, ctx: MutatorCtx) {
  const [item] = await tx
    .select({ presentationId: presentationItems.presentationId, type: presentationItems.type, sourceId: presentationItems.sourceId, content: presentationItems.content })
    .from(presentationItems)
    .where(eq(presentationItems.id, itemId));
  if (!item || item.type !== 'image') return null;
  await changePresentation(tx, item.presentationId, ctx);
  return { ...item, ids: imageItemIds(item) };
}

/** Writes an image item's pictures; none left removes the item (Presentation.razor's RemoveImagePart). */
async function setItemImages(tx: Tx, itemId: string, ids: string[]) {
  if (!ids.length) {
    await tx.delete(presentationItems).where(eq(presentationItems.id, itemId));
    return;
  }
  await tx
    .update(presentationItems)
    .set({ sourceId: ids[0]!, content: ids.length === 1 ? null : JSON.stringify({ images: ids }) })
    .where(eq(presentationItems.id, itemId));
}

export const addImagesToItemArgs = z.object({ itemId: id, imageIds });
/** "Lägg till bilder" on an image item: the pictures go last. */
export async function addImagesToItem(tx: Tx, a: z.output<typeof addImagesToItemArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewImages');
  const item = await imageItem(tx, a.itemId, ctx);
  if (!item) return;
  limit(item.ids.length + a.imageIds.length > MAX_ITEM_IMAGES, 'images');
  await setItemImages(tx, a.itemId, [...item.ids, ...a.imageIds]);
}

export const removeItemImageArgs = z.object({ itemId: id, index: z.number().int().min(0) });
/** Removes one picture of an image item; the last one takes the item with it. */
export async function removeItemImage(tx: Tx, a: z.output<typeof removeItemImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const item = await imageItem(tx, a.itemId, ctx);
  if (!item || a.index >= item.ids.length) return;
  await setItemImages(tx, a.itemId, item.ids.filter((_, i) => i !== a.index));
}

export const moveItemImageArgs = z.object({ itemId: id, from: z.number().int().min(0), to: z.number().int().min(0) });
/** Moves one picture of an image item to another place (the drag in Redigera). */
export async function moveItemImage(tx: Tx, a: z.output<typeof moveItemImageArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  const item = await imageItem(tx, a.itemId, ctx);
  if (!item || a.from >= item.ids.length || a.to >= item.ids.length || a.from === a.to) return;
  const ids = [...item.ids];
  const [moved] = ids.splice(a.from, 1);
  ids.splice(a.to, 0, moved!);
  await setItemImages(tx, a.itemId, ids);
}

// ------------------------------------------------------------------ audio (spec 05 "Media")

export const addAudioArgs = z.object({
  id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  /** As the server recognised it when the file was uploaded. */
  contentType: z.enum(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/x-m4a']),
  hash: mediaHash,
  size: z.number().int().min(1).max(MEDIA_LIMITS.audioBytes),
  createdAt: z.number().int(),
});
/** Adds an audio file (MEDIA-R3, R5): its blob must be known where this runs. At most 500, the trash not counted. */
export async function addAudio(tx: Tx, a: z.output<typeof addAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  const [existing] = await tx.select({ id: audios.id }).from(audios).where(eq(audios.id, a.id));
  if (existing) return;
  const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, a.hash));
  if (!blob) throw new MutationError('media-missing', 'the audio file has not been uploaded');
  const [n] = await tx.select({ n: count() }).from(audios).where(isNull(audios.deletedAt));
  limit((n?.n ?? 0) >= MEDIA_LIMITS.audios, 'audio files');
  await tx.insert(audios).values({ id: a.id, fileName: a.fileName, contentType: a.contentType, hash: a.hash, size: a.size, createdAt: a.createdAt, deletedAt: null });
}

export const trashAudioArgs = z.object({ id, at: z.number().int() });
export async function trashAudio(tx: Tx, a: z.output<typeof trashAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  await tx.update(audios).set({ deletedAt: a.at }).where(eq(audios.id, a.id));
}

export const restoreAudioArgs = z.object({ id });
export async function restoreAudio(tx: Tx, a: z.output<typeof restoreAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  await tx.update(audios).set({ deletedAt: null }).where(eq(audios.id, a.id));
}

export const purgeAudioArgs = z.object({ id });
/** Permanent delete: only of a file in the trash where this runs. Its blob goes with the next clean-up. */
export async function purgeAudio(tx: Tx, a: z.output<typeof purgeAudioArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageAudios');
  const [f] = await tx.select({ deletedAt: audios.deletedAt }).from(audios).where(eq(audios.id, a.id));
  if (!f) return;
  if (f.deletedAt === null) throw new MutationError('not-in-trash', 'audio file is not in the trash');
  await tx.delete(audios).where(eq(audios.id, a.id));
}

export const addAudioToPresentationArgs = z.object({ itemId: id, presentationId: id, audioId: id, afterItemId: id.nullable().optional() });
/**
 * Adds an audio file as an item (spec 03): it has no slides, and selecting it
 * live plays it on the presenting computer without changing what is shown
 * (LIVE-R6). A reference, like a picture: a trashed file still plays.
 */
export async function addAudioToPresentation(tx: Tx, a: z.output<typeof addAudioToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewAudios');
  await changePresentation(tx, a.presentationId, ctx);
  const [f] = await tx.select({ fileName: audios.fileName }).from(audios).where(eq(audios.id, a.audioId));
  if (!f) throw new MutationError('not-found', 'audio file not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'audio',
    title: f.fileName,
    sourceId: a.audioId,
    arrangementId: null,
    content: null,
  });
}

// ------------------------------------------------------------------ video (TODO.md "Video")

export const addVideoArgs = z.object({
  id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  /** As the server read it from the file when the upload was finished. */
  contentType: z.enum(VIDEO_TYPES),
  codec: z.enum(VIDEO_CODECS),
  /** The video, uploaded in parts first (`/api/media/{hash}/upload`). */
  hash: mediaHash,
  size: z.number().int().min(1).max(VIDEO_LIMITS.bytes),
  /** Milliseconds; up to a day. */
  duration: z.number().int().min(0).max(24 * 3600 * 1000),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
  /** The still from its start, in a picture's two sizes, uploaded as pictures' are. */
  stillHash: mediaHash,
  thumbHash: mediaHash,
  createdAt: z.number().int(),
});
/**
 * Adds a video to the library. Its three blobs must be known where this runs:
 * the video on the server once its upload was finished (a device records it
 * without its bytes, as it never keeps a video), the still where it was
 * stored. At most 500, the trash not counted.
 */
export async function addVideo(tx: Tx, a: z.output<typeof addVideoArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageVideos');
  const [existing] = await tx.select({ id: videos.id }).from(videos).where(eq(videos.id, a.id));
  if (existing) return;
  for (const hash of new Set([a.hash, a.stillHash, a.thumbHash])) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'the video or its still has not been uploaded');
  }
  const [n] = await tx.select({ n: count() }).from(videos).where(isNull(videos.deletedAt));
  limit((n?.n ?? 0) >= VIDEO_LIMITS.videos, 'videos');
  await tx.insert(videos).values({ ...a, deletedAt: null });
}

export const trashVideoArgs = z.object({ id, at: z.number().int() });
/** Soft delete (MEDIA-R8): it still plays where a presentation uses it. */
export async function trashVideo(tx: Tx, a: z.output<typeof trashVideoArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageVideos');
  await tx.update(videos).set({ deletedAt: a.at }).where(eq(videos.id, a.id));
}

export const restoreVideoArgs = z.object({ id });
export async function restoreVideo(tx: Tx, a: z.output<typeof restoreVideoArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageVideos');
  await tx.update(videos).set({ deletedAt: null }).where(eq(videos.id, a.id));
}

export const purgeVideoArgs = z.object({ id });
/** Permanent delete: only of a video in the trash where this runs. Its blobs go with the next clean-up. */
export async function purgeVideo(tx: Tx, a: z.output<typeof purgeVideoArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageVideos');
  const [v] = await tx.select({ deletedAt: videos.deletedAt }).from(videos).where(eq(videos.id, a.id));
  if (!v) return;
  if (v.deletedAt === null) throw new MutationError('not-in-trash', 'video is not in the trash');
  await tx.delete(videos).where(eq(videos.id, a.id));
}

export const addVideoToPresentationArgs = z.object({ itemId: id, presentationId: id, videoId: id, afterItemId: id.nullable().optional() });
/**
 * Adds a video as an item: one slide, whose picture goes to the outputs and
 * whose sound plays on the presenting computer (LIVE-R6, as an audio item's).
 * A reference, like a picture: a trashed video still plays.
 */
export async function addVideoToPresentation(tx: Tx, a: z.output<typeof addVideoToPresentationArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewVideos');
  await changePresentation(tx, a.presentationId, ctx);
  const [v] = await tx.select({ fileName: videos.fileName }).from(videos).where(eq(videos.id, a.videoId));
  if (!v) throw new MutationError('not-found', 'video not found');
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'video',
    title: v.fileName,
    sourceId: a.videoId,
    arrangementId: null,
    content: null,
  });
}

// ------------------------------------------------------------------ slide decks (PRES-R11, D29)

export const addSlidesArgs = z.object({
  itemId: id,
  presentationId: id,
  fileName: z.string().trim().min(1).max(MEDIA_LIMITS.fileName),
  /** Each page's two pictures, uploaded first (`PUT /media/{hash}`) and recorded in `media_blobs` where this runs. */
  pages: z.array(z.object({ full: mediaHash, thumb: mediaHash })).min(1).max(MAX_SLIDE_PAGES),
  afterItemId: id.nullable().optional(),
});
/**
 * Adds a slide deck as an item: one slide per page, each a picture rendered
 * once at import (D29). A snapshot like a Bible item, kept in `content`; no
 * deck table, so `sourceId` is the item's own id. Every blob must be known
 * where this runs, as for `addImage`. The title is the file name (PRES-R11).
 */
export async function addSlides(tx: Tx, a: z.output<typeof addSlidesArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  await changePresentation(tx, a.presentationId, ctx);
  for (const hash of new Set(a.pages.flatMap((p) => [p.full, p.thumb]))) {
    const [blob] = await tx.select({ hash: mediaBlobs.hash }).from(mediaBlobs).where(eq(mediaBlobs.hash, hash));
    if (!blob) throw new MutationError('media-missing', 'a page has not been uploaded');
  }
  const content: SlidesItemContent = { fileName: a.fileName, pages: a.pages.map((p) => ({ full: p.full, thumb: p.thumb })) };
  await insertItem(tx, a.afterItemId, {
    id: a.itemId,
    presentationId: a.presentationId,
    type: 'slides',
    title: a.fileName,
    sourceId: a.itemId,
    arrangementId: null,
    content: JSON.stringify(content),
  });
}
