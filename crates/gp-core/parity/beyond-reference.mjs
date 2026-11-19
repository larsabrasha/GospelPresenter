// What the core does beyond the reference at 238d481b, written in the core first (Lars, 2026-11-17), for the checks to
// add to the reference so that the rest is still compared with it: schema 27 (crates/gp-core/src/schema.rs,
// FIELD_TIMES), the rows written whole keeping a time per field and the newest change of a field winning (SYNC-R23,
// docs/assumptions.md); a renamed slideshow's items taking its new name (docs/custom-slides.md); and a song's items
// keeping Original when its first arrangement is made (spec 02, SONG-R58). The checks bring the databases the
// reference makes to 27 as the core's migration does, and, where the reference's TS mutators write, add the rules as
// triggers (`coreRules`): the same outcomes and rows as the core's.

/** The tables and their fields with a time each, as the core's FIELD_TIMES. */
export const FIELD_TIMES = [
  ['custom_slides', ['name', 'pages']],
  ['overlays', ['title', 'content']],
  ['themes', ['name', 'definition']],
];

/** What migration 27 runs: a column per field, its time from the row's last change; and the version. */
export const fieldTimeMigration = () => [
  ...FIELD_TIMES.flatMap(([t, fields]) => [
    ...fields.map((f) => `ALTER TABLE ${t} ADD COLUMN ${f}_at INTEGER`),
    `UPDATE ${t} SET ${fields.map((f) => `${f}_at = updated_at`).join(', ')}`,
  ]),
  'UPDATE _schema SET version = 27',
];

/**
 * The core's `update_fields` and its inserts, as triggers, for a database the reference's TS mutators write: a field
 * set (`UPDATE OF`, whatever its value) older than its time is refused (`newer-change`, an error the runner reads as
 * the code); else its time is the change's (`updated_at`, which the TS mutators set to the change's `at`), and
 * `updated_at` only moves forward. A new row's fields take its time.
 */
const fieldTimeRule = () =>
  FIELD_TIMES.flatMap(([t, fields]) => [
    ...fields.flatMap((f) => [
      `CREATE TRIGGER ft_${t}_${f}_older BEFORE UPDATE OF ${f} ON ${t} WHEN OLD.${f}_at > NEW.updated_at BEGIN SELECT RAISE(ABORT, 'newer-change'); END`,
      `CREATE TRIGGER ft_${t}_${f}_time AFTER UPDATE OF ${f} ON ${t} BEGIN UPDATE ${t} SET ${f}_at = NEW.updated_at WHERE id = NEW.id; END`,
    ]),
    `CREATE TRIGGER ft_${t}_forward AFTER UPDATE OF updated_at ON ${t} WHEN OLD.updated_at > NEW.updated_at BEGIN UPDATE ${t} SET updated_at = OLD.updated_at WHERE id = NEW.id; END`,
    `CREATE TRIGGER ft_${t}_new AFTER INSERT ON ${t} BEGIN UPDATE ${t} SET ${fields.map((f) => `${f}_at = NEW.updated_at`).join(', ')} WHERE id = NEW.id; END`,
  ]);

/**
 * A renamed thing of the library (`UPDATE OF` its name): the items it is alone, in presentations and templates, take
 * the new name, as the core's `rename_items` does for slideshows, pictures, sounds and videos.
 */
const itemTitleRule = () =>
  [['custom_slides', 'name', 'custom'], ['images', 'file_name', 'image'], ['audios', 'file_name', 'audio'], ['videos', 'file_name', 'video']].map(
    ([table, column, kind]) => `CREATE TRIGGER br_${table}_item_titles AFTER UPDATE OF ${column} ON ${table} BEGIN
     UPDATE presentation_items SET title = NEW.${column} WHERE type = '${kind}' AND source_id = NEW.id AND content IS NULL AND title <> NEW.${column}; END`,
  );

/**
 * A song's first arrangement made (a new row, its only one): its items that named none showed its parts in their own
 * order and go on showing them as Original, `original`, as the core's `keep_original` (Lars, 2026-11-19). The
 * reference reads that id as no arrangement's, so all the parts in order, as the core does.
 */
const originalRule = () => [
  `CREATE TRIGGER br_song_arrangements_original AFTER INSERT ON song_arrangements
   WHEN (SELECT count(*) FROM song_arrangements WHERE song_id = NEW.song_id) = 1 BEGIN
     UPDATE presentation_items SET arrangement_id = 'original' WHERE type = 'song' AND source_id = NEW.song_id AND arrangement_id IS NULL; END`,
];

/** Every rule of the core's beyond the reference, as triggers for a database the reference's TS mutators write. */
export const coreRules = () => [...fieldTimeRule(), ...itemTitleRule(), ...originalRule()];

/** A refusal of the rule's triggers, read back as the core's code; else undefined. */
export const fieldTimeRefusal = (e) => ([e?.message, e?.cause?.message].some((m) => String(m ?? '').includes('newer-change')) ? 'newer-change' : undefined);
