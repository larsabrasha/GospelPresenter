// Which media files a device fetches, keeps, drops and uploads (docs/media-and-files.md, "Which files a device keeps"
// and "Media"; ADR 0008, ported back from crates/gp-core/src/media_wanted.rs and media_plan.rs). Every picture's and
// video's thumbnail, always; a theme's and every slideshow's and overlay's pictures as their thumbnails; and, for the
// presentation presented and those kept offline, the files it needs live, with every overlay's and theme's full
// picture. A video itself only where it is kept offline. The shell moves the bytes; the core says which files. A shell
// that keeps its files elsewhere than `media_blobs` says what it holds (`held`). Sizes and times are i64, as they were.
import { MutationError } from '../mutation.ts';
import type { RunSql } from './sql.ts';
import { type Json, argsOf, asI64, byCodePoint, field, i64, intOf, isObject, jsString, s, serdeParse, truthy } from './files-json.ts';

/** Every picture a page of a set of pages draws, each a row of `full_hash` and `thumb_hash` and the columns `cols` of `from`. */
function pagePictures(cols: string, from: string, where: string): string {
  const parts = ['$.backgroundPage', '$.backgroundPicture'].map(
    (at) =>
      `SELECT ${cols}json_extract(pg.value, '${at}.full') AS full_hash, json_extract(pg.value, '${at}.thumb') AS thumb_hash\n  FROM ${from} WHERE ${where} AND json_extract(pg.value, '${at}') IS NOT NULL`,
  );
  parts.push(
    `SELECT ${cols}json_extract(e.value, '$.picture.full') AS full_hash, json_extract(e.value, '$.picture.thumb') AS thumb_hash\n  FROM ${from}, json_each(pg.value, '$.elements') e WHERE ${where} AND json_extract(e.value, '$.kind') = 'image'`,
  );
  return parts.join('\n  UNION ALL\n  ');
}

/** A column's JSON for `json_each`, or no rows where it does not read: one such row would stop the whole query. */
const readable = (column: string) => `CASE WHEN json_valid(${column}) THEN ${column} END`;
const SLIDE_PAGES = pagePictures('p.presentation_id, ', `presentation_items p JOIN custom_slides c ON c.id = p.source_id, json_each(${readable('c.pages')}) pg`, "p.type = 'custom'");
const SLIDESHOW_PICTURES = pagePictures('', `custom_slides c, json_each(${readable('c.pages')}) pg`, '1');
const OVERLAY_PICTURES = pagePictures('o.id AS overlay_id, o.sort, ', 'overlays o, json_each(CASE WHEN json_valid(o.content) THEN json_array(json(o.content)) END) pg', '1');
const THEME_PICTURES = ['$.song.background.image', '$.bible.background.image', '$.media.image']
  .map(
    (at) =>
      `SELECT t.id AS theme_id, json_extract(t.definition, '${at}.full') AS full_hash, json_extract(t.definition, '${at}.thumb') AS thumb_hash\n  FROM themes t WHERE json_valid(t.definition) AND json_extract(t.definition, '${at}.kind') = 'picture'`,
  )
  .join('\n  UNION ALL\n  ');
const ITEM_IMAGES = `SELECT p.presentation_id, p.source_id AS image_id FROM presentation_items p WHERE p.type = 'image' AND p.content IS NULL
  UNION ALL
  SELECT p.presentation_id, j.value AS image_id FROM presentation_items p, json_each(CASE WHEN json_valid(p.content) THEN p.content END, '$.images') j WHERE p.type = 'image' AND p.content IS NOT NULL`;
const VIDEOS_OF = "SELECT v.hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'";

/** The policy as the shell gives it (`MediaPolicy`). */
interface Policy {
  presenting: string | null;
  persistent: boolean;
  keepComing: boolean;
  today: string;
  days: bigint;
  fetch: boolean;
}

/** The policy from a view's arguments {presenting, persistent, keepComing, today, days, fetch}. */
function policyOf(a: Json): Policy {
  const p = a.presenting ?? null;
  if (p !== null && (typeof p !== 'string' || [...p].length < 1 || [...p].length > 100)) throw new MutationError('invalid-args');
  const flag = (v: unknown, otherwise: boolean) => (typeof v === 'boolean' ? v : otherwise);
  return { presenting: p, persistent: flag(a.persistent, true), keepComing: flag(a.keepComing, false), today: typeof a.today === 'string' ? a.today : '', days: asI64(a.days) ?? 7n, fetch: flag(a.fetch, true) };
}

