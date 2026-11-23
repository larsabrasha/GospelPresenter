// Presenting's reads (ADR 0008; ported back from crates/gp-core/src/live_views.rs; apps/web/src/live, pages/Output.tsx,
// pages/live): the slide shown and what goes with it, the item's overlays, a controller's command checked, the video and
// audio to play, a song to count for CCLI, the outputs and the remote control policy, as the web's reads gave them.
import { blankPage } from '../custom-slides.ts';
import { CCLI_COLLECTION_SETTING, REMOTE_CONTROL_SETTING, remoteControlPolicy } from '../mutation.ts';
import type { RunSql } from './sql.ts';
import { argsOf, asStr, idOf, optId } from './serde.ts';
import { type Args, columns, ITEM, itemKind, itemRow, jsString, langOf, readJson, select, SONG, sortRows } from './lists-rows.ts';
import { AUDIO, page, Unread, VIDEO, videoRow } from './lists-media.ts';
import { themeOf } from './lists-settings.ts';
import { itemsSlides, type SlideItem } from './slides-items.ts';

/** An item as the slides read it. */
export const slideItem = (i: Args): SlideItem => ({
  kind: asStr(i.type) ?? '',
  title: asStr(i.title) ?? '',
  sourceId: asStr(i.sourceId) ?? '',
  arrangementId: asStr(i.arrangementId),
  content: asStr(i.content),
});

/** The item of a presentation, by id, as `itemsOf(…).find(…)` finds it. */
async function itemOf(sql: RunSql, pid: string, itemId: string): Promise<Args | null> {
  const [r] = await sql(`SELECT ${columns(ITEM)} FROM presentation_items WHERE presentation_id = ? AND id = ?`, [pid, itemId]);
  return r ? itemRow(r) : null;
}

/** `parseCustomPage`: the page stored, or a blank page where it does not read. */
function customPage(content: unknown): Args {
  try {
    const v = typeof content === 'string' ? readJson(content) : undefined;
    if (v !== undefined) return page(v);
  } catch (e) {
    if (!(e instanceof Unread)) throw e;
  }
  return blankPage();
}

/** `shownOverlay`: what an overlay shows, null for none or one that is gone. */
async function shownOverlay(sql: RunSql, id: string | null): Promise<Args | null> {
  if (id === null) return null;
  const [r] = await sql('SELECT content FROM overlays WHERE id = ?', [id]);
  return r ? customPage(r[0]) : null;
}

/** `overlayView` {id}: what the overlay shows, null for none or one deleted meanwhile (`shownOverlay`). */
export const overlayView = (args: unknown, sql: RunSql) => shownOverlay(sql, optId(argsOf(args), 'id'));

/** `as_u64`: a whole number from 0 up, as JSON carries one; else none. */
const asU64 = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 64 ? v : null);

/**
 * `liveSlideView` {presentationId, itemId, partIndex, overlayId}: {name, slide, theme, overlay}. The presentation's name
 * (null when it is gone), the slide shown (null when there is none), the presentation's theme, the overlay shown.
 */
export async function liveSlideView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const pid = idOf(a, 'presentationId');
  const itemId = optId(a, 'itemId');
  // `as usize` on the WASM core's 32-bit usize: a larger index wraps.
  const part = Number(BigInt.asUintN(32, BigInt(asU64(a.partIndex) ?? 0)));
  const [p] = await sql('SELECT name, theme_id FROM presentations WHERE id = ?', [pid]);
  const shown = itemId === null ? null : await itemOf(sql, pid, itemId);
  const slide = shown ? ((await itemsSlides([slideItem(shown)], sql))[0]?.slides[part] ?? null) : null;
  const theme = await themeOf(sql, p ? asStr(p[1]) : null);
  return {
    name: p ? jsString(p[0]) : null,
    slide,
    theme,
    overlay: await shownOverlay(sql, asStr(a.overlayId)),
  };
}

/** `itemOverlaysView` {presentationId}: each item's overlay, [[itemId, overlayId]...] in the running order. */
export async function itemOverlaysView(args: unknown, sql: RunSql) {
  const pid = idOf(argsOf(args), 'presentationId');
  return (await sql('SELECT id, overlay_id FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', [pid])).map((r) => [
    jsString(r[0]),
    r[1] ?? null,
  ]);
}

