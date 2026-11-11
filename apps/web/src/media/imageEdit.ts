import type { ImageEdit } from '@gp/core';

// A picture's edit drawn (MEDIA-R19, docs/media-and-files.md "Editing a picture"): from the original, straightened
// (zoomed in so no corner is empty), turned a quarter at a time, mirrored, and cut to the crop, as Photos on an iPhone.
// The crop is in fractions of the turned picture, so it keeps its place whatever size the picture is drawn at.

export const NO_EDIT: ImageEdit = { straighten: 0, rotate: 0, flip: false, crop: { x: 0, y: 0, w: 1, h: 1 } };

/** Whether `edit` leaves the picture as it is. */
export function isNoEdit(edit: ImageEdit): boolean {
  const c = edit.crop;
  return edit.straighten === 0 && edit.rotate === 0 && !edit.flip && c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

/** The size of a picture `w` × `h` turned by `rotate`. */
export function turnedSize(w: number, h: number, rotate: ImageEdit['rotate']): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h };
}

/** How much a picture `w` × `h`, turned `degrees` within its own frame, must grow so that no corner of the frame is empty. */
export function straightenScale(w: number, h: number, degrees: number): number {
  const a = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return Math.max((w * cos + h * sin) / w, (w * sin + h * cos) / h);
}

/** The edited picture's size in the original's pixels: the turned picture's, cut to the crop. */
export function editedSize(w: number, h: number, edit: ImageEdit): { width: number; height: number } {
  const t = turnedSize(w, h, edit.rotate);
  return { width: Math.max(1, Math.round(t.width * edit.crop.w)), height: Math.max(1, Math.round(t.height * edit.crop.h)) };
}

/**
 * Draws `source` (`w` × `h`, the original) edited by `edit` on `ctx`, filling `outW` × `outH`. With `whole`, the
 * whole turned and straightened picture is drawn, uncut, as the editor shows it under its crop frame.
 */
export function drawEdited(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
  edit: ImageEdit,
  outW: number,
  outH: number,
  whole = false,
) {
  const frame = turnedSize(w, h, edit.rotate);
  const crop = whole ? NO_EDIT.crop : edit.crop;
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  // The crop's part of the frame, filling the canvas.
  ctx.scale(outW / (frame.width * crop.w), outH / (frame.height * crop.h));
  ctx.translate(-frame.width * crop.x, -frame.height * crop.y);
  // The frame: straightened round its middle, grown to keep its corners, mirrored and turned as it is seen.
  ctx.translate(frame.width / 2, frame.height / 2);
  ctx.rotate((edit.straighten * Math.PI) / 180);
  const grow = straightenScale(frame.width, frame.height, edit.straighten);
  ctx.scale(grow * (edit.flip ? -1 : 1), grow);
  ctx.rotate((edit.rotate * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** A crop of `aspect` (width / height of the edited picture), as large as fits, in the middle of a frame `fw` × `fh`. */
export function cropOfAspect(aspect: number | null, fw: number, fh: number): ImageEdit['crop'] {
  if (!aspect) return { x: 0, y: 0, w: 1, h: 1 };
  const frame = fw / fh;
  if (aspect > frame) {
    const h = frame / aspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = aspect / frame;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** A stored edit, or none: one that does not read is treated as none. */
export function readEdit(json: string | null): ImageEdit {
  if (!json) return NO_EDIT;
  try {
    const e = JSON.parse(json) as ImageEdit;
    return e && typeof e.straighten === 'number' && e.crop ? e : NO_EDIT;
  } catch {
    return NO_EDIT;
  }
}
