// The export zip's rows (docs/import-from-1x.md; ADR 0008, ported back from crates/gp-core/src/legacy.rs, itself from
// legacy.ts at 238d481b): an older format's rows brought to this one, the blobs the rows name, the first row the server
// would refuse, and 1.x's overlay as a page. A column that holds JSON is written by files-json.ts's `stringify`. Rows
// that are not objects, or a table the upgrade reads that is not a list of them, are refused (`invalid-rows`).
import { CUSTOM_LIMITS, type CustomPage, type Picture, customPageBlobs, customPagesSchema, pdfPages, readCustomPage, readCustomPages } from '../custom-slides.ts';
import { LEGACY_TABLES, type LegacyRows } from '../legacy.ts';
import { MutationError } from '../mutation.ts';
import { slideDeckPagesSchema } from '../slides.ts';
import { checkedThemeBlobs } from '../themes.ts';
import { tableByName } from '../sync-sql.ts';
import type { RunSql } from './sql.ts';
import { type Json, jsonArgs, isObject, parseLegacyJson, sortedKeys, stringify, orderedString, unique } from './files-json.ts';
import { readBibleItemContent } from './slides-items.ts';
import { cutChars } from '../chars.ts';

const refused = (): never => {
  throw new MutationError('invalid-rows');
};
/**
 * A zip's rows as the core works on them: plain JSON, as they were written to the file, half a surrogate pair mended
 * (`parseLegacyJson`); rows that are not an object are refused (`invalid-args`).
 */
function rowsOf(rows: unknown): Json {
  const text = JSON.stringify(rows);
  const value = text === undefined ? undefined : parseLegacyJson(text);
  if (!isObject(value)) throw new MutationError('invalid-args');
  return value;
}

/** A zip's rows of `format` as this format has them. */
export const upgradeLegacyRows = (format: number, rows: unknown) => upgrade(format, rowsOf(rows)) as unknown as LegacyRows;

/** The first row the server would refuse, named by its table and id ("images {id}"), or null. */
export const legacyRowsProblem = (rows: LegacyRows): string | null => problem(rowsOf(rows));

/** The blobs the rows name, each with the row that names it ("images {id}"), and which of them are videos. */
export function legacyBlobs(rows: LegacyRows): { named: [hash: string, row: string][]; videos: Set<string> } {
  const { named, videos } = blobs(rowsOf(rows));
  return { named, videos: new Set(videos) };
}

/** A 1.x overlay as a page, drawn as 1.x drew it: its picture over the stage, its text at the top left. */
export const legacyOverlayPage = (content: string | null, picture: Picture | null) => overlayPage(content, picture) as unknown as CustomPage;

/** `exportRowsView` {}: every row of the tables the import writes, with exactly their columns, in their order, by id, as JSON text. */
export async function exportRowsView(args: unknown, sql: RunSql): Promise<string> {
  jsonArgs(args);
  const out: Json = {};
  for (const t of LEGACY_TABLES) {
    const columns = tableByName.get(t)!.columns;
    const rows = await sql(`SELECT ${columns.join(', ')} FROM ${t} ORDER BY id`, []);
    out[t] = rows.map((r) => new Map(columns.map((c, i) => [c, sortedKeys(r[i])])));
  }
  return stringify(out);
}

// ------------------------------------------------------------------ helpers on rows

/** A table's rows: a list of objects, else refused. */
function list(rows: Json, t: string): Json[] {
  const xs = rows[t];
  return Array.isArray(xs) && xs.every(isObject) ? (xs as Json[]) : refused();
}
/** `o[key] = v` on a copy. */
const withKey = (row: Json, key: string, v: unknown): Json => {
  const out = { ...row };
  out[key] = v;
  return out;
};
const text = (v: unknown) => (typeof v === 'string' ? v : null);
const orNull = (v: unknown) => v ?? null;

/** A row's page JSON, or pages JSON, through `f`; one that does not read is left as it was. */
function rewrite(json: unknown, f: (v: unknown) => unknown): unknown {
  const v = parseLegacyJson(text(json) ?? '');
  return v === undefined ? orNull(json) : stringify(f(v));
}

