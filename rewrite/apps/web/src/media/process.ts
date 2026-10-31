import { fitWithin, IMAGE_VARIANTS, imageTypeFromName, MEDIA_LIMITS, PICKABLE_IMAGE_TYPES, storedTypeFor, type PickableImageType, type StoredImageType } from '@gp/core';
import type { ImageImport } from '../db/protocol.ts';

// The client's half of the image pipeline (spec 05 MEDIA-R4, ADR 0007
// decision 9: clients compress before upload). The browser decodes, fits the
// picture within 1920×1080 and 400×225 without upscaling, and re-encodes it:
// JPEG stays JPEG, PNG, WebP and GIF become WebP. Re-encoding also drops
// metadata such as the camera's GPS position, and a GIF keeps its first frame.

/** Why a file was not imported; the page counts these (MEDIA-A5). */
export type ImageProblem = 'type' | 'size' | 'name' | 'invalid';

export class ImageRefused extends Error {
  constructor(readonly problem: ImageProblem) {
    super(problem);
  }
}

/** The type a picked file has: what the browser reports, else its extension (MEDIA-R1, R13). */
function pickedType(file: File): PickableImageType | null {
  const reported = PICKABLE_IMAGE_TYPES.find((t) => t === file.type);
  return reported ?? (file.type === '' ? imageTypeFromName(file.name) : null);
}

/** The checks that need no decoding: type, size and name (MEDIA-R2). */
export function checkPicked(file: Pick<File, 'type' | 'size' | 'name'>): PickableImageType {
  const type = pickedType(file as File);
  if (!type) throw new ImageRefused('type');
  if (file.size > MEDIA_LIMITS.sourceBytes || file.size === 0) throw new ImageRefused('size');
  if (file.name.length > MEDIA_LIMITS.fileName) throw new ImageRefused('name');
  return type;
}

type Surface = OffscreenCanvas | HTMLCanvasElement;

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function encode(canvas: Surface, type: StoredImageType, quality: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

/** Draws the picture (a bitmap, or a video's frame) at the size and encodes it; the blob's type may differ from `type` if the browser cannot encode it. */
export async function render(bitmap: CanvasImageSource, size: { width: number; height: number }, type: StoredImageType, quality: number): Promise<Blob> {
  const canvas = surface(size.width, size.height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no canvas');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return encode(canvas, type, quality);
}

/**
 * Validates, decodes and re-encodes a picked file as the two stored sizes. A
 * browser that cannot encode WebP (Safari's canvas answers PNG) gets JPEG on
 * white instead, for the whole picture, so its two blobs have one type.
 */
export async function processImage(file: File, id: string): Promise<ImageImport> {
  const picked = checkPicked(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageRefused('invalid'); // not a picture, whatever its name says (MEDIA-A6)
  }
  try {
    const full = fitWithin(bitmap.width, bitmap.height, IMAGE_VARIANTS.full.width, IMAGE_VARIANTS.full.height);
    const thumb = fitWithin(bitmap.width, bitmap.height, IMAGE_VARIANTS.thumb.width, IMAGE_VARIANTS.thumb.height);
    let type = storedTypeFor(picked);
    let fullBlob = await render(bitmap, full, type, IMAGE_VARIANTS.full.quality);
    if (fullBlob.type !== type) {
      type = 'image/jpeg';
      fullBlob = await render(bitmap, full, type, IMAGE_VARIANTS.full.quality);
    }
    const thumbBlob = await render(bitmap, thumb, type, IMAGE_VARIANTS.thumb.quality);
    return {
      id,
      fileName: file.name,
      contentType: type,
      width: full.width,
      height: full.height,
      full: new Uint8Array(await fullBlob.arrayBuffer()),
      thumb: new Uint8Array(await thumbBlob.arrayBuffer()),
    };
  } finally {
    bitmap.close();
  }
}
