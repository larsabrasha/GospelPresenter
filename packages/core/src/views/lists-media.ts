// The libraries (apps/web's Bilder, Ljud, Video, Bildspel and Overlays, and the add dialog's tabs): pictures, sounds,
// videos, slideshows and overlays, as the web's reads gave them (ported back from crates/gp-core/src/media_views.rs).
import { blankPage, CUSTOM_LIMITS } from '../custom-slides.ts';
import { MEDIA_HASH } from '../media.ts';
import type { RunSql } from './sql.ts';
import { type Args, type Fields, mapRow, readJson, select } from './lists-rows.ts';
import { argsOf, idOf, isObj } from './serde.ts';

/** `LibraryImage`, its content type read as the web reads it. */
export const IMAGE: Fields = [['id', 'str'], ['fileName', 'str'], ['contentType', 'opt'], ['fullHash', 'str'], ['thumbHash', 'str'], ['width', 'num'],
  ['height', 'num'], ['createdAt', 'num'], ['deletedAt', 'opt'], ['originalFullHash', 'opt'], ['originalThumbHash', 'opt'], ['originalWidth', 'opt'],
  ['originalHeight', 'opt'], ['edit', 'opt']];
export const VIDEO: Fields = [['id', 'str'], ['fileName', 'str'], ['contentType', 'opt'], ['codec', 'opt'], ['hash', 'str'], ['size', 'num'], ['duration', 'num'],
  ['width', 'num'], ['height', 'num'], ['stillHash', 'str'], ['thumbHash', 'str'], ['createdAt', 'num'], ['deletedAt', 'opt']];
/** `LibraryAudio`. */
export const AUDIO: Fields = [['id', 'str'], ['fileName', 'str'], ['contentType', 'str'], ['hash', 'str'], ['size', 'num'], ['createdAt', 'num'], ['deletedAt', 'opt']];
/** `Overlay`, but its `imageId`, always null. */
const OVERLAY: Fields = [['id', 'str'], ['title', 'str'], ['content', 'opt'], ['sort', 'num'], ['updatedAt', 'opt']];
const CUSTOM: Fields = [['id', 'str'], ['name', 'str'], ['pages', 'opt'], ['createdAt', 'num'], ['updatedAt', 'num'], ['deletedAt', 'opt']];

