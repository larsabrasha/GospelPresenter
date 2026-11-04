// An organisation's database as SQL: its version, the hand-written DDL of the tables in `schema.ts`, and the
// migrations that bring an older database up to date.

/** Bumped whenever a synced table changes shape; part of the pull cookie's scope. */
export const SCHEMA_VERSION = 21;

/**
 * The first version `orgDdl` makes. The migrations from milestone 1 on were
 * dropped before the first release (2026-10-29): a database made before then
 * is not brought up to date. The numbering goes on from there rather than
 * starting again at 1, so such a database is never taken for a current one.
 */
export const SCHEMA_BASELINE = 11;

/**
 * The indexes of the reads that run most: a presentation's items, a song's
 * parts and arrangements (the editor, live, and the foreign key checks when a
 * song or presentation is deleted), and the items that show a song (D17).
 */
export const orgIndexes: string[] = [
  'CREATE INDEX IF NOT EXISTS presentation_items_by_presentation ON presentation_items (presentation_id, sort)',
  'CREATE INDEX IF NOT EXISTS presentation_items_by_source ON presentation_items (source_id)',
  'CREATE INDEX IF NOT EXISTS song_parts_by_song ON song_parts (song_id, sort)',
  'CREATE INDEX IF NOT EXISTS song_arrangements_by_song ON song_arrangements (song_id, sort)',
];