/** `addDays`: a plain date `YYYY-MM-DD` plus `days`, in the calendar (Howard Hinnant's algorithms, in i64 as Rust's). */
function addDays(date: string, days: bigint): string {
  const n = date.split('-').map((p) => {
    if (!/^\+?\d+$/.test(p)) return 0n;
    const v = BigInt(p);
    return v < 2n ** 63n ? v : 0n;
  });
  const div = (a: bigint, b: bigint) => (a % b < 0n ? a / b - 1n : a / b);
  const fromCivil = (y0: bigint, m: bigint, d: bigint) => {
    const y = m <= 2n ? i64(y0 - 1n) : y0;
    const era = div(y, 400n);
    const yoe = i64(y - i64(era * 400n));
    const doy = (153n * (m > 2n ? m - 3n : m + 9n) + 2n) / 5n + d - 1n;
    return i64(i64(i64(i64(i64(era * 146_097n) + yoe * 365n) + yoe / 4n) - yoe / 100n) + doy) - 719_468n;
  };
  const [y0, m0, d] = [n[0] ?? 1970n, n[1] ?? 1n, n[2] ?? 1n];
  const y = i64(y0 + div(i64(m0 - 1n), 12n));
  const m = i64(m0 - 1n) - div(i64(m0 - 1n), 12n) * 12n + 1n;
  const z = i64(i64(i64(i64(i64(fromCivil(y, m, 1n)) + d) - 1n) + days) + 719_468n);
  const era = div(z, 146_097n);
  const doe = i64(z - i64(era * 146_097n));
  const yoe = (doe - doe / 1460n + doe / 36_524n - doe / 146_096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const day = doy - (153n * mp + 2n) / 5n + 1n;
  const month = mp < 10n ? mp + 3n : mp - 9n;
  const year = i64(i64(yoe + i64(era * 400n)) + (month <= 2n ? 1n : 0n));
  const pad = (v: bigint, width: number) => (v < 0n ? `-${(-v).toString().padStart(width - 1, '0')}` : v.toString().padStart(width, '0'));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const column = async (sql: RunSql, q: string, params: unknown[] = []) => (await sql(q, params)).map((r) => s(r[0]));
const unique = (xs: string[]) => [...new Set(xs)];

/** `keptPresentations`: those chosen by hand, and, with `keepComing`, those dated from today to `days` ahead. */
async function kept(sql: RunSql, p: Policy): Promise<string[]> {
  if (!p.persistent) return [];
  const ids = await column(sql, 'SELECT p.id FROM pinned_presentations k JOIN presentations p ON p.id = k.id WHERE p.deleted_at IS NULL ORDER BY k.pinned_at');
  if (p.keepComing) {
    const q = 'SELECT id FROM presentations WHERE deleted_at IS NULL AND is_template = 0 AND event_date >= ? AND event_date <= ? ORDER BY event_date';
    ids.push(...(await column(sql, q, [p.today, addDays(p.today, p.days)])));
  }
  return unique(ids);
}

/** `presentationFiles`: every file a presentation needs live but its videos. */
function presentationFiles(sql: RunSql, id: string): Promise<string[]> {
  const q = `SELECT i.full_hash AS hash FROM (${ITEM_IMAGES}) p JOIN images i ON i.id = p.image_id
       WHERE p.presentation_id = ?
     UNION ALL
     SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'audio'
     UNION ALL
     SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'video'
     UNION ALL
     SELECT s.thumb_hash AS hash FROM (${SLIDE_PAGES}) s WHERE s.presentation_id = ?
     UNION ALL
     SELECT s.full_hash AS hash FROM (${SLIDE_PAGES}) s WHERE s.presentation_id = ?`;
  return column(sql, q, Array<string>(5).fill(id));
}

/** The blobs this device should hold now, in the order to fetch them, and the videos it keeps whole. */
async function wanted(sql: RunSql, p: Policy): Promise<{ blobs: string[]; videos: { hash: string; size: number }[] }> {
  if (!p.fetch) return { blobs: [], videos: [] };
  const hashes = await column(sql, 'SELECT hash FROM (SELECT thumb_hash AS hash, created_at FROM images UNION ALL SELECT thumb_hash AS hash, created_at FROM videos) ORDER BY created_at DESC');
  for (const q of [THEME_PICTURES, SLIDESHOW_PICTURES]) hashes.push(...(await column(sql, `SELECT thumb_hash AS hash FROM (${q}) WHERE thumb_hash IS NOT NULL`)));
  const overlays = await sql(`SELECT full_hash, thumb_hash FROM (${OVERLAY_PICTURES}) ORDER BY sort`, []);
  hashes.push(...overlays.filter((o) => o[1] !== null).map((o) => s(o[1])));
  const keptIds = await kept(sql, p);
  const order = unique([...(p.presenting === null ? [] : [p.presenting]), ...keptIds]);
  if (order.length) {
    hashes.push(...overlays.map((o) => s(o[0])));
    hashes.push(...(await column(sql, `SELECT full_hash AS hash FROM (${THEME_PICTURES})`)));
  }
  for (const id of order) hashes.push(...(await presentationFiles(sql, id)));
  const marks = keptIds.map(() => '?').join(',');
  const videos = keptIds.length
    ? (await sql(`SELECT DISTINCT v.hash, v.size FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id IN (${marks})`, keptIds)).map((r) => ({
        hash: s(r[0]),
        size: Number(intOf(r[1])),
      }))
    : [];
  return { blobs: unique(hashes), videos };
}

/** `wantedMediaView` {presenting, persistent, keepComing, today, days, fetch}: the blobs to hold now, in order, and the videos kept whole. */
export const wantedMediaView = async (args: unknown, sql: RunSql) => wanted(sql, policyOf(argsOf(args)));

// ------------------------------------------------------------------ the plan

/** How long a blob nothing names is kept (`ORPHAN_GRACE_MS`), so one uploaded just before its add is pushed survives. */
const GRACE = 60n * 60n * 1000n;
/** The most bytes kept of files nothing wants now, where the shell names none (MEDIA-R14: 2 GiB). */
const DEFAULT_BUDGET = 2n * 1024n * 1024n * 1024n;
const DECK_PAGES = ['addSlides', 'createCustomSlide', 'updateCustomSlide', 'createOverlay', 'updateOverlay'];
const THEMES = ['createTheme', 'updateTheme'];
/** The mutators that name blobs a device kept first (`BLOB_ADDS`). */
const namesBlobs = (m: string) => ['addImage', 'editImage', 'addAudio', 'addVideo', 'addSongFile', ...DECK_PAGES, ...THEMES].includes(m);
const HASH = /^[0-9a-f]{64}$/;
const twoBlobs = (picture: unknown) => [jsString(field(picture, 'full')), jsString(field(picture, 'thumb'))];

/** `customPageBlobs`: every picture the pages draw, both sizes; none when a page does not read as one. */
function pageBlobs(pages: unknown[]): string[] {
  const out: string[] = [];
  for (const p of pages) {
    const elements = field(p, 'elements');
    if (!Array.isArray(elements)) return [];
    const pictures = ['backgroundPicture', 'backgroundPage'].map((k) => field(p, k)).filter(truthy);
    for (const e of elements) {
      if (field(e, 'kind') !== 'image') continue;
      const picture = field(e, 'picture');
      if (!isObject(picture)) return []; // the web's `e.picture.full` threw on it
      pictures.push(picture);
    }
    for (const pic of pictures) out.push(...twoBlobs(pic));
  }
  return unique(out);
}

/** `themeBlobs` of a definition that reads: each picture background's two blobs. */
function themeBlobs(d: unknown): string[] {
  const grounds = [field(field(d, 'song'), 'background'), field(field(d, 'bible'), 'background'), field(d, 'media')];
  if (!grounds.every(isObject)) return [];
  return grounds.map((g) => field(g, 'image')).filter((i) => field(i, 'kind') === 'picture').flatMap(twoBlobs);
}

/** `blobsOf`: the blobs a queued change names, in order. */
function blobsOf(name: string, args: unknown): string[] {
  const f = (k: string) => jsString(field(args, k));
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  if (THEMES.includes(name)) return unique(field(args, 'definition') === undefined ? [] : themeBlobs(field(args, 'definition')));
  if (name === 'addAudio' || name === 'addSongFile') return [f('hash')];
  if (name === 'addVideo') return unique([f('hash'), f('stillHash'), f('thumbHash')]);
  if (name === 'addSlides') return unique(list(field(args, 'pages')).flatMap(twoBlobs));
  if (DECK_PAGES.includes(name)) {
    const page = field(args, 'page');
    return pageBlobs(name.endsWith('Overlay') ? (truthy(page) ? [page] : []) : list(field(args, 'pages')));
  }
  return unique([f('fullHash'), f('thumbHash')]);
}

/** The queue, each change that names blobs with its place in it and the blobs. */
async function queued(sql: RunSql): Promise<{ index: number; blobs: string[] }[]> {
  const rows = await sql('SELECT name, args FROM _mutation ORDER BY id', []);
  return rows.flatMap((r, index) => (namesBlobs(s(r[0])) ? [{ index, blobs: blobsOf(s(r[0]), serdeParse(s(r[1]))) }] : []));
}

type Held = { hash: string; size: bigint; at: bigint };
const intField = (v: unknown, k: string) => (field(v, k) === undefined ? 0n : intOf(field(v, k)));

/** The blobs this device holds with their bytes, oldest first, as the shell says or as `media_blobs` keeps them. */
async function held(sql: RunSql, a: Json): Promise<Held[]> {
  if (Array.isArray(a.held)) {
    const h = a.held.map((f: unknown) => ({ hash: jsString(field(f, 'hash')), size: intField(f, 'size'), at: intField(f, 'at') }));
    return h.toSorted((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : byCodePoint(x.hash, y.hash)));
  }
  const rows = await sql('SELECT hash, size, received_at FROM media_blobs WHERE bytes IS NOT NULL ORDER BY received_at, hash', []);
  return rows.map((r) => ({ hash: s(r[0]), size: intOf(r[1]), at: intOf(r[2]) }));
}

/** Each list of blobs something of the organisation names (what `ORPHAN_BLOBS_SQL` keeps). */
const NAMED_LISTS = [
  'SELECT hash FROM song_materials WHERE hash IS NOT NULL',
  'SELECT full_hash FROM images',
  'SELECT thumb_hash FROM images',
  'SELECT original_full_hash FROM images WHERE original_full_hash IS NOT NULL',
  'SELECT original_thumb_hash FROM images WHERE original_thumb_hash IS NOT NULL',
  'SELECT hash FROM audios',
  'SELECT hash FROM videos',
  'SELECT still_hash FROM videos',
  'SELECT thumb_hash FROM videos',
  ...[SLIDESHOW_PICTURES, OVERLAY_PICTURES, THEME_PICTURES].flatMap((q) => [`SELECT full_hash FROM (${q})`, `SELECT thumb_hash FROM (${q})`]),
];

/** The blobs nothing names, older than the grace: from `media_blobs` (a row without bytes too, a video's), or among those held. */
async function orphans(sql: RunSql, a: Json, heldBlobs: Held[], before: bigint): Promise<string[]> {
  if (a.held !== undefined) {
    const named = new Set(await column(sql, NAMED_LISTS.join(' UNION ')));
    return heldBlobs.filter((h) => h.at < before && !named.has(h.hash)).map((h) => h.hash);
  }
  // As the web's query reads it, `NOT IN` each list apart (a list holding a null keeps every blob).
  const notIn = NAMED_LISTS.map((l) => `AND hash NOT IN (${l})`).join(' ');
  return column(sql, `SELECT hash FROM media_blobs WHERE received_at < ? ${notIn}`, [Number(before)]);
}

/**
 * `mediaPlanView` {presenting, persistent, keepComing, today, days, fetch, budget, now, held?, inUse?}: what to fetch
 * (wanted and not held, in order), what to drop (what nothing names past the grace, never what a queued change names
 * or the player has; then, while the files nothing wants now are over `budget`, the oldest of those), and the bytes
 * of that cache after the drop.
 */
export async function mediaPlanView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const p = policyOf(a);
  const budget = a.budget === undefined ? DEFAULT_BUDGET : intOf(a.budget);
  const now = a.now === undefined ? 0n : intOf(a.now);
  const { blobs: want } = await wanted(sql, p);
  const heldBlobs = await held(sql, a);
  const have = new Set(heldBlobs.map((h) => h.hash));
  const fetch = want.filter((h) => !have.has(h));
  const waiting = new Set((await queued(sql)).flatMap((q) => q.blobs));
  for (const h of Array.isArray(a.inUse) ? a.inUse : []) waiting.add(jsString(h));
  if (a.held !== undefined && p.presenting !== null) for (const h of await column(sql, VIDEOS_OF, [p.presenting])) waiting.add(h);
  const drop = (await orphans(sql, a, heldBlobs, i64(now - GRACE))).filter((h) => !waiting.has(h));
  const keep = new Set([...want, ...waiting, ...drop]);
  const spare = heldBlobs.filter((h) => !keep.has(h.hash));
  let cache = spare.reduce((n, h) => i64(n + h.size), 0n);
  for (const h of spare) {
    if (cache <= budget) break;
    drop.push(h.hash);
    cache = i64(cache - h.size);
  }
  return { fetch, drop, cache: Number(cache) };
}

/**
 * `mediaUploadsView` {uploaded: {hash: at}, now}: the blobs to upload before a push, in order, each with the place in
 * the queue of the change that names it: a valid hash, held with its bytes, not uploaded in the last half of the grace.
 */
export async function mediaUploadsView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const uploaded = isObject(a.uploaded) ? a.uploaded : {};
  const now = a.now === undefined ? 0n : intOf(a.now);
  const withBytes = new Set(await column(sql, 'SELECT hash FROM media_blobs WHERE bytes IS NOT NULL'));
  const uploads: { index: number; hash: string }[] = [];
  for (const { index, blobs } of await queued(sql)) {
    for (const hash of blobs) {
      const recent = Object.hasOwn(uploaded, hash) && i64(now - intOf(uploaded[hash])) < GRACE / 2n;
      if (HASH.test(hash) && !recent && withBytes.has(hash)) uploads.push({ index, hash });
    }
  }
  return { uploads };
}