type Pictures = Map<string, { full: string; thumb: string }>;

/**
 * A page of a zip before format 5 as this format has it: a picture of Bilder named by id (`imageId`,
 * `backgroundImageId`) becomes the page's own blobs, those of the zip's picture; one the zip lacks is left out.
 */
function ownPictures(page: unknown, images: Pictures): unknown {
  if (page === null || typeof page !== 'object') return page;
  const rest: Json = { ...(page as Json) };
  const background = rest.backgroundImageId;
  const elements = rest.elements;
  const had = (k: string) => Object.hasOwn(rest, k);
  const [hasBackground, hasElements] = [had('backgroundImageId'), had('elements')];
  delete rest.backgroundImageId;
  delete rest.elements;
  if (hasBackground) rest.backgroundPicture = images.get(orderedString(background)) ?? null;
  rest.backgroundPage = orNull(rest.backgroundPage);
  if (Array.isArray(elements)) {
    rest.elements = elements.flatMap((e: unknown) => {
      if (!isObject(e) || e.kind !== 'image' || !Object.hasOwn(e, 'imageId')) return [e];
      const own = { ...e };
      const id = own.imageId;
      delete own.imageId;
      const picture = images.get(orderedString(id));
      return picture ? [withKey(own, 'picture', picture)] : [];
    });
  } else if (hasElements) rest.elements = elements;
  return rest;
}

/** A slideshow row of a PDF's pages, as schema 21 made them; null where the pages do not read. */
function slideshowRow(id: unknown, name: unknown, pages: unknown): Json | null {
  const deck = slideDeckPagesSchema.safeParse(pages);
  return deck.success ? { id: orNull(id), name: orNull(name), pages: stringify(pdfPages(deck.data)), created_at: 0, updated_at: 0, deleted_at: null } : null;
}

// ------------------------------------------------------------------ the upgrade

/**
 * A zip's rows as this format has them (`upgradeLegacyRows`): before 4 a deck's pages become a slideshow of PDF pages
 * that its item names; before 5 a page's pictures of Bilder become its own; before 6 an item has no comment; before 7
 * no picture is edited; before 9 no song is a draft; in every format a song part that is only an RTF leftover goes; and the fields that keep a
 * time each take the row's last change.
 */
const upgrade = (format: number, rows: Json): Json => withFieldTimes(withoutRtfLeftovers(upgradeFormat(format, rows)));

function upgradeFormat(format: number, rows: Json): Json {
  const rest: Json = { ...rows };
  const take = (t: string) => {
    const v = Object.hasOwn(rest, t) ? rest[t] : [];
    delete rest[t];
    return v;
  };
  const [decks, slideshows] = [take('slide_decks'), take('custom_slides')];
  const [themes, videos, materials] = [take('themes'), take('videos'), take('song_materials')];
  Object.assign(rest, { themes, videos, song_materials: materials });
  if (format < 6) rest.presentation_items = list(rest, 'presentation_items').map((i) => withKey(i, 'note', null));
  if (format < 9) rest.songs = list(rest, 'songs').map((s) => withKey(s, 'draft', null));
  if (format < 7) {
    const unedited = (i: Json) => ({ ...i, ...Object.fromEntries(['original_full_hash', 'original_thumb_hash', 'original_width', 'original_height', 'edit'].map((k) => [k, null])) });
    rest.images = list(rest, 'images').map(unedited);
  }
  if (format >= 5) {
    rest.custom_slides = slideshows;
    return rest;
  }
  const images: Pictures = new Map(list(rest, 'images').map((i) => [orderedString(i.id), { full: orderedString(i.full_hash), thumb: orderedString(i.thumb_hash) }]));
  const own = (v: unknown) => ownPictures(v, images);
  if (format === 4) {
    rest.overlays = list(rest, 'overlays').map((o) => withKey(o, 'content', rewrite(o.content, own)));
    if (!Array.isArray(slideshows)) refused();
    rest.custom_slides = (slideshows as unknown[]).map((r) => {
      if (!isObject(r)) refused();
      const row = r as Json;
      return withKey(row, 'pages', rewrite(row.pages, (v) => (Array.isArray(v) ? v.map(own) : v)));
    });
    return rest;
  }
  if (!Array.isArray(decks)) refused();
  const made: Json[] = (decks as unknown[]).map((d) => {
    if (!isObject(d)) refused();
    const deck = d as Json;
    const pages = parseLegacyJson(text(deck.pages) ?? '');
    return (pages !== undefined && slideshowRow(deck.id, deck.name, pages)) || withKey(deck, 'pages', null); // left for the problem check to name
  });
  const items = list(rest, 'presentation_items').map((item) => {
    if (item.type !== 'slides') return item;
    if (format >= 3) return withKey(item, 'type', 'custom');
    const content = parseLegacyJson(text(item.content) ?? '');
    const row = isObject(content) && Object.hasOwn(content, 'pages') ? slideshowRow(item.id, item.title, content.pages) : null;
    if (!row) return item; // left for the problem check to name
    made.push(row);
    return { ...item, type: 'custom', source_id: orNull(item.id), content: null };
  });
  rest.overlays = list(rest, 'overlays').map((o) => {
    if (format !== 1) return withKey(o, 'content', rewrite(o.content, own));
    const page = overlayPage(text(o.content), images.get(orderedString(o.image_id)) ?? null);
    return { id: orNull(o.id), title: orNull(o.title), content: stringify(page), image_id: null, sort: orNull(o.sort), updated_at: null };
  });
  rest.presentation_items = items;
  rest.custom_slides = made;
  return rest;
}

