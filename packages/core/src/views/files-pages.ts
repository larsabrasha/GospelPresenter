// Whether a slideshow's pages, an overlay's page or a theme's definition read, as the Rust core checked them for the
// export zip's rows (ADR 0008; ported back from crates/gp-core/src/pages.rs and theme_def.rs), and the blobs of their
// pictures in the order they name them. The pages are custom-slides.ts's schemas written out by hand, their lengths
// counted in code points, as the Rust core counted them; a theme's is themes.ts's schema itself (its texts are of
// the BMP alone, so the two counts agree). A value is JSON as ordered.rs gave it (an infinity null).
import { CUSTOM_LIMITS } from '../custom-slides.ts';
import { MEDIA_HASH } from '../media.ts';
import { themeDefinitionSchema, themeBlobs as definitionBlobs } from '../themes.ts';
import { type Json, isObject } from './files-json.ts';

class Unread extends Error {}
const no = (): never => {
  throw new Unread();
};
const obj = (v: unknown): Json => (isObject(v) ? v : no());
const chars = (t: string) => [...t].length;

const num = (o: Json, k: string, lo: number, hi: number) => (typeof o[k] === 'number' && (o[k] as number) >= lo && (o[k] as number) <= hi ? null : no());
const int = (o: Json, k: string, lo: number, hi: number) => (Number.isInteger(o[k]) ? num(o, k, lo, hi) : no());
const bool = (o: Json, k: string) => (typeof o[k] === 'boolean' ? null : no());
const oneOf = (o: Json, k: string, options: string[]) => (options.includes(o[k] as string) && typeof o[k] === 'string' ? null : no());
const color = (o: Json, k: string) => (o[k] === null || (typeof o[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(o[k])) ? null : no());
const has = (o: Json, k: string) => (Object.hasOwn(o, k) ? o[k] : no());

/** `pictureSchema`: a picture's two blobs. */
function picture(v: unknown, blobs: string[]): void {
  const o = obj(v);
  for (const k of ['full', 'thumb']) if (typeof o[k] !== 'string' || !MEDIA_HASH.test(o[k])) no();
  blobs.push(o.full as string, o.thumb as string);
}

/** An element: its box, then its kind's fields. */
function element(v: unknown, blobs: string[]): void {
  const o = obj(v);
  const kind = o.kind;
  if (kind !== 'text' && kind !== 'image' && kind !== 'rect' && kind !== 'ellipse' && kind !== 'line') no();
  if (typeof o.id !== 'string' || chars(o.id) < 1 || chars(o.id) > 40) no();
  for (const [k, size] of [['x', 1920], ['y', 1080], ['w', 1920], ['h', 1080]] as const) num(o, k, -2 * size, 3 * size);
  if (kind === 'text') {
    if (typeof o.text !== 'string' || chars(o.text) > CUSTOM_LIMITS.text) no();
    int(o, 'size', 10, 400);
    bool(o, 'bold');
    bool(o, 'italic');
    oneOf(o, 'align', ['left', 'center', 'right']);
    color(o, 'color');
  } else if (kind === 'image') {
    picture(has(o, 'picture'), blobs);
    oneOf(o, 'fit', ['contain', 'cover']);
  } else if (kind === 'line') {
    color(o, 'stroke');
    num(o, 'strokeWidth', 1, 100);
  } else {
    color(o, 'fill');
    color(o, 'stroke');
    num(o, 'strokeWidth', 0, 100);
    num(o, 'radius', 0, 540);
  }
}

/** `customPageSchema`: a page, and the blobs of every picture it draws. */
function page(v: unknown, blobs: string[]): void {
  const o = obj(v);
  color(o, 'background');
  for (const k of ['backgroundPicture', 'backgroundPage']) if (has(o, k) !== null) picture(o[k], blobs);
  if (!Array.isArray(o.elements) || o.elements.length > CUSTOM_LIMITS.elements) no();
  for (const e of o.elements as unknown[]) element(e, blobs);
}

/** The blobs of a page (or of 1 to 100 pages, `many`) that reads, in order; null where it does not. */
export function pageBlobs(v: unknown, many: boolean): string[] | null {
  const blobs: string[] = [];
  try {
    if (!many) page(v, blobs);
    else if (!Array.isArray(v) || v.length < 1 || v.length > CUSTOM_LIMITS.pages) no();
    else for (const p of v) page(p, blobs);
  } catch (e) {
    if (e instanceof Unread) return null;
    throw e;
  }
  return blobs;
}

// ------------------------------------------------------------------ a theme's definition

/** `themeDefinitionSchema`'s blobs (themes.ts `themeBlobs`): the song's background, the Bible's, media's; null where it does not read. */
export function themeBlobs(v: unknown): string[] | null {
  const read = themeDefinitionSchema.safeParse(v);
  return read.success ? definitionBlobs(read.data) : null;
}
