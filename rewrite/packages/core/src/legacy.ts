import { z } from 'zod';
import { emailSchema } from './accounts.ts';
import { parseBibleContent } from './bible.ts';
import { parseSlidesContent } from './slides.ts';
import { tableByName } from './sync-sql.ts';

// The zip one organisation of the current app (1.x) is exported as, and the import that reads it
// (docs/import-from-1x.md). The export maps the old rows to the new tables, so what is here is only the
// shape of the file and the checks the server and the web app make on it.

/** Bumped when the zip's layout or a row's meaning changes; an import refuses a format it does not know. */
export const LEGACY_FORMAT = 1;

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
  for (const item of rows.presentation_items) {
    const content = typeof item.content === 'string' ? item.content : null;
    if (item.type === 'slides' && !parseSlidesContent(content)) return `presentation_items ${String(item.id)}: a slide deck that does not read`;
    if (item.type === 'bible' && !parseBibleContent(content)) return `presentation_items ${String(item.id)}: a Bible passage that does not read`;
  }
  return null;
}