/** A song part 1.x left with only what its ProPresenter import kept of an empty slide's RTF header (`;;`, `\*;;`). */
const rtfLeftover = (content: unknown) => typeof content === 'string' && content.includes(';') && /^[\s;\\*]*$/.test(content);

/** The rows without the song parts that are RTF leftovers, and the arrangements without their ids. */
function withoutRtfLeftovers(rows: Json): Json {
  const parts = list(rows, 'song_parts');
  // The ids gone, as a Set holds them: a missing id equal to another missing one; an object only to itself, so the
  // part it is in goes by its place.
  const gone = parts.flatMap((p, i) => (rtfLeftover(p.content) ? [{ i, id: Object.hasOwn(p, 'id') ? p.id : undefined }] : []));
  if (!gone.length) return rows;
  const has = (id: unknown) => gone.some((g) => (g.id === undefined ? id === undefined : g.id === id && (g.id === null || typeof g.id !== 'object')));
  const kept = parts.filter((p, i) => !gone.some((g) => g.i === i) && !has(Object.hasOwn(p, 'id') ? p.id : undefined));
  const arrangements = list(rows, 'song_arrangements').map((a) =>
    withKey(a, 'part_ids', rewrite(a.part_ids, (v) => (Array.isArray(v) ? v.filter((id) => !has(id)) : v))),
  );
  return { ...rows, song_parts: kept, song_arrangements: arrangements };
}

/** The fields that keep a time each (schema 27, SYNC-R23) take it from the row's last change where they have none. */
function withFieldTimes(rows: Json): Json {
  const out = { ...rows };
  for (const [t, fields] of [['custom_slides', ['name', 'pages']], ['overlays', ['title', 'content']], ['themes', ['name', 'definition']]] as const) {
    out[t] = list(out, t).map((r) => fields.reduce((row, f) => withKey(row, `${f}_at`, row[`${f}_at`] ?? row.updated_at ?? null), r));
  }
  return out;
}

// ------------------------------------------------------------------ the blobs and the check

/** JSON text as JSON.parse reads it, an infinity null, as the schemas check it; undefined where it does not read. */
function read(json: string | null): unknown {
  const v = parseLegacyJson(json ?? '');
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) as unknown;
}

