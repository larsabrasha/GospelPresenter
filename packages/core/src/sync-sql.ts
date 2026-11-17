import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { syncedTables } from './schema.ts';

// SQL shared by both ends of the sync protocol, generated from the Drizzle
// schema so no table can be forgotten.

export interface TableInfo {
  name: string;
  columns: string[];
}

export const tableInfo: TableInfo[] = syncedTables.map((t: SQLiteTable) => {
  const c = getTableConfig(t);
  return { name: c.name, columns: c.columns.map((col) => col.name) };
});

export type SyncedTableName =
  'labels' | 'songs' | 'song_parts' | 'song_arrangements' | 'song_versions' | 'song_materials' | 'ccli_entries' | 'presentations' | 'presentation_items' | 'bibles' | 'org_settings' | 'images' | 'displays' | 'audios' | 'overlays' | 'videos' | 'custom_slides' | 'themes';

/** Every synced table's rows, sorted by id: what "byte for byte" compares. */
export type Dump = Record<SyncedTableName, Record<string, unknown>[]>;

export const tableByName = new Map(tableInfo.map((t) => [t.name, t]));

// ---------------------------------------------------------------- server

/**
 * Server sync tables. `sync_change` holds one row per entity; each change moves
 * it to a new, higher `seq` (the trigger deletes the entity's row and inserts
 * it again, and AUTOINCREMENT never reuses a value), so `seq` is a monotonic
 * commit-order cursor.
 */
export const serverSyncDdl: string[] = [
  `CREATE TABLE IF NOT EXISTS sync_change (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     tbl TEXT NOT NULL, pk TEXT NOT NULL, op TEXT NOT NULL,
     UNIQUE (tbl, pk))`,
  `CREATE TABLE IF NOT EXISTS sync_client (
     client_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL,
     last_mutation_id INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sync_mutation_result (
     client_id TEXT NOT NULL, mutation_id INTEGER NOT NULL, error TEXT NOT NULL,
     PRIMARY KEY (client_id, mutation_id))`,
];

// Trigger bodies here use no conflict clause (OR IGNORE, OR REPLACE) of
// their own: SQLite lets the statement that fires a trigger override it. An
// upsert's DO UPDATE turns a trigger's OR IGNORE or OR REPLACE into ABORT
// (a UNIQUE failure), and an outer OR REPLACE turns OR IGNORE into REPLACE
// (the first pre-image overwritten). A DELETE then INSERT, or an INSERT
// guarded by NOT EXISTS, never conflicts, so the outer clause cannot matter.

/**
 * Triggers that write `sync_change` for every insert, update and delete on a
 * synced table. Dropped and made again on every open, so a database made by
 * an older version gets these bodies.
 */
export function serverChangeTriggers(): string[] {
  const record = (name: string, pk: string, op: 'put' | 'del') =>
    `DELETE FROM sync_change WHERE tbl = '${name}' AND pk = ${pk};
       INSERT INTO sync_change (tbl, pk, op) VALUES ('${name}', ${pk}, '${op}');`;
  return tableInfo.flatMap(({ name }) => [
    ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS sync_${name}_${op}`),
    `CREATE TRIGGER sync_${name}_ins AFTER INSERT ON ${name} BEGIN
       ${record(name, 'NEW.id', 'put')} END`,
    `CREATE TRIGGER sync_${name}_upd AFTER UPDATE ON ${name} BEGIN
       ${record(name, 'NEW.id', 'put')} END`,
    `CREATE TRIGGER sync_${name}_del AFTER DELETE ON ${name} BEGIN
       ${record(name, 'OLD.id', 'del')} END`,
  ]);
}

// ---------------------------------------------------------------- client

// The client's queue, undo log, triggers and rebase are the Rust core's (crates/gp-core/src/sync.rs, sync_sql.rs).

/** Where a client connection notes the tables a transaction wrote, until it commits (the core's change tracking). */
export const CHANGED_TABLES = 'temp.changed_tables';
