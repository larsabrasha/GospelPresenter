// Whether a slideshow's pages, an overlay's page or a theme's definition read, as the Rust core checked them for the
// export zip's rows (ADR 0008; ported back from crates/gp-core/src/pages.rs and theme_def.rs, the schemas of
// custom-slides.ts and themes.ts written out by hand), and the blobs of their pictures in the order they name them.
// Lengths are counted in code points, as the Rust core counted them; a value is JSON as ordered.rs gave it (an
// infinity null).
import { type Json, isObject } from './files-json.ts';

class Unread extends Error {}
const no = (): never => {
  throw new Unread();
};
const obj = (v: unknown): Json => (isObject(v) ? v : no());
const chars = (t: string) => [...t].length;
const HASH = /^[0-9a-f]{64}$/;

const num = (o: Json, k: string, lo: number, hi: number) => (typeof o[k] === 'number' && (o[k] as number) >= lo && (o[k] as number) <= hi ? null : no());
const int = (o: Json, k: string, lo: number, hi: number) => (Number.isInteger(o[k]) ? num(o, k, lo, hi) : no());
const bool = (o: Json, k: string) => (typeof o[k] === 'boolean' ? null : no());
const oneOf = (o: Json, k: string, options: string[]) => (options.includes(o[k] as string) && typeof o[k] === 'string' ? null : no());
const color = (o: Json, k: string) => (o[k] === null || (typeof o[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(o[k])) ? null : no());
const has = (o: Json, k: string) => (Object.hasOwn(o, k) ? o[k] : no());

/** `pictureSchema`: a picture's two blobs. */
function picture(v: unknown, blobs: string[]): void {
  const o = obj(v);
  for (const k of ['full', 'thumb']) if (typeof o[k] !== 'string' || !HASH.test(o[k])) no();
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
    if (typeof o.text !== 'string' || chars(o.text) > 2000) no();
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
  if (!Array.isArray(o.elements) || o.elements.length > 100) no();
  for (const e of o.elements as unknown[]) element(e, blobs);
}

/** The blobs of a page (or of 1 to 100 pages, `many`) that reads, in order; null where it does not. */
export function pageBlobs(v: unknown, many: boolean): string[] | null {
  const blobs: string[] = [];
  try {
    if (!many) page(v, blobs);
    else if (!Array.isArray(v) || v.length < 1 || v.length > 100) no();
    else for (const p of v) page(p, blobs);
  } catch (e) {
    if (e instanceof Unread) return null;
    throw e;
  }
  return blobs;
}

/** `slideDeckPagesSchema` made a slideshow's pages (`pdfPages`): each the picture of its page on black; null where it does not read. */
export function pdfPages(v: unknown): unknown[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 100) return null;
  try {
    return v.map((p) => {
      picture(p, []);
      const o = p as Json;
      return { background: '#000000', backgroundPicture: null, backgroundPage: { full: o.full, thumb: o.thumb }, elements: [] };
    });
  } catch (e) {
    if (e instanceof Unread) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ a theme's definition

/** `cssColor`: 1–60 of `/^[#a-z0-9(),.%\s]+$/i`. */
const css = (o: Json, k: string) => (typeof o[k] === 'string' && chars(o[k]) <= 60 && /^[#a-zA-Z0-9(),.%\s]+$/.test(o[k]) ? null : no());

function textStyle(v: unknown): void {
  const o = obj(v);
  int(o, 'fontSize', 10, 300);
  if (typeof o.fontFamily !== 'string' || chars(o.fontFamily) > 200 || !/^[\w\s',-]+$/.test(o.fontFamily)) no();
  int(o, 'fontWeight', 100, 900);
  num(o, 'lineHeight', 0.8, 3);
  css(o, 'color');
  oneOf(o, 'align', ['left', 'center', 'right']);
  bool(o, 'shadow');
  bool(o, 'uppercase');
  int(o, 'outline', 0, 20);
  css(o, 'outlineColor');
  const area = obj(o.area);
  for (const [k, lo, hi] of [['x', 0, 1880], ['y', 0, 1040], ['w', 40, 1920], ['h', 40, 1080]] as const) int(area, k, lo, hi);
  oneOf(o, 'valign', ['top', 'middle', 'bottom']);
}

function background(v: unknown, blobs: string[]): void {
  const o = obj(v);
  const image = has(o, 'image');
  if (image !== null) {
    const i = obj(image);
    if (i.kind === 'builtIn') {
      if (typeof i.asset !== 'string' || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(i.asset)) no();
    } else if (i.kind === 'picture') picture(i, blobs);
    else no();
  }
  css(o, 'color');
  oneOf(o, 'fit', ['cover', 'contain']);
  int(o, 'scrim', 0, 100);
}

/** `themeDefinitionSchema`'s blobs (`themeBlobs`): the song's background, the Bible's, media's; null where it does not read. */
export function themeBlobs(v: unknown): string[] | null {
  const blobs: string[] = [];
  try {
    const o = obj(v);
    for (const k of ['song', 'bible']) {
      const style = obj(o[k]);
      background(style.background, blobs);
      textStyle(style.main);
      textStyle(style.credits);
    }
    background(o.media, blobs);
  } catch (e) {
    if (e instanceof Unread) return null;
    throw e;
  }
  return blobs;
}
