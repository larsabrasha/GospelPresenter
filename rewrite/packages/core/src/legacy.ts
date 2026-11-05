import { z } from 'zod';
import { emailSchema } from './accounts.ts';
import { parseBibleContent } from './bible.ts';
import { blankPage, CUSTOM_LIMITS, customPagesSchema, pdfPages, type CustomElement, type CustomPage, type Picture } from './custom-slides.ts';
import { slideDeckPagesSchema } from './slides.ts';
import { tableByName } from './sync-sql.ts';
import { CANVAS } from './themes.ts';

// The zip one organisation of the current app (1.x) is exported as, and the import that reads it
// (docs/import-from-1x.md). The export maps the old rows to the new tables, so what is here is only the
// shape of the file and the checks the server and the web app make on it.

/**
 * Bumped when the zip's layout or a row's meaning changes; an import refuses a format it does not know. 2: an overlay
 * is a page (docs/custom-slides.md). 3: a slide deck is a row of `slide_decks`, which its item names. 4: a slide
 * deck is a slideshow (`custom_slides`) of PDF pages, which its item names as one. 5: a page's pictures are its own
 * blobs, not pictures of Bilder by id. 6: an item has a comment (`note`, spec 03 2f). 7: a picture may be edited, its
 * original kept (MEDIA-R19). An import reads the older ones too (`upgradeLegacyRows`).
 */
export const LEGACY_FORMAT = 7;

/** The zip's entries: the manifest, the users, one file of rows per table, the Bible texts and the blobs. */
export const LEGACY_ENTRIES = {
  manifest: 'manifest.json',
  users: 'users.json',
  rows: (table: string) => `rows/${table}.json`,
  bible: (hash: string) => `bibles/${hash}.json`,
  blob: (hash: string) => `blobs/${hash}`,
} as const;

/** The tables an import writes, parents before the rows that name them. */
export const LEGACY_TABLES = [
  'labels',
  'org_settings',
  'bibles',
  'images',
  'audios',
  'overlays',
  'displays',
  'songs',
  'song_parts',
  'song_arrangements',
  'song_versions',
  'presentations',
  'custom_slides',
  'presentation_items',
  'ccli_entries',
] as const;
type LegacyTable = (typeof LEGACY_TABLES)[number];

/** At most this many rows of one table: far above a church's, so a damaged file is refused rather than read. */
const MAX_ROWS = 200_000;

const cell = z.union([z.string(), z.number(), z.null()]);
const rowSchema = z.record(z.string(), cell);
export type LegacyRow = z.infer<typeof rowSchema>;

export const legacyRowsSchema = z.object(Object.fromEntries(LEGACY_TABLES.map((t) => [t, z.array(rowSchema).max(MAX_ROWS)])) as Record<LegacyTable, z.ZodArray<typeof rowSchema>>);
export type LegacyRows = z.infer<typeof legacyRowsSchema>;

export const legacyManifestSchema = z.object({
  format: z.number().int(),
  orgName: z.string().max(200),
  exportedAt: z.number().int(),
  /** Rows per table and the number of blobs and Bible texts, for the import's progress. */
  counts: z.record(z.string(), z.number().int().min(0)),
});
export type LegacyManifest = z.infer<typeof legacyManifestSchema>;

/**
 * A user of the old organisation: 1.x's `Admin` and `SuperAdmin` are admins here, `User` a user. `google`
 * holds the subjects of their Google logins, so their first sign-in finds the account (AUTH-R4 matches by subject).
 */
const legacyUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: emailSchema,
  role: z.enum(['user', 'admin']),
  google: z.array(z.string().min(1).max(255)).max(10),
});
export type LegacyUser = z.infer<typeof legacyUserSchema>;
export const legacyUsersSchema = z.array(legacyUserSchema).max(1000);

/**
 * A 1.x overlay as a page (docs/custom-slides.md), drawn as 1.x drew it: its picture over the whole stage, fitted,
 * and its text above it at the top left, white. The picture is the overlay's own.
 */
