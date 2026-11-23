import { z } from 'zod';
import { emailSchema } from './accounts.ts';

// The zip one organisation is exported as: from the current app (1.x, docs/import-from-1x.md), whose export maps the
// old rows to the new tables, and from 2.0 itself (Inställningar → Organisationen → Exportera), whose rows are its own.
// What is here is the shape of the file. An older format's rows brought to this one, the blobs the rows name, the
// check the server and the export make, and 1.x's overlay as a page are the core's views (views/files-legacy.ts, through
// core.ts's upgradeLegacyRows, legacyBlobs, legacyRowsProblem and legacyOverlayPage).

/**
 * Bumped when the zip's layout or a row's meaning changes; an import refuses a format it does not know. 2: an overlay
 * is a page (docs/custom-slides.md). 3: a slide deck is a row of `slide_decks`, which its item names. 4: a slide
 * deck is a slideshow (`custom_slides`) of PDF pages, which its item names as one. 5: a page's pictures are its own
 * blobs, not pictures of Bilder by id. 6: an item has a comment (`note`, spec 03 2f). 7: a picture may be edited, its
 * original kept (MEDIA-R19). 8: 2.0's own export, with videos, own themes and song materials (2026-11-08). An import
 * reads the older ones too (the core's upgrade).
 */
export const LEGACY_FORMAT = 8;

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
  'themes',
  'bibles',
  'images',
  'audios',
  'videos',
  'overlays',
  'displays',
  'songs',
  'song_parts',
  'song_arrangements',
  'song_versions',
  'song_materials',
  'presentations',
  'custom_slides',
  'presentation_items',
  'ccli_entries',
] as const;
type LegacyTable = (typeof LEGACY_TABLES)[number];
/** The tables only format 8 has: a zip of an older one holds none of them. */
export const TABLES_SINCE_8 = ['themes', 'videos', 'song_materials'] as const satisfies readonly LegacyTable[];

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
 * The formats an import reads: this one, 4 (pictures of Bilder by id on a page), 3 (decks of their own), 2 (decks on
 * their items), 1 (overlays of a text and a picture too).
 */
export const LEGACY_FORMATS_READ: readonly number[] = [1, 2, 3, 4, 5, 6, 7, LEGACY_FORMAT];

/** What the server answers when it refuses an import, with a `detail` naming the row. */
export type LegacyImportRefusal = 'invalid-rows' | 'missing-media' | 'missing-bible' | 'write-failed';