/**
 * `mediaStorageView` {presenting, persistent, keepComing, today, days, fetch, held?}: how this device's files are used:
 * every file kept, each presentation kept offline with the bytes of the files it needs, those files once, and the
 * cache (what is neither wanted, nor waiting to be uploaded, nor a video kept offline).
 */
export async function mediaStorageView(args: unknown, sql: RunSql) {
  const a = argsOf(args);
  const p = policyOf(a);
  const sizes = new Map<string, bigint>();
  if (Array.isArray(a.held)) for (const h of await held(sql, a)) sizes.set(h.hash, h.size);
  else {
    for (const r of await sql('SELECT hash, size FROM media_blobs WHERE bytes IS NOT NULL', [])) sizes.set(s(r[0]), intOf(r[1]));
    for (const r of await sql('SELECT hash, received FROM video_files', [])) sizes.set(s(r[0]), intOf(r[1]));
  }
  const sum = (hashes: string[]) => unique(hashes).reduce((n, h) => i64(n + (sizes.get(h) ?? 0n)), 0n);
  const { blobs, videos } = await wanted(sql, p);
  const wantedAll = new Set([...blobs, ...(await queued(sql)).flatMap((q) => q.blobs), ...videos.map((v) => v.hash)]);
  const shared = [...(await column(sql, `SELECT o.full_hash AS hash FROM (${OVERLAY_PICTURES}) o`)), ...(await column(sql, `SELECT full_hash AS hash FROM (${THEME_PICTURES})`))];
  const offline: { presentationId: string; bytes: number }[] = [];
  const keptFiles: string[] = [];
  for (const id of await kept(sql, p)) {
    const files = [...shared, ...(await presentationFiles(sql, id)), ...(await column(sql, VIDEOS_OF, [id]))];
    offline.push({ presentationId: id, bytes: Number(sum(files)) });
    keptFiles.push(...files);
  }
  const keys = [...sizes.keys()];
  return { total: Number(sum(keys)), offline, offlineTotal: Number(sum(keptFiles)), cache: Number(sum(keys.filter((h) => !wantedAll.has(h)))) };
}
