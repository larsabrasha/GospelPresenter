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

export type SyncedTableName = 'labels' | 'songs' | 'song_parts' | 'song_arrangements' | 'presentations' | 'presentation_items' | 'bibles' | 'org_settings' | 'images' | 'displays';

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
 *
 * An upsert works: its insert fires the insert trigger, or, on a conflict,
 * its DO UPDATE fires the update trigger with the row as it was. A REPLACE
 * does not (it deletes the old row without firing the delete trigger), so
 * mutators never use one (`scripts/check-mutator-sql.mjs`).
 */
export function clientUndoTriggers(): string[] {
  const on = `WHEN (SELECT capture FROM _sync_meta) = 1`;
  const keepFirst = (name: string, pk: string, image: string) =>
    `INSERT INTO _undo (tbl, pk, before) SELECT '${name}', ${pk}, ${image}
         WHERE NOT EXISTS (SELECT 1 FROM _undo WHERE tbl = '${name}' AND pk = ${pk});`;
  return tableInfo.flatMap(({ name, columns }) => {
    const image = `json_object(${columns.map((c) => `'${c}', OLD.${c}`).join(', ')})`;
    return [
      ...['ins', 'upd', 'del'].map((op) => `DROP TRIGGER IF EXISTS undo_${name}_${op}`),
      `CREATE TRIGGER undo_${name}_ins AFTER INSERT ON ${name} ${on} BEGIN
         ${keepFirst(name, 'NEW.id', 'NULL')} END`,
      `CREATE TRIGGER undo_${name}_upd BEFORE UPDATE ON ${name} ${on} BEGIN
         ${keepFirst(name, 'OLD.id', image)} END`,
      `CREATE TRIGGER undo_${name}_del BEFORE DELETE ON ${name} ${on} BEGIN
         ${keepFirst(name, 'OLD.id', image)} END`,
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