const songVersionsDdl = [
  `CREATE TABLE IF NOT EXISTS song_versions (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
     user_id TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS song_versions_by_song ON song_versions (song_id, created_at)',
];

const songMaterialsDdl = [
  `CREATE TABLE IF NOT EXISTS song_materials (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
     kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT, hash TEXT, content_type TEXT, size INTEGER, sort INTEGER NOT NULL,
     created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS song_materials_by_song ON song_materials (song_id, sort)',
];

const ccliEntriesDdl = `CREATE TABLE IF NOT EXISTS ccli_entries (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL, song_name TEXT NOT NULL,
     ccli TEXT NOT NULL, presentation_id TEXT NOT NULL, presentation_name TEXT NOT NULL, date TEXT NOT NULL, reported_at INTEGER)`;

const customSlidesDdl = `CREATE TABLE IF NOT EXISTS custom_slides (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, pages TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`;

const slideDecksDdl = `CREATE TABLE IF NOT EXISTS slide_decks (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, pages TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`;

const videosDdl = `CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     codec TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, duration INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     still_hash TEXT NOT NULL, thumb_hash TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER)`;

const videoFilesDdl = `CREATE TABLE IF NOT EXISTS video_files (hash TEXT PRIMARY KEY NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL,
     used_at INTEGER NOT NULL)`;

// Hand-written DDL of the current version: the columns must match the Drizzle
// tables in schema.ts, which a test checks. A database made by an older version is
// brought up to date by `orgMigrations` instead (see `orgSchemaPlan`).
export const orgDdl: string[] = [
  `CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL,
     sort INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, author TEXT,
     publisher TEXT, year INTEGER, ccli TEXT, deleted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS song_parts (id TEXT PRIMARY KEY NOT NULL,
     song_id TEXT NOT NULL REFERENCES songs(id), sort INTEGER NOT NULL,
     label_id TEXT REFERENCES labels(id), content TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS song_arrangements (id TEXT PRIMARY KEY NOT NULL,
     song_id TEXT NOT NULL REFERENCES songs(id), name TEXT, part_ids TEXT NOT NULL, sort INTEGER NOT NULL)`,
  ...songVersionsDdl,
  ...songMaterialsDdl,
  ccliEntriesDdl,
  `CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, event_date TEXT,
     deleted_at INTEGER, theme_id TEXT, is_template INTEGER NOT NULL DEFAULT 0, weekday INTEGER, time TEXT,
     location TEXT, last_used_at INTEGER, description TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS presentation_items (id TEXT PRIMARY KEY NOT NULL,
     presentation_id TEXT NOT NULL REFERENCES presentations(id), type TEXT NOT NULL, title TEXT NOT NULL,
     source_id TEXT NOT NULL, sort INTEGER NOT NULL, arrangement_id TEXT, content TEXT, overlay_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS bibles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, abbreviation TEXT NOT NULL,
     language TEXT, verse_count INTEGER NOT NULL, content_hash TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS org_settings (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     full_hash TEXT NOT NULL, thumb_hash TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     created_at INTEGER NOT NULL, deleted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS displays (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS audios (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     hash TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS overlays (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, content TEXT, image_id TEXT,
     sort INTEGER NOT NULL, updated_at INTEGER)`,
  videosDdl,
  // Not synced: what this database keeps for itself (see the tables in schema.ts).
  `CREATE TABLE IF NOT EXISTS bible_texts (hash TEXT NOT NULL, book TEXT NOT NULL, sort INTEGER NOT NULL, chunk TEXT NOT NULL,
     PRIMARY KEY (hash, book))`,
  `CREATE TABLE IF NOT EXISTS bible_blobs (hash TEXT PRIMARY KEY NOT NULL, verse_count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS media_blobs (hash TEXT PRIMARY KEY NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
     bytes BLOB, received_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pinned_presentations (id TEXT PRIMARY KEY NOT NULL, pinned_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kept_bibles (id TEXT PRIMARY KEY NOT NULL, kept_at INTEGER NOT NULL)`,
  videoFilesDdl,
  customSlidesDdl,
  ...orgIndexes,
];

/** The statements that take a database from version `n - 1` to `n`, for every `n` above SCHEMA_BASELINE. */
export const orgMigrations: Record<number, string[]> = {
  // A presentation's description (spec 03) and when it was last changed; when an output was made; the indexes (`orgIndexes`).
  12: ['ALTER TABLE presentations ADD COLUMN description TEXT', 'ALTER TABLE presentations ADD COLUMN updated_at INTEGER', 'ALTER TABLE displays ADD COLUMN created_at INTEGER', ...orgIndexes],
  // The video library (TODO.md "Video").
  13: [videosDdl],
  // The videos a device keeps whole, for its presentations kept offline (not synced).
  14: [videoFilesDdl],
  // Song history (SONG-R20–R23, D9).
  15: songVersionsDdl,
  // The CCLI report (SONG-R48–R52).
  16: [ccliEntriesDdl],
  // Sheet music and links on a song (spec 02 "Song material").
  17: songMaterialsDdl,
  // Custom slides (docs/custom-slides.md).
  18: [customSlidesDdl],
  // Overlays as a custom slide's page (docs/custom-slides.md): the overlays of before are dropped, and the items
  // that carried one carry none (Lars, 2026-11-04).
  19: ['DELETE FROM overlays', 'UPDATE presentation_items SET overlay_id = NULL WHERE overlay_id IS NOT NULL', 'ALTER TABLE overlays ADD COLUMN updated_at INTEGER'],
  // Slide decks in a library (docs/media-and-files.md "Slide decks"): each deck item's pages become a deck of the
  // item's id, named as the item, which the item then names. The same on every device and the server, so the
  // rows agree before they sync.
  20: [
    slideDecksDdl,
    `INSERT OR IGNORE INTO slide_decks (id, name, pages, created_at, updated_at, deleted_at)
       SELECT id, title, json_extract(content, '$.pages'), 0, 0, NULL FROM presentation_items
       WHERE type = 'slides' AND (CASE WHEN json_valid(content) THEN json_array_length(content, '$.pages') ELSE 0 END) > 0`,
    `UPDATE presentation_items SET source_id = id, content = NULL WHERE type = 'slides'`,
  ],
  // One kind of slideshow (Bildspel, docs/custom-slides.md): each deck becomes a slideshow of its id whose pages
  // have the PDF's pages as their pictures, its items name it as a slideshow, and the decks' table goes.
  21: [
    `INSERT OR IGNORE INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at)
       SELECT d.id, d.name,
         (SELECT json_group_array(json_object('background', '#000000', 'backgroundImageId', NULL,
            'backgroundPage', json_object('full', json_extract(j.value, '$.full'), 'thumb', json_extract(j.value, '$.thumb')),
            'elements', json('[]'))) FROM json_each(d.pages) j),
         d.created_at, d.updated_at, d.deleted_at
       FROM slide_decks d`,
    `UPDATE presentation_items SET type = 'custom' WHERE type = 'slides'`,
    'DROP TABLE slide_decks',
  ],
};

/** Where a database records its schema version. One made before versions were recorded has no row. */
export const schemaMetaDdl = `CREATE TABLE IF NOT EXISTS _schema (one INTEGER PRIMARY KEY CHECK (one = 1), version INTEGER NOT NULL)`;

/**
 * What to run, in one transaction, to bring an organisation database to
 * SCHEMA_VERSION. `version` is the row in `_schema` (null when there is none)
 * and `hasTables` whether the synced tables exist yet.
 */
export function orgSchemaPlan(version: number | null, hasTables: boolean): string[] {
  if (version === null && !hasTables) return [...orgDdl, `INSERT OR REPLACE INTO _schema (one, version) VALUES (1, ${SCHEMA_VERSION})`];
  if (version === null || version < SCHEMA_BASELINE)
    throw new Error(`the database has schema ${version ?? 'from before versions were recorded'}, made before this app's first, ${SCHEMA_BASELINE}: delete it and start again`);
  if (version > SCHEMA_VERSION) throw new Error(`the database has schema ${version}, newer than this app's ${SCHEMA_VERSION}`);
  if (version === SCHEMA_VERSION) return [];
  const steps: string[] = [];
  for (let v = version + 1; v <= SCHEMA_VERSION; v++) steps.push(...orgMigrations[v]!);
  steps.push(`INSERT OR REPLACE INTO _schema (one, version) VALUES (1, ${SCHEMA_VERSION})`);
  return steps;
}

/** The two reads `orgSchemaPlan` needs, as SQL: run after `schemaMetaDdl`. */
export const schemaStateSql = {
  version: 'SELECT version FROM _schema WHERE one = 1',
  hasTables: "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'songs'",
};

type Rows = Record<string, unknown>[];

function planFor(versionRows: Rows, tableRows: Rows): string[] {
  const version = versionRows[0] ? Number(versionRows[0].version) : null;
  return orgSchemaPlan(version, Number(tableRows[0]?.n ?? 0) > 0);
}

/**
 * Brings an organisation database to SCHEMA_VERSION, for the synchronous
 * server drivers. `run` executes one statement and returns its rows;
 * `atomically` runs its callback as one transaction.
 */
export function migrateOrgSchemaSync(run: (sql: string) => Rows, atomically: (fn: () => void) => void): void {
  run(schemaMetaDdl);
  const plan = planFor(run(schemaStateSql.version), run(schemaStateSql.hasTables));
  if (plan.length) atomically(() => plan.forEach((s) => run(s)));
}

/** The same for an asynchronous connection (the clients). */
export async function migrateOrgSchema(run: (sql: string) => Promise<Rows>, atomically: (fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await run(schemaMetaDdl);
  const plan = planFor(await run(schemaStateSql.version), await run(schemaStateSql.hasTables));
  if (plan.length) {
    await atomically(async () => {
      for (const s of plan) await run(s);
    });
  }
}
