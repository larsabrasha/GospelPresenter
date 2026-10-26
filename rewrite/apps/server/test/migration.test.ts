// A database made by milestone 1 (schema 1, no version row) is brought to the
// current schema on open, on the server and on a client, keeping its rows. The
// server's global database has its own version (see the end).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, orgDdl, tableInfo } from '@gp/core';
import { SyncClient } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { GLOBAL_SCHEMA_VERSION, globalSchemaPlan, migrateGlobal } from '@gp/server';
import { nodeGlobalSql, nodeOrgStore, openSqlite, type NodeDriver } from '@gp/server/node';

/** The organisation DDL milestone 1 shipped (schema 1), as it was. */
const milestone1Ddl = [
  `CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL,
     sort INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, author TEXT,
     publisher TEXT, year INTEGER, ccli TEXT, deleted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS song_parts (id TEXT PRIMARY KEY NOT NULL,
     song_id TEXT NOT NULL REFERENCES songs(id), sort INTEGER NOT NULL,
     label_id TEXT REFERENCES labels(id), content TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, event_date TEXT,
     deleted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS presentation_items (id TEXT PRIMARY KEY NOT NULL,
     presentation_id TEXT NOT NULL REFERENCES presentations(id), type TEXT NOT NULL, title TEXT NOT NULL,
     source_id TEXT NOT NULL, sort INTEGER NOT NULL)`,
];
const milestone1Rows = [
  `INSERT INTO songs (id, name) VALUES ('S1', 'Härlig är jorden')`,
  `INSERT INTO presentations (id, name) VALUES ('P', 'Söndag')`,
  `INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('I1', 'P', 'song', 'Härlig är jorden', 'S1', 0)`,
];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Every table's columns, as SQLite reports them. */
function columnsOf(query: (sql: string) => Record<string, unknown>[]) {
  return Object.fromEntries(tableInfo.map((t) => [t.name, query(`SELECT name FROM pragma_table_info('${t.name}')`).map((r) => r.name)]));
}

describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('server, %s', (driver) => {
  it('migrates a milestone 1 file and keeps its rows; opening it again changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const file = join(dir, 'org.sqlite');
    const old = openSqlite(file, driver);
    for (const s of [...milestone1Ddl, ...milestone1Rows]) old.exec(s);
    old.close();

    const f = openSqlite(file, driver);
    nodeOrgStore(f);
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: SCHEMA_VERSION }]);
    expect(columnsOf(f.query)).toEqual(Object.fromEntries(tableInfo.map((t) => [t.name, t.columns])));
    expect(f.query('SELECT id, arrangement_id FROM presentation_items')).toEqual([{ id: 'I1', arrangement_id: null }]);
    f.close();

    const again = openSqlite(file, driver);
    nodeOrgStore(again); // must not try ALTER TABLE a second time
    expect(again.query('SELECT count(*) AS n FROM songs')).toEqual([{ n: 1 }]);
    again.close();
  });

  it('a new file gets the current DDL and its version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const f = openSqlite(join(dir, 'org.sqlite'), driver);
    nodeOrgStore(f);
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: SCHEMA_VERSION }]);
    expect(columnsOf(f.query)).toEqual(Object.fromEntries(tableInfo.map((t) => [t.name, t.columns])));
    f.close();
  });
});

describe('client (wa-sqlite)', () => {
  it('migrates a milestone 1 database, and its undo triggers capture the new columns', async () => {
    const sqlite = await openWaSqlite();
    for (const s of [...milestone1Ddl, ...milestone1Rows]) await sqlite.query(s);
    // Milestone 1 triggers, which name the old columns only.
    await sqlite.query(`CREATE TABLE _sync_meta (one INTEGER PRIMARY KEY CHECK (one = 1), client_id TEXT NOT NULL, cookie TEXT,
      last_mutation_id INTEGER NOT NULL DEFAULT 0, next_mutation_id INTEGER NOT NULL DEFAULT 1, capture INTEGER NOT NULL DEFAULT 1)`);
    await sqlite.query(`CREATE TABLE _undo (tbl TEXT NOT NULL, pk TEXT NOT NULL, before TEXT, PRIMARY KEY (tbl, pk))`);
    await sqlite.query(`CREATE TRIGGER undo_presentation_items_upd BEFORE UPDATE ON presentation_items BEGIN
      INSERT OR IGNORE INTO _undo (tbl, pk, before) VALUES ('presentation_items', OLD.id, json_object('id', OLD.id)); END`);

    const client = await SyncClient.open(sqlite, {
      transport: { post: async () => ({ status: 503, body: {} }) as never },
      ctx: { userId: 'u', role: 'admin' },
    });
    const dump = await client.dump();
    expect(dump.presentation_items).toEqual([
      { id: 'I1', presentation_id: 'P', type: 'song', title: 'Härlig är jorden', source_id: 'S1', sort: 0, arrangement_id: null },
    ]);
    expect(dump.song_arrangements).toEqual([]);

    await client.mutate('createArrangement', { id: 'A', songId: 'S1', partIds: [] });
    await client.mutate('setItemArrangement', { itemId: 'I1', arrangementId: 'A' });
    const [undo] = await client.query("SELECT before FROM _undo WHERE tbl = 'presentation_items'");
    expect(JSON.parse(String(undo!.before))).toMatchObject({ id: 'I1', arrangement_id: null, sort: 0 });
    expect(orgDdl.length).toBe(tableInfo.length);
    await client.close();
  });
});

// The global database: milestones 1 and 2 had only `memberships`, for
// placeholder user ids. Version 2 adds accounts and drops those rows.
describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('global database, %s', (driver) => {
  const tables = (f: ReturnType<typeof openSqlite>) =>
    f.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);

  it('migrates a milestone 2 file: accounts tables appear and placeholder memberships go', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const file = join(dir, 'global.sqlite');
    const old = openSqlite(file, driver);
    old.exec(`CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`);
    old.exec(`INSERT INTO memberships VALUES ('operator', 'church', 'admin'), ('second', 'church', 'user')`);
    old.close();

    const f = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(f));
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: GLOBAL_SCHEMA_VERSION }]);
    expect(tables(f)).toEqual(['_schema', 'auth_throttle', 'invites', 'memberships', 'orgs', 'pair_codes', 'paired_devices', 'sessions', 'users']);
    expect(f.query('SELECT * FROM memberships')).toEqual([]);
    f.close();

    // Opened again, nothing runs; a fresh file gets the same tables.
    const again = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(again));
    expect(tables(again)).toHaveLength(9);
    again.close();
    const fresh = openSqlite(join(dir, 'new.sqlite'), driver);
    await migrateGlobal(nodeGlobalSql(fresh));
    expect(tables(fresh)).toEqual(tables(openSqlite(file, driver)));
    expect(fresh.query('SELECT version FROM _schema')).toEqual([{ version: GLOBAL_SCHEMA_VERSION }]);
    fresh.close();
  });

  it('refuses a global database newer than this server', () => {
    expect(() => globalSchemaPlan(GLOBAL_SCHEMA_VERSION + 1, true)).toThrow(/newer than this server/);
    expect(globalSchemaPlan(GLOBAL_SCHEMA_VERSION, true)).toEqual([]);
  });
});