/** `libraryImage`. */
export const imageRow = (v: Args): Args => ({ ...v, contentType: v.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp' });
/** `libraryVideo`. */
export const videoRow = (v: Args): Args => ({ ...v, contentType: v.contentType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4', codec: v.codec === 'hevc' ? 'hevc' : 'h264' });
const overlayRow = (o: Args): Args => ({ ...o, imageId: null });

/** The rows of `fields` from `table`, without the trash, newest first (MEDIA-R7). */
const newest = (sql: RunSql, fields: Fields, table: string) => select(sql, fields, `${table} WHERE deleted_at IS NULL ORDER BY created_at DESC, id`);

/** `imagesView`: the pictures (`listImages`). */
export const imagesView = async (args: unknown, sql: RunSql) => (argsOf(args), (await newest(sql, IMAGE, 'images')).map(imageRow));
/** `audiosView`: the sounds (`listAudios`). */
export const audiosView = async (args: unknown, sql: RunSql) => (argsOf(args), newest(sql, AUDIO, 'audios'));
/** `videosView`: the videos (`listVideos`). */
export const videosView = async (args: unknown, sql: RunSql) => (argsOf(args), (await newest(sql, VIDEO, 'videos')).map(videoRow));

// ------------------------------------------------------------------ a slideshow's pages (pages.rs)

/** A page's reading failed: the slideshow shows one blank page. */
export class Unread extends Error {}
const fail = (): never => {
  throw new Unread();
};
const obj = (v: unknown) => (isObj(v) ? v : fail());
const num = (o: Args, k: string, lo: number, hi: number) => (typeof o[k] === 'number' && o[k] >= lo && o[k] <= hi ? o[k] : fail());
const int = (o: Args, k: string, lo: number, hi: number) => (Number.isInteger(o[k]) ? num(o, k, lo, hi) : fail());
const bool = (o: Args, k: string) => (typeof o[k] === 'boolean' ? o[k] : fail());
const oneOf = (o: Args, k: string, options: string[]) => (typeof o[k] === 'string' && options.includes(o[k]) ? o[k] : fail());
const color = (o: Args, k: string) => (o[k] === null ? null : typeof o[k] === 'string' && /^#[0-9a-f]{6}$/i.test(o[k]) ? o[k] : fail());
/** A string of `lo` to `hi` characters, counted in code points as the Rust core counts them (zod counts UTF-16 units). */
const chars = (v: unknown, lo: number, hi: number) => (typeof v === 'string' && [...v].length >= lo && [...v].length <= hi ? v : fail());
const hash = (o: Args, k: string) => (typeof o[k] === 'string' && MEDIA_HASH.test(o[k]) ? o[k] : fail());
const picture = (v: unknown) => {
  const o = obj(v);
  return { full: hash(o, 'full'), thumb: hash(o, 'thumb') };
};
const optPicture = (o: Args, k: string) => (!Object.hasOwn(o, k) ? fail() : o[k] === null ? null : picture(o[k]));

/** An element: its box, then its kind's fields (`elementSchema`). */
function element(v: unknown): Args {
  const o = obj(v);
  const kind = typeof o.kind === 'string' ? o.kind : '';
  if (!['text', 'image', 'rect', 'ellipse', 'line'].includes(kind)) fail();
  const id = chars(o.id, 1, 40);
  const box = { id, x: num(o, 'x', -3840, 5760), y: num(o, 'y', -2160, 3240), w: num(o, 'w', -3840, 5760), h: num(o, 'h', -2160, 3240), kind };
  if (kind === 'text')
    return { ...box, text: chars(o.text, 0, CUSTOM_LIMITS.text), size: int(o, 'size', 10, 400), bold: bool(o, 'bold'), italic: bool(o, 'italic'), align: oneOf(o, 'align', ['left', 'center', 'right']), color: color(o, 'color') };
  if (kind === 'image') return { ...box, picture: Object.hasOwn(o, 'picture') ? picture(o.picture) : fail(), fit: oneOf(o, 'fit', ['contain', 'cover']) };
  if (kind === 'line') return { ...box, stroke: color(o, 'stroke'), strokeWidth: num(o, 'strokeWidth', 1, 100) };
  return { ...box, fill: color(o, 'fill'), stroke: color(o, 'stroke'), strokeWidth: num(o, 'strokeWidth', 0, 100), radius: num(o, 'radius', 0, 540) };
}

export function page(v: unknown): Args {
  const o = obj(v);
  const background = Object.hasOwn(o, 'background') ? color(o, 'background') : fail();
  const [backgroundPicture, backgroundPage] = [optPicture(o, 'backgroundPicture'), optPicture(o, 'backgroundPage')];
  const elements = Array.isArray(o.elements) && o.elements.length <= CUSTOM_LIMITS.elements ? o.elements.map(element) : fail();
  return { background, backgroundPicture, backgroundPage, elements };
}

/** `customSlide`: a slideshow, its pages as stored or one blank page where they do not read (`customPagesSchema`, as pages.rs reads them). */
function customSlide(r: unknown[]): Args {
  let pages: Args[];
  try {
    const v = typeof r[2] === 'string' ? readJson(r[2]) : undefined;
    pages = Array.isArray(v) && v.length >= 1 && v.length <= CUSTOM_LIMITS.pages ? v.map(page) : fail();
  } catch (e) {
    if (!(e instanceof Unread)) throw e;
    pages = [blankPage()];
  }
  return { ...mapRow(r, CUSTOM), pages };
}

const customColumns = 'id, name, pages, created_at, updated_at, deleted_at';

/** `customSlidesView`: the slideshows by name, any case, without the trash (`listCustomSlides`). */
export async function customSlidesView(args: unknown, sql: RunSql) {
  argsOf(args);
  return (await sql(`SELECT ${customColumns} FROM custom_slides WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id`, [])).map(customSlide);
}

/** `customSlideView` {id}: a slideshow, trashed or not, null when there is none (`getCustomSlide`). */
export async function customSlideView(args: unknown, sql: RunSql) {
  const id = idOf(argsOf(args), 'id');
  const [r] = await sql(`SELECT ${customColumns} FROM custom_slides WHERE id = ?`, [id]);
  return r ? customSlide(r) : null;
}

/** `overlaysView`: the overlays in the order they were made (`listOverlays`, PRES-R18). */
export const overlaysView = async (args: unknown, sql: RunSql) => (argsOf(args), (await select(sql, OVERLAY, 'overlays ORDER BY sort, id')).map(overlayRow));

/** `overlayRowView` {id}: an overlay's row, null when there is none (`getOverlay`). */
export async function overlayRowView(args: unknown, sql: RunSql) {
  const id = idOf(argsOf(args), 'id');
  const [o] = await select(sql, OVERLAY, 'overlays WHERE id = ?', [id]);
  return o ? overlayRow(o) : null;
}
