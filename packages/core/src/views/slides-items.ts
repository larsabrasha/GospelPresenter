// What each item of a running order shows (ADR 0008; ported back from crates/gp-core/src/slides.rs and item_views.rs):
// readItemSlides's slides, the same objects, reading the library through the shell. The live views and the
// presentation page read a running order's slides through `itemsSlides`.
import { customPageText, parseCustomPages } from '../custom-slides.ts';
import { BIBLE_ITEM_LIMITS, BIBLE_LIMITS, type BibleItemContent, type BibleSegment } from '../bible.ts';
import { imageItemIds, parsePartIds, songOrder } from '../slides.ts';
import { readStoredJson } from '../stored-json.ts';
import { marks, type RunSql } from './sql.ts';
import { select } from './lists-rows.ts';
import { VIDEO, videoRow } from './lists-media.ts';
import { argsOf, asF64, asI64, asStr, charsAtMost, idOf, invalidArgs, isObj, strOrEmpty, type Obj } from './serde.ts';

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

/** Rows [id, …] in `songOrder`, their sort at `at`. */
const bySort = (at: number) => (a: unknown[], b: unknown[]) => songOrder({ sort: a[at], id: strOrEmpty(a[0]) }, { sort: b[at], id: strOrEmpty(b[0]) });

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
  const arranged = arrangement ? parsePartIds(strOrEmpty(arrangement[1]))
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

/** A Bible item's content as stored (`BibleItemContent`, JSON text): `readBibleItemContent` of it. */
export const bibleItemContent = (content: string | null): BibleItemContent | null => readBibleItemContent(content === null ? undefined : readStoredJson(content));

/**
 * A Bible item's content (`BibleItemContent`, D12, D25): its translation and its frozen slides, or null where they do
 * not read (a translation of at most 50 characters, at most 1000 slides of at most 500 runs, a verse number 0–999 or
 * null, a run's text of at most 10 000 characters). The export zip's check reads a 1.x or 2.0 item by it too.
 */
export function readBibleItemContent(c: unknown): BibleItemContent | null {
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

async function image(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const out: Shown[] = [];
  for (const [i, id] of imageItemIds(item).entries()) {
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

/** A video item's one slide, its video's row as Video lists it (`videoRow`: an unknown type is mp4, an unknown codec h264). */
async function video(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const [r] = await select(sql, VIDEO, 'videos WHERE id = ?', [item.sourceId]);
  if (!r) return none('video-missing');
  const row = videoRow(r);
  const shown = { ...slide('video', 'media', ''), image: row.stillHash, thumb: row.thumbHash, video: { hash: row.hash, type: row.contentType, codec: row.codec } };
  return { slides: [shown], problem: null, video: row };
}

/** A slideshow's slides, a page each, its pages checked (`parseCustomPages`); a PDF's page is a picture slide too. */
async function custom(item: SlideItem, sql: RunSql): Promise<ItemShown> {
  const r = (await sql('SELECT pages FROM custom_slides WHERE id = ?', [item.sourceId]))[0];
  if (!r) return none('custom-missing');
  const slides = parseCustomPages(asStr(r[0])).map((page, i) => {
    const pdf = page.backgroundPage;
    return { ...slide(`page${i}`, pdf ? 'media' : 'song', customPageText(page)), image: pdf?.full ?? null, thumb: pdf?.thumb ?? null, custom: page };
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