export function legacyOverlayPage(content: string | null, picture: Picture | null): CustomPage {
  const text = content?.trim().slice(0, CUSTOM_LIMITS.text) ?? '';
  const elements: CustomElement[] = [];
  if (picture) elements.push({ id: 'image', kind: 'image', x: 0, y: 0, w: CANVAS.width, h: CANVAS.height, picture, fit: 'contain' });
  if (text) {
    const h = Math.min(CANVAS.height - 64, text.split('\n').length * 60);
    elements.push({ id: 'text', kind: 'text', x: 80, y: 32, w: CANVAS.width - 160, h, text, size: 40, bold: false, italic: false, align: 'left', color: '#ffffff' });
  }
  return { ...blankPage(), elements };
}

/**
 * The formats an import reads: this one, 4 (pictures of Bilder by id on a page), 3 (decks of their own), 2 (decks on
 * their items), 1 (overlays of a text and a picture too).
 */
export const LEGACY_FORMATS_READ: readonly number[] = [1, 2, 3, 4, 5, 6, LEGACY_FORMAT];

const text = (v: LegacyRow[string] | undefined) => (typeof v === 'string' ? v : null);
/** A deck item's content before format 3: the file's name and its pages. */
const deckContentSchema = z.object({ pages: slideDeckPagesSchema });

/** A slideshow row of a PDF's pages, as schema 21 made them of the decks already here. */
const slideshowRow = (id: LegacyRow[string] | undefined, name: LegacyRow[string] | undefined, pages: unknown): LegacyRow => ({
  id: id ?? null,
  name: name ?? null,
  pages: JSON.stringify(pdfPages(slideDeckPagesSchema.parse(pages))),
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
});

type Json = Record<string, unknown>;

/**
 * A page of a zip before format 5 as this format has it: a picture of Bilder named by id (`imageId`,
 * `backgroundImageId`) becomes the page's own blobs, those of the zip's picture; one the zip lacks is left out.
 */
function ownPictures(page: unknown, images: Map<string, Picture>): unknown {
  if (!page || typeof page !== 'object') return page;
  const { backgroundImageId, elements, ...rest } = page as Json;
  const own = (e: unknown) => {
    const el = e as Json;
    if (el?.kind !== 'image' || !('imageId' in el)) return [e];
    const picture = images.get(String(el.imageId));
    return picture ? [{ ...Object.fromEntries(Object.entries(el).filter(([k]) => k !== 'imageId')), picture }] : [];
  };
  return {
    ...rest,
    ...(backgroundImageId !== undefined ? { backgroundPicture: images.get(String(backgroundImageId)) ?? null } : {}),
    backgroundPage: rest.backgroundPage ?? null,
    elements: Array.isArray(elements) ? elements.flatMap(own) : elements,
  };
}

/** A row's page JSON, or pages JSON, through `fn`; one that does not read is left for legacyRowsProblem to name. */
function rewrite(json: LegacyRow[string] | undefined, fn: (v: unknown) => unknown): LegacyRow[string] {
  try {
    return JSON.stringify(fn(JSON.parse(text(json) ?? '')));
  } catch {
    return json ?? null;
  }
}

/** The rows of a zip before format 4: `custom_slides` missing, `slide_decks` there in 3. */
type OlderRows = Omit<LegacyRows, 'custom_slides'> & { custom_slides?: LegacyRow[]; slide_decks?: LegacyRow[] };

/**
 * A zip's rows as this format has them. Before 4 a deck's pages become a slideshow of PDF pages that its item
 * names: in 3 each `slide_decks` row, before 3 each deck item's own pages, as the item's id. Before 5 a page's
 * pictures of Bilder become its own (`ownPictures`). Before 6 an item has no comment. Before 7 no picture is edited.
 */
