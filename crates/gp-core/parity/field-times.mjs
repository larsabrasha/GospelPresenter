// Schema 27 (crates/gp-core/src/schema.rs, FIELD_TIMES): the rows written whole keep a time per field, and the newest
// change of a field wins (SYNC-R23, docs/assumptions.md; Lars, 2026-11-17). The reference at 238d481b stops at
// schema 26 and has no such rule, so the checks bring the databases it makes to 27 as the core's migration does, and,
// where the reference's TS mutators write, add the rule as triggers: the same outcomes and rows as the core's.

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
export const fieldTimeRule = () =>
  FIELD_TIMES.flatMap(([t, fields]) => [
    ...fields.flatMap((f) => [
      `CREATE TRIGGER ft_${t}_${f}_older BEFORE UPDATE OF ${f} ON ${t} WHEN OLD.${f}_at > NEW.updated_at BEGIN SELECT RAISE(ABORT, 'newer-change'); END`,
      `CREATE TRIGGER ft_${t}_${f}_time AFTER UPDATE OF ${f} ON ${t} BEGIN UPDATE ${t} SET ${f}_at = NEW.updated_at WHERE id = NEW.id; END`,
    ]),
    `CREATE TRIGGER ft_${t}_forward AFTER UPDATE OF updated_at ON ${t} WHEN OLD.updated_at > NEW.updated_at BEGIN UPDATE ${t} SET updated_at = OLD.updated_at WHERE id = NEW.id; END`,
    `CREATE TRIGGER ft_${t}_new AFTER INSERT ON ${t} BEGIN UPDATE ${t} SET ${fields.map((f) => `${f}_at = NEW.updated_at`).join(', ')} WHERE id = NEW.id; END`,
  ]);

/** A refusal of the rule's triggers, read back as the core's code; else undefined. */
export const fieldTimeRefusal = (e) => ([e?.message, e?.cause?.message].some((m) => String(m ?? '').includes('newer-change')) ? 'newer-change' : undefined);
