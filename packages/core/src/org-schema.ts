// An organisation's database: its version. Its DDL and the migrations that bring an older one up to date are the Rust
// core's (crates/gp-core/src/schema.rs, the command `migrateOrgSchema`); the shells run it where they open a database.

/** Bumped whenever a synced table changes shape; part of the pull cookie's scope. */
export const SCHEMA_VERSION = 26;

/** Where a database records its schema version. One made before versions were recorded has no row. */
export const schemaMetaDdl = `CREATE TABLE IF NOT EXISTS _schema (one INTEGER PRIMARY KEY CHECK (one = 1), version INTEGER NOT NULL)`;
