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

export type SyncedTableName = 'labels' | 'songs' | 'song_parts' | 'song_arrangements' | 'presentations' | 'presentation_items';

/** Every synced table's rows, sorted by id: what "byte for byte" compares. */
export type Dump = Record<SyncedTableName, Record<string, unknown>[]>;

export const tableByName = new Map(tableInfo.map((t) => [t.name, t]));

// ---------------------------------------------------------------- server

/**
 * Server sync tables. `sync_change` holds one row per entity; each change moves
 * it to a new, higher `seq` (INSERT OR REPLACE deletes and re-inserts, and
 * AUTOINCREMENT never reuses a value), so `seq` is a monotonic commit-order cursor.
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

/** Triggers that write `sync_change` for every insert, update and delete on a synced table. */
export function serverChangeTriggers(): string[] {
  return tableInfo.flatMap(({ name }) => [
    `CREATE TRIGGER IF NOT EXISTS sync_${name}_ins AFTER INSERT ON ${name} BEGIN
       INSERT OR REPLACE INTO sync_change (tbl, pk, op) VALUES ('${name}', NEW.id, 'put'); END`,
    `CREATE TRIGGER IF NOT EXISTS sync_${name}_upd AFTER UPDATE ON ${name} BEGIN
       INSERT OR REPLACE INTO sync_change (tbl, pk, op) VALUES ('${name}', NEW.id, 'put'); END`,
    `CREATE TRIGGER IF NOT EXISTS sync_${name}_del AFTER DELETE ON ${name} BEGIN
       INSERT OR REPLACE INTO sync_change (tbl, pk, op) VALUES ('${name}', OLD.id, 'del'); END`,
  ]);
}

// ---------------------------------------------------------------- client

export const clientSyncDdl: string[] = [
  `CREATE TABLE IF NOT EXISTS _sync_meta (
     one INTEGER PRIMARY KEY CHECK (one = 1),
     client_id TEXT NOT NULL, cookie TEXT, last_mutation_id INTEGER NOT NULL DEFAULT 0,
     next_mutation_id INTEGER NOT NULL DEFAULT 1, capture INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS _mutation (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _undo (
     tbl TEXT NOT NULL, pk TEXT NOT NULL, before TEXT, PRIMARY KEY (tbl, pk))`,
];

/**
 * Triggers that keep the first pre-image of every row touched while capture is on.
 * `before` is NULL for a row that did not exist. Pulls switch capture off.
 * They name every column, so they are dropped and made again on every open:
 * a schema migration may have added columns.
 */
export function clientUndoTriggers(): string[] {
  const on = `WHEN (SELECT capture FROM _sync_meta) = 1`;
  return tableInfo.flatMap(({ name, columns }) => {
    const image = `json_object(${columns.map((c) => `'${c}', OLD.${c}`).join(', ')})`;
    return [
      ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS undo_${name}_${op}`),
      `CREATE TRIGGER undo_${name}_ins AFTER INSERT ON ${name} ${on} BEGIN
         INSERT OR IGNORE INTO _undo (tbl, pk, before) VALUES ('${name}', NEW.id, NULL); END`,
      `CREATE TRIGGER undo_${name}_upd BEFORE UPDATE ON ${name} ${on} BEGIN
         INSERT OR IGNORE INTO _undo (tbl, pk, before) VALUES ('${name}', OLD.id, ${image}); END`,
      `CREATE TRIGGER undo_${name}_del BEFORE DELETE ON ${name} ${on} BEGIN
         INSERT OR IGNORE INTO _undo (tbl, pk, before) VALUES ('${name}', OLD.id, ${image}); END`,
    ];
  });
}

/** Statements that put every captured row back to its pre-image (run with capture off). */
export function clientUndoRestore(): string[] {
  return tableInfo.flatMap(({ name, columns }) => [
    `DELETE FROM ${name} WHERE id IN (SELECT pk FROM _undo WHERE tbl = '${name}' AND before IS NULL)`,
    `INSERT INTO ${name} (${columns.join(', ')})
       SELECT ${columns.map((c) => `json_extract(before, '$.${c}')`).join(', ')}
       FROM _undo WHERE tbl = '${name}' AND before IS NOT NULL AND true
       ON CONFLICT (id) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ]);
}

/** An upsert of one row by its column values, used to apply a pull patch. */
export function upsertSql(t: TableInfo): string {
  return `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})
    ON CONFLICT (id) DO UPDATE SET ${t.columns.map((c) => `${c} = excluded.${c}`).join(', ')}`;
}
