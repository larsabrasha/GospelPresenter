// A picture fetched for MCP made as the app makes one it imports (apps/web/src/media/process.ts, MEDIA-R4): fitted
// within 1920×1080 and 400×225 without upscaling, a JPEG kept JPEG and a PNG or a WebP made WebP, which keeps its
// transparency; an SVG drawn as a PNG first, filling 1920×1080. Its size is read from its header before it is decoded,
// so a picture too large to hold is refused before it takes the memory.
import { fitWithin, IMAGE_VARIANTS, MutationError } from '@gp/core';
import type { PictureCodecs, SourceKind } from './picture-codecs.ts';

/** The most pixels decoded: a 16-megapixel photo, about 64 MB as RGBA, with room for its copies in a Worker's 128 MB. */
export const MAX_PIXELS = 4096 * 4096;

const at = (b: Uint8Array, i: number) => b[i] ?? 0;
const be16 = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1);
const le24 = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * Whether the bytes are an SVG: XML whose first element is `svg`, after a declaration, comments or a doctype. A web page
 * with an `svg` inside it is not one.
 */
function isSvg(b: Uint8Array) {
  const head = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^﻿/, '');
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head);
}

/** What kind of picture the bytes are, by their signature, whatever the address or the server said. */
export function sourceKind(b: Uint8Array): SourceKind | 'svg' | null {
  if (at(b, 0) === 0xff && at(b, 1) === 0xd8 && at(b, 2) === 0xff) return 'jpeg';
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (isSvg(b)) return 'svg';
  return null;
}

/**
 * An SVG drawn as a PNG filling the stage's size, never kept as SVG: one would be served from the app's own address,
 * where a script in it could run. Its transparency is kept, so a logo stands on a slide.
 */
async function drawn(bytes: Uint8Array, codecs: PictureCodecs): Promise<Uint8Array> {
  try {
    return await codecs.drawSvg(bytes, IMAGE_VARIANTS.full);
  } catch {
    throw new MutationError('invalid-image', 'the SVG does not read');
  }
}

/** A JPEG's size, from its first frame header (SOF0–SOF15, not DHT, JPG or DAC). */
function jpegSize(b: Uint8Array) {
  let i = 2;
  while (i + 9 < b.length) {
    if (at(b, i) !== 0xff) return null;
    const marker = at(b, i + 1);
    if (marker === 0xff) {
      i += 1; // a fill byte
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: be16(b, i + 7), height: be16(b, i + 5) };
    i += 2 + be16(b, i + 2);
  }
  return null;
}

/** A WebP's size, from its first chunk: lossy, lossless or extended. */
function webpSize(b: Uint8Array) {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ') return { width: (at(b, 26) | (at(b, 27) << 8)) & 0x3fff, height: (at(b, 28) | (at(b, 29) << 8)) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = le24(b, 21) | (at(b, 24) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  return null;
}

/** The picture's width and height as its header says, null when the header does not read. */
export function headerSize(kind: SourceKind, b: Uint8Array): { width: number; height: number } | null {
  const size = kind === 'jpeg' ? jpegSize(b) : kind === 'png' ? { width: (be16(b, 16) << 16) | be16(b, 18), height: (be16(b, 20) << 16) | be16(b, 22) } : webpSize(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

export interface MadePicture {
  type: 'image/jpeg' | 'image/webp';
  full: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
}

/** The two stored sizes of a picture; a file that is not one, or is too large to hold, is refused for the assistant to read. */
export async function makePicture(source: Uint8Array, codecs: PictureCodecs): Promise<MadePicture> {
  const found = sourceKind(source);
  if (!found) throw new MutationError('invalid-image', 'not a PNG, JPEG, WebP or SVG picture (a GIF or a web page is not read)');
  const bytes = found === 'svg' ? await drawn(source, codecs) : source;
  const kind = found === 'svg' ? 'png' : found;
  const size = headerSize(kind, bytes);
  if (!size) throw new MutationError('invalid-image', 'the picture does not read');
  if (size.width * size.height > MAX_PIXELS) throw new MutationError('too-large', `${size.width}×${size.height} pixels; at most ${MAX_PIXELS} in all`);
  let pixels: ImageData;
  try {
    pixels = await codecs.decode(kind, bytes);
  } catch {
    throw new MutationError('invalid-image', 'the picture does not read');
  }
  const type = kind === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const variant = async (v: { width: number; height: number; quality: number }) => {
    const fitted = fitWithin(pixels.width, pixels.height, v.width, v.height);
    const out = fitted.width === pixels.width && fitted.height === pixels.height ? pixels : await codecs.resize(pixels, fitted);
    return { bytes: await codecs.encode(type, out, v.quality), ...fitted };
  };
  const full = await variant(IMAGE_VARIANTS.full);
  const thumb = await variant(IMAGE_VARIANTS.thumb);
  return { type, full: full.bytes, thumb: thumb.bytes, width: full.width, height: full.height };
}
