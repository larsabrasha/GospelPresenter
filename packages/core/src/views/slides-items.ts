// What each item of a running order shows (ADR 0008; ported back from crates/gp-core/src/slides.rs and item_views.rs):
// readItemSlides's slides, the same objects, reading the library through the shell. The live views and the
// presentation page read a running order's slides through `itemsSlides`.
import { blankPage } from '../custom-slides.ts';
import { BIBLE_ITEM_LIMITS, BIBLE_LIMITS, type BibleItemContent, type BibleSegment } from '../bible.ts';
import { MAX_ITEM_IMAGE_ID, MAX_ITEM_IMAGES } from '../slides.ts';
import { marks, type RunSql } from './sql.ts';
import { argsOf, asF64, asI64, asStr, byCodePoint, charsAtMost, idOf, invalidArgs, isObj, parseJson, strOrEmpty, type Obj } from './serde.ts';

/** An item as the slides read it. */
export interface SlideItem {
  kind: string;
  title: string;
  sourceId: string;
  arrangementId: string | null;
  content: string | null;
}

/** A slide as the Rust core builds it: its fields, then what its kind adds. */
type Shown = Record<string, unknown>;
/** An item's slides and why it has none (`ItemSlides`), and an audio or video item's file. */
export type ItemShown = { slides: Shown[]; problem: string | null } & Record<string, unknown>;

const slide = (key: string, kind: string, text: string): Shown => ({ key, kind, text, verses: null, image: null, label: null, credits: null });
const none = (problem: string): ItemShown => ({ slides: [], problem });
const some = (slides: Shown[], empty: string | null): ItemShown => ({ slides, problem: slides.length ? null : empty });

/** `songCredits`: "Author · © Publisher · Year", the missing pieces dropped; null if there are none. */
function songCredits(author: unknown, publisher: unknown, year: unknown): string | null {
  const p = asStr(publisher);
  const y = asI64(year);
  const kept = [asStr(author), p ? `© ${p}` : null, y ? String(y) : null].filter((x): x is string => x !== null && x.trim() !== '');
  return kept.length ? kept.join(' · ') : null;
}