/** The blobs the rows name, each with the row that names it ("images {id}"), and which of them are videos. */
function blobs(rows: Json): { named: [string, string][]; videos: string[] } {
  const named: [string, string][] = [];
  const add = (row: string, hashes: unknown[]) => {
    for (const h of hashes) if (typeof h === 'string' && h) named.push([h, row]);
  };
  const label = (t: string, r: Json) => `${t} ${orderedString(r.id)}`;
  // Pages and definitions are checked as every reader checks them (custom-slides.ts, themes.ts): one that does not names no blobs.
  const pages = (json: unknown, many: boolean) => {
    const v = read(text(json));
    return customPageBlobs(many ? readCustomPages(v) : [readCustomPage(v)]);
  };
  for (const i of list(rows, 'images')) add(label('images', i), [i.full_hash, i.thumb_hash, i.original_full_hash, i.original_thumb_hash]);
  for (const a of list(rows, 'audios')) add(label('audios', a), [a.hash]);
  const videos = list(rows, 'videos');
  for (const v of videos) add(label('videos', v), [v.hash, v.still_hash, v.thumb_hash]);
  for (const m of list(rows, 'song_materials')) add(label('song_materials', m), [m.hash]);
  for (const c of list(rows, 'custom_slides')) add(label('custom_slides', c), pages(c.pages, true));
  for (const o of list(rows, 'overlays')) add(label('overlays', o), pages(o.content, false));
  for (const th of list(rows, 'themes')) add(label('themes', th), checkedThemeBlobs(read(text(th.definition))));
  return { named, videos: unique(videos.map((v) => orderedString(Object.hasOwn(v, 'hash') ? v.hash : undefined))) };
}

/**
 * The first row the server would refuse, named by its table and id (`legacyRowsProblem`): its columns must be exactly
 * the table's, with an id; an output's kind public or screen; a slideshow's pages that read; no slide deck item and
 * no Bible passage that does not read.
 */
function problem(rows: Json): string | null {
  const id = (r: Json) => orderedString(Object.hasOwn(r, 'id') ? r.id : undefined);
  for (const t of LEGACY_TABLES) {
    const columns = tableByName.get(t)!.columns;
    for (const r of list(rows, t)) {
      const mismatch = [...columns.filter((c) => !Object.hasOwn(r, c)).map((c) => `no ${c}`), ...Object.keys(r).filter((k) => !columns.includes(k)).map((k) => `unknown ${k}`)];
      const why = mismatch.length ? mismatch.join(', ') : typeof r.id === 'string' && r.id ? null : 'no id';
      if (why) return `${t} ${id(r)}: ${why}`;
    }
  }
  for (const d of list(rows, 'displays')) if (d.kind !== 'public' && d.kind !== 'screen') return `displays ${id(d)}: no kind "${orderedString(Object.hasOwn(d, 'kind') ? d.kind : undefined)}"`;
  for (const c of list(rows, 'custom_slides')) {
    if (!customPagesSchema.safeParse(read(text(c.pages))).success) return `custom_slides ${id(c)}: pages that do not read`;
  }
  for (const item of list(rows, 'presentation_items')) {
    if (item.type === 'slides') return `presentation_items ${id(item)}: a slide deck item, not a slideshow`;
    const content = text(item.content);
    if (item.type === 'bible' && !readBibleItemContent(content ? read(content) : undefined)) return `presentation_items ${id(item)}: a Bible passage that does not read`;
  }
  return null;
}

// ------------------------------------------------------------------ 1.x's overlay

/**
 * A 1.x overlay as a page (`legacyOverlayPage`), drawn as 1.x drew it: its picture over the whole stage, fitted, and
 * its text above it at the top left, white.
 */
function overlayPage(content: string | null, picture: unknown): Json {
  const t = content === null ? '' : cutChars(content.trim(), CUSTOM_LIMITS.text);
  const elements: Json[] = [];
  if (picture) elements.push({ id: 'image', kind: 'image', x: 0, y: 0, w: 1920, h: 1080, picture, fit: 'contain' });
  if (t) {
    const h = Math.min(1080 - 64, t.split('\n').length * 60);
    elements.push({ id: 'text', kind: 'text', x: 80, y: 32, w: 1760, h, text: t, size: 40, bold: false, italic: false, align: 'left', color: '#ffffff' });
  }
  return { background: null, backgroundPicture: null, backgroundPage: null, elements };
}