/**
 * `liveTargetsView` {presentationId, itemId?, overlayId?}: whether a controller's command still points at what is there
 * (LIVE-R49): the item in the presentation, the overlay not deleted.
 */
export async function liveTargetsView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const pid = idOf(a, 'presentationId');
  const itemId = optId(a, 'itemId');
  const item = itemId === null || (await itemOf(sql, pid, itemId)) !== null;
  const overlayId = optId(a, 'overlayId');
  const overlay = overlayId === null || (await sql('SELECT 1 FROM overlays WHERE id = ?', [overlayId])).length > 0;
  return { item, overlay };
}

/** `getVideo`: a video by id, trashed or not (MEDIA-R8). */
async function video(sql: RunSql, id: string): Promise<Args | null> {
  const [v] = await select(sql, VIDEO, 'videos WHERE id = ?', [id]);
  return v ? videoRow(v) : null;
}

/** `livePlaybackView` {presentationId, itemId}: the item shown, its video and the next item's, which buffers. */
export async function livePlaybackView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const pid = idOf(a, 'presentationId');
  const itemId = optId(a, 'itemId');
  const items = await sql('SELECT id, type, source_id FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id', [pid]);
  const at = items.findIndex((r) => (asStr(r[0]) ?? '') === itemId);
  const videoOf = (k: number) => (items[k]?.[1] === 'video' ? (asStr(items[k][2]) ?? '') : null);
  const [shown, next] = at < 0 ? [null, null] : [videoOf(at), videoOf(at + 1)];
  return {
    item: at < 0 ? null : { id: jsString(items[at]![0]), type: itemKind(items[at]![1]) },
    video: shown === null ? null : await video(sql, shown),
    nextVideo: next === null ? null : await video(sql, next),
  };
}

/** `itemAudioView` {itemId}: an audio item's file, null for another kind of item or a file gone. */
export async function itemAudioView(args: unknown, sql: RunSql) {
  const itemId = optId(argsOf(args), 'itemId');
  if (itemId === null) return null;
  const [r] = await sql("SELECT source_id FROM presentation_items WHERE id = ? AND type = 'audio'", [itemId]);
  if (!r) return null;
  return (await select(sql, AUDIO, 'audios WHERE id = ?', [r[0] ?? null]))[0] ?? null;
}

/**
 * `ccliUseView` {presentationId, itemId}: what to record when a slide has been shown long enough (SONG-R48–R53), or
 * null: collection off, not a song, or a song without a CCLI number.
 */
export async function ccliUseView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const pid = idOf(a, 'presentationId');
  const itemId = optId(a, 'itemId');
  const [setting] = await sql('SELECT value FROM org_settings WHERE id = ?', [CCLI_COLLECTION_SETTING]);
  const item = setting?.[0] === 'true' && itemId !== null ? await itemOf(sql, pid, itemId) : null;
  if (!item || item.type !== 'song') return null;
  const [song] = await select(sql, SONG, 'songs WHERE id = ?', [item.sourceId]);
  if (!song || typeof song.ccli !== 'string' || song.ccli.trim() === '') return null;
  const [p] = await sql('SELECT name FROM presentations WHERE id = ?', [pid]);
  return {
    songId: song.id,
    songName: song.name,
    ccli: song.ccli,
    presentationId: pid,
    presentationName: p ? jsString(p[0]) : '',
  };
}

/** `displaysView` {locale}: the organisation's outputs, oldest first, then by name in the page's language and id (`listDisplays`). */
export async function displaysView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const rows = (await sql('SELECT id, name, code, kind, created_at FROM displays ORDER BY id', [])).map((r) => ({
    id: r[0] ?? null,
    name: r[1] ?? null,
    code: r[2] ?? null,
    kind: r[3] === 'screen' ? 'screen' : 'public',
    createdAt: r[4] ?? null,
  }));
  return sortRows(langOf(a), rows, [
    ['asc', 'createdAt'],
    ['name', 'name'],
    ['id', 'id'],
  ]);
}

/** `remoteControlView`: the organisation's remote control policy (`remoteControlPolicy`): no row, or a value not known, is the presenter's choice. */
export async function remoteControlView(args: unknown, sql: RunSql) {
  argsOf(args);
  const [r] = await sql('SELECT value FROM org_settings WHERE id = ?', [REMOTE_CONTROL_SETTING]);
  return remoteControlPolicy(asStr(r?.[0]));
}