/** `parsePartIds`: an arrangement's part ids; anything else reads as empty. */
function partIds(text: string): string[] {
  const v = parseJson(text);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** What song items read, for every song of a running order at once, each row without its song's id. */
interface Songs {
  songs: Map<string, unknown[]>;
  parts: Map<string, unknown[][]>;
  arrangements: Map<string, unknown[][]>;
}

async function bySong(sql: RunSql, statement: string, ids: string[]): Promise<Map<string, unknown[][]>> {
  const out = new Map<string, unknown[][]>();
  for (const r of await sql(statement.replace('{}', marks(ids.length)), ids)) {
    const k = strOrEmpty(r[0]);
    out.set(k, [...(out.get(k) ?? []), r.slice(1)]);
  }
  return out;
}

async function songsOf(sql: RunSql, ids: string[]): Promise<Songs> {
  if (!ids.length) return { songs: new Map(), parts: new Map(), arrangements: new Map() };
  const songs = new Map([...(await bySong(sql, 'SELECT id, deleted_at, author, publisher, year FROM songs WHERE id IN ({})', ids))].map(([k, v]) => [k, v.at(-1)!]));
  const parts = await bySong(sql, 'SELECT song_id, id, sort, label_id, content FROM song_parts WHERE song_id IN ({})', ids);
  const arrangements = await bySong(sql, 'SELECT song_id, id, part_ids, sort FROM song_arrangements WHERE song_id IN ({})', ids);
  return { songs, parts, arrangements };
}

/** The labels, by id, as a slide carries one. */
async function labelsOf(sql: RunSql): Promise<Map<string, { text: unknown; color: unknown }>> {
  return new Map((await sql('SELECT id, text, color FROM labels', [])).map((r) => [strOrEmpty(r[0]), { text: r[1], color: r[2] }]));
}

/** By `sort` as an integer (none first), then by id. */
const bySort = (at: number) => (a: unknown[], b: unknown[]) => {
  const [x, y] = [asI64(a[at]), asI64(b[at])];
  if (x !== y) return x === null ? -1 : y === null ? 1 : x - y;
  return byCodePoint(strOrEmpty(a[0]), strOrEmpty(b[0]));
};

/** `songSlides`: one slide per arranged part (SONG-R18, R19), a repeated part keyed `id#n`. */
function song(item: SlideItem, labels: Map<string, unknown>, data: Songs): ItemShown {
  const row = data.songs.get(item.sourceId);
  if (!row) return none('song-missing');
  if (row[0] !== null) return none('song-trashed'); // D17: skipped live
  const credits = songCredits(row[1], row[2], row[3]);
  const parts = (data.parts.get(item.sourceId) ?? []).toSorted(bySort(1));
  const arrangements = (data.arrangements.get(item.sourceId) ?? []).toSorted(bySort(2));
  const wanted = item.arrangementId ?? (arrangements[0] ? strOrEmpty(arrangements[0][0]) : null);
  const arrangement = wanted === null ? undefined : arrangements.find((a) => strOrEmpty(a[0]) === wanted);
  const arranged = arrangement ? partIds(strOrEmpty(arrangement[1]))
        .map((id) => parts.find((p) => strOrEmpty(p[0]) === id))
        .filter((p) => p !== undefined) : parts;
  const seen = new Map<string, number>();
  const slides = arranged.map((p) => {
    const id = strOrEmpty(p[0]);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    const label = asStr(p[2]);
    return { ...slide(n ? `${id}#${n}` : id, 'song', strOrEmpty(p[3])), label: (label !== null && labels.get(label)) || null, credits };
  });
  return some(slides, 'no-parts');
}

/**
 * A Bible item's content (`BibleItemContent`, D12, D25): its translation and its frozen slides, or null where they do
 * not read (a translation of at most 50, at most 1000 slides of at most 500 runs, a verse number 0–999 or null).
 */
export function bibleItemContent(content: string | null): BibleItemContent | null {
  const c = content === null ? undefined : parseJson(content);
  if (!isObj(c)) return null;
  const translation = asStr(c.translation);
  if (translation === null || !charsAtMost(translation, BIBLE_ITEM_LIMITS.translation) || !Array.isArray(c.slides) || c.slides.length > BIBLE_ITEM_LIMITS.slides) return null;
  const slides: BibleSegment[][] = [];
  for (const runs of c.slides as unknown[]) {
    if (!Array.isArray(runs) || runs.length > BIBLE_ITEM_LIMITS.runs) return null;
    const read: BibleSegment[] = [];
    for (const r of runs as unknown[]) {
      if (!isObj(r) || !('n' in r)) return null;
      const n = r.n === null ? null : asF64(r.n);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 999)) return null;
      if (r.n !== null && n === null) return null;
      if (typeof r.t !== 'string' || !charsAtMost(r.t, BIBLE_LIMITS.verseLength)) return null;
      read.push({ n, t: r.t });
    }
    slides.push(read);
  }
  return { translation, slides };
}

/** `bibleItemSlides`: the frozen slides, each run with its verse number if it starts a verse. */
export function bibleItemSlides(item: SlideItem): ItemShown {
  const content = bibleItemContent(item.content);
  if (!content) return some([], 'no-parts');
  const credits = content.translation ? `${item.title} · ${content.translation}` : item.title;
  const slides = content.slides.map((runs, i) => ({
    ...slide(`b${i}`, 'bible', runs.map(({ n, t }) => (n === null ? t : t ? `${n} ${t}` : String(n))).join(' ')),
    verses: runs,
    credits,
  }));
  return some(slides, 'no-parts');
}

/** `imageItemIds`: an image item's pictures, by library id; one made before there could be several shows its source. */
function imageIds(item: SlideItem): string[] {
  const v = item.content ? parseJson(item.content) : undefined;
  const images = isObj(v) ? v.images : undefined;
  const fits = (x: unknown) => typeof x === 'string' && x.length > 0 && charsAtMost(x, MAX_ITEM_IMAGE_ID);
  return Array.isArray(images) && images.length >= 1 && images.length <= MAX_ITEM_IMAGES && images.every(fits) ? (images as string[]) : [item.sourceId];
}

async function image(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const out: Shown[] = [];
  for (const [i, id] of imageIds(item).entries()) {
    // A trashed picture still shows (MEDIA-R8); a purged one is gone.
    const r = (await sql('SELECT full_hash, thumb_hash FROM images WHERE id = ?', [id]))[0];
    if (r) out.push({ ...slide(`image${i}`, 'media', ''), image: r[0], thumb: r[1] });
  }
  return out.length ? some(out, null) : none('image-missing');
}

async function audio(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const r = (await sql('SELECT hash, file_name FROM audios WHERE id = ?', [item.sourceId]))[0];
  if (!r) return none('audio-missing');
  return { slides: [{ ...slide('audio', 'media', ''), audio: { name: r[1] } }], problem: null, audio: { hash: r[0], fileName: r[1] } };
}

