// The libraries (apps/web's Bilder, Ljud, Video, Bildspel and Overlays, and the add dialog's tabs): pictures, sounds,
// videos, slideshows and overlays, as the web's reads gave them (ported back from crates/gp-core/src/media_views.rs).
import { parseCustomPages } from '../custom-slides.ts';
import type { RunSql } from './sql.ts';
import { type Args, type Fields, mapRow, select } from './lists-rows.ts';
import { argsOf, asStr, idOf } from './serde.ts';

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

/** `customSlide`: a slideshow, its pages checked, one blank page where they do not read (`parseCustomPages`). */
const customSlide = (r: unknown[]): Args => ({ ...mapRow(r, CUSTOM), pages: parseCustomPages(asStr(r[2])) });

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