export function upgradeLegacyRows(format: number, rows: OlderRows): LegacyRows {
  const { slide_decks: decks = [], custom_slides: slideshows = [], ...given } = rows;
  const unedited = (i: LegacyRow): LegacyRow => ({ ...i, original_full_hash: null, original_thumb_hash: null, original_width: null, original_height: null, edit: null });
  const commented = format >= 6 ? given : { ...given, presentation_items: given.presentation_items.map((item): LegacyRow => ({ ...item, note: null })) };
  const rest = format >= 7 ? commented : { ...commented, images: commented.images.map(unedited) };
  if (format >= 5) return { ...rest, custom_slides: slideshows };
  const images = new Map(rest.images.map((i) => [String(i.id), { full: String(i.full_hash), thumb: String(i.thumb_hash) }]));
  const pages = (r: LegacyRow): LegacyRow => ({ ...r, pages: rewrite(r.pages, (v) => (Array.isArray(v) ? v.map((p) => ownPictures(p, images)) : v)) });
  if (format === 4) {
    return { ...rest, overlays: rest.overlays.map((o) => ({ ...o, content: rewrite(o.content, (v) => ownPictures(v, images)) })), custom_slides: slideshows.map(pages) };
  }
  const made: LegacyRow[] = [];
  for (const d of decks) {
    try {
      made.push(slideshowRow(d.id, d.name, JSON.parse(text(d.pages) ?? '')));
    } catch {
      made.push({ ...d, pages: null }); // left for legacyRowsProblem to name
    }
  }
  const items = rest.presentation_items.map((item) => {
    if (item.type !== 'slides') return item;
    if (format >= 3) return { ...item, type: 'custom' };
    try {
      made.push(slideshowRow(item.id, item.title, deckContentSchema.parse(JSON.parse(text(item.content) ?? '')).pages));
    } catch {
      return item; // left for legacyRowsProblem to name
    }
    return { ...item, type: 'custom', source_id: item.id ?? null, content: null };
  });
  const overlays =
    format === 1
      ? rest.overlays.map((o) => ({
          id: o.id ?? null,
          title: o.title ?? null,
          content: JSON.stringify(legacyOverlayPage(text(o.content), images.get(String(o.image_id)) ?? null)),
          image_id: null,
          sort: o.sort ?? null,
          updated_at: null,
        }))
      : rest.overlays.map((o) => ({ ...o, content: rewrite(o.content, (v) => ownPictures(v, images)) }));
  return { ...rest, overlays, presentation_items: items, custom_slides: made };
}

const readsAsPages = (json: string | null) => {
  try {
    return customPagesSchema.safeParse(JSON.parse(json ?? '')).success;
  } catch {
    return false;
  }
};

/** What the server answers when it refuses an import, with a `detail` naming the row. */
export type LegacyImportRefusal = 'invalid-rows' | 'missing-media' | 'missing-bible' | 'write-failed';

/**
 * Why a row does not fit its table, or null: it must name exactly the table's columns. A song version's
 * `user_id` is the importing admin's, set by the server, as 1.x does not record whose change it was.
 */
function legacyRowProblem(table: LegacyTable, row: LegacyRow): string | null {
  const columns = tableByName.get(table)!.columns;
  const keys = Object.keys(row);
  const missing = columns.filter((c) => !(c in row));
  const extra = keys.filter((k) => !columns.includes(k));
  if (missing.length || extra.length) return [...missing.map((c) => `no ${c}`), ...extra.map((c) => `unknown ${c}`)].join(', ');
  if (typeof row.id !== 'string' || !row.id) return 'no id';
  return null;
}

/**
 * The first row the server would refuse, named by its table and id, or null. The export checks its rows with
 * this before it writes a zip, and the server again before it writes them.
 */
export function legacyRowsProblem(rows: LegacyRows): string | null {
  for (const t of LEGACY_TABLES) {
    for (const r of rows[t]) {
      const problem = legacyRowProblem(t, r);
      if (problem) return `${t} ${String(r.id)}: ${problem}`;
    }
  }
  // An output's code is not checked: one 2.0 does not use (1.x let a code be typed, "scene") gets a new one.
  for (const d of rows.displays) if (d.kind !== 'public' && d.kind !== 'screen') return `displays ${String(d.id)}: no kind "${String(d.kind)}"`;
  for (const c of rows.custom_slides) if (!readsAsPages(text(c.pages))) return `custom_slides ${String(c.id)}: pages that do not read`;
  for (const item of rows.presentation_items) {
    const content = typeof item.content === 'string' ? item.content : null;
    if (item.type === 'slides') return `presentation_items ${String(item.id)}: a slide deck item, not a slideshow`;
    if (item.type === 'bible' && !parseBibleContent(content)) return `presentation_items ${String(item.id)}: a Bible passage that does not read`;
  }
  return null;
}