const VIDEO_COLUMNS = ['id', 'file_name', 'content_type', 'codec', 'hash', 'size', 'duration', 'width', 'height', 'still_hash', 'thumb_hash', 'created_at', 'deleted_at'];
const camel = (column: string) => column.replace(/_(.)/g, (_, c: string) => c.toUpperCase());

async function video(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const r = (await sql(`SELECT ${VIDEO_COLUMNS.join(', ')} FROM videos WHERE id = ?`, [item.sourceId]))[0];
  if (!r) return none('video-missing');
  const row = Object.fromEntries(VIDEO_COLUMNS.map((c, i) => [camel(c), r[i]]));
  const shown = { ...slide('video', 'media', ''), image: row.stillHash, thumb: row.thumbHash, video: { hash: row.hash, type: row.contentType, codec: row.codec } };
  return { slides: [shown], problem: null, video: row };
}

const field = (v: unknown, k: string): unknown => (isObj(v) ? (v[k] ?? null) : null);

/** `customPageText`: a page's texts top to bottom, then left to right, one to a line. */
function pageText(page: unknown): string {
  const elements = field(page, 'elements');
  const num = (e: unknown, k: string) => asF64(field(e, k)) ?? 0;
  const text = (e: unknown) => (asStr(field(e, 'text')) ?? '').trim();
  const texts = Array.isArray(elements) ? elements.filter((e) => field(e, 'kind') === 'text' && text(e) !== '') : [];
  return texts
    .toSorted((a, b) => num(a, 'y') - num(b, 'y') || num(a, 'x') - num(b, 'x'))
    .map(text)
    .join('\n');
}

async function custom(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const r = (await sql('SELECT pages FROM custom_slides WHERE id = ?', [item.sourceId]))[0];
  if (!r) return none('custom-missing');
  // A page a slide; a PDF's page is a picture slide too. Not checked against the schema, as the Rust core did not.
  const read = parseJson(strOrEmpty(r[0]));
  const pages = Array.isArray(read) && read.length ? read : [blankPage()];
  const slides = pages.map((page: unknown, i) => {
    const pdf = field(page, 'backgroundPage');
    return { ...slide(`page${i}`, pdf !== null ? 'media' : 'song', pageText(page)), image: field(pdf, 'full'), thumb: field(pdf, 'thumb'), custom: page };
  });
  return some(slides, null);
}

/** An item's slides and why it has none; any other kind is read as a song is. */
function itemSlides(item: SlideItem, labels: Map<string, unknown>, songs: Songs, sql: RunSql): ItemShown | Promise<ItemShown> {
  switch (item.kind) {
    case 'header':
      return some([], null); // a heading shows nothing: presenting steps over it (spec 03 2f)
    case 'bible':
      return bibleItemSlides(item);
    case 'audio':
      return audio(item, sql);
    case 'video':
      return video(item, sql);
    case 'custom':
      return custom(item, sql);
    case 'image':
      return image(item, sql);
    default:
      return song(item, labels, songs);
  }
}

/** Every item's slides and why one has none, in the items' order (`readItemSlides`): the songs read together, once. */
export async function itemsSlides(items: SlideItem[], sql: RunSql): Promise<ItemShown[]> {
  const labels = await labelsOf(sql);
  const songs = await songsOf(sql, [...new Set(items.filter((i) => i.kind === 'song').map((i) => i.sourceId))]);
  const out: ItemShown[] = [];
  for (const item of items) out.push(await itemSlides(item, labels, songs, sql));
  return out;
}

/** `itemSlidesView` {items: [{id, type, title, sourceId, arrangementId, content}]}: each item's slides and why it has none, by item id. */
export async function itemSlidesView(args: unknown, sql: RunSql): Promise<Record<string, ItemShown>> {
  const rows = argsOf(args).items;
  if (!Array.isArray(rows)) throw invalidArgs();
  const ids: string[] = [];
  const items: SlideItem[] = [];
  for (const r of rows as unknown[]) {
    if (!isObj(r)) throw invalidArgs();
    const o: Obj = r;
    ids.push(idOf(o, 'id'));
    const kind = asStr(o.type);
    if (kind === null) throw invalidArgs();
    items.push({ kind, title: strOrEmpty(o.title), sourceId: strOrEmpty(o.sourceId), arrangementId: asStr(o.arrangementId), content: asStr(o.content) });
  }
  return Object.fromEntries((await itemsSlides(items, sql)).map((shown, i) => [ids[i]!, shown]));
}
