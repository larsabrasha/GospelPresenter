// The change and undo triggers (packages/core/src/sync-sql.ts) against every
// way a statement can insert: plain, upsert (DO UPDATE, DO NOTHING) and
// INSERT OR IGNORE. SQLite lets the statement that fires a trigger override
// the trigger's own conflict clause, so the triggers use none. Plus why
// mutators never replace a row (scripts/check-mutator-sql.mjs).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clientUndoRestore, tableInfo } from '@gp/core';
import { queryObjects, SyncClient, type ClientSqlite } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { nodeOrgStore, openSqlite, type NodeDriver } from '@gp/server/node';

const upsert = (id: string, value: string) =>
  `INSERT INTO org_settings (id, value) VALUES ('${id}', '${value}') ON CONFLICT (id) DO UPDATE SET value = excluded.value`;

describe('client undo triggers (wa-sqlite)', () => {
  /** A client database with k = a and no captured rows, and its raw connection. */
  async function client(): Promise<{ sqlite: ClientSqlite; c: SyncClient; rows: () => Promise<unknown[]>; undo: () => Promise<unknown[]> }> {
    const sqlite = await openWaSqlite();
    const c = await SyncClient.open(sqlite, { transport: { post: async () => ({ status: 503, body: {} }) as never }, ctx: { userId: 'u', role: 'admin' } });
    await sqlite.query('UPDATE _sync_meta SET capture = 0');
    await sqlite.query("INSERT INTO org_settings (id, value) VALUES ('k', 'a')");
    await sqlite.query('UPDATE _sync_meta SET capture = 1');
    return {
      sqlite,
      c,
      rows: () => queryObjects(sqlite, 'SELECT id, value FROM org_settings ORDER BY id'),
      undo: () => queryObjects(sqlite, "SELECT pk, before FROM _undo WHERE tbl = 'org_settings' ORDER BY pk"),
    };
  }

  async function restore(sqlite: ClientSqlite) {
    await sqlite.query('UPDATE _sync_meta SET capture = 0');
    for (const s of clientUndoRestore()) await sqlite.query(s);
    await sqlite.query('DELETE FROM _undo');
    await sqlite.query('UPDATE _sync_meta SET capture = 1');
  }

  it('keep the first pre-image through upserts, DO NOTHING and OR IGNORE, and undo them all', async () => {
    const { sqlite, c, rows, undo } = await client();
    await sqlite.query(upsert('k', 'b')); // conflict: DO UPDATE
    await sqlite.query(upsert('k', 'c')); // again: the first pre-image stays
    await sqlite.query(upsert('k2', 'x')); // no conflict: an insert
    await sqlite.query("INSERT INTO org_settings (id, value) VALUES ('k', 'z') ON CONFLICT DO NOTHING");
    await sqlite.query("INSERT INTO org_settings (id, value) VALUES ('k3', 'y') ON CONFLICT DO NOTHING");
    await sqlite.query("INSERT OR IGNORE INTO org_settings (id, value) VALUES ('k4', 'w')");
    await sqlite.query("INSERT OR IGNORE INTO org_settings (id, value) VALUES ('k', 'v')");
    expect(await rows()).toEqual([
      { id: 'k', value: 'c' },
      { id: 'k2', value: 'x' },
      { id: 'k3', value: 'y' },
      { id: 'k4', value: 'w' },
    ]);
    expect(await undo()).toEqual([
      { pk: 'k', before: JSON.stringify({ id: 'k', value: 'a' }) },
      { pk: 'k2', before: null },
      { pk: 'k3', before: null },
      { pk: 'k4', before: null },
    ]);
    await restore(sqlite);
    expect(await rows()).toEqual([{ id: 'k', value: 'a' }]);
    await c.close();
  });

  it('an upsert that a delete follows still restores the row as it was', async () => {
    const { sqlite, c, rows } = await client();
    await sqlite.query(upsert('k', 'b'));
    await sqlite.query("DELETE FROM org_settings WHERE id = 'k'");
    await sqlite.query(upsert('k', 'c'));
    await restore(sqlite);
    expect(await rows()).toEqual([{ id: 'k', value: 'a' }]);
    await c.close();
  });

  it('a REPLACE loses the row (its delete fires no trigger): why mutators never use one', async () => {
    const { sqlite, c, rows, undo } = await client();
    await sqlite.query("INSERT OR REPLACE INTO org_settings (id, value) VALUES ('k', 'b')");
    expect(await undo()).toEqual([{ pk: 'k', before: null }]);
    await restore(sqlite);
    expect(await rows()).toEqual([]); // not k = a
    await c.close();
  });
});

describe.each(['better-sqlite3', 'node:sqlite'] as NodeDriver[])('server change triggers (%s)', (driver) => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const file = () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-triggers-'));
    dirs.push(dir);
    return join(dir, 'org.sqlite');
  };
  const changes = (q: (sql: string) => Record<string, unknown>[]) => q("SELECT seq, pk, op FROM sync_change WHERE tbl = 'org_settings' ORDER BY seq");

  it('every kind of insert moves the entity to a new, higher seq', () => {
    const f = openSqlite(file(), driver);
    const store = nodeOrgStore(f);
    const q = (sql: string) => store.query(sql);
    q(upsert('k', 'a'));
    const [first] = changes(q);
    q(upsert('k', 'b'));
    q("INSERT INTO org_settings (id, value) VALUES ('k2', 'x') ON CONFLICT DO NOTHING");
    q("INSERT OR IGNORE INTO org_settings (id, value) VALUES ('k3', 'y')");
    const after = changes(q);
    expect(after.map((c) => [c.pk, c.op])).toEqual([
      ['k', 'put'],
      ['k2', 'put'],
      ['k3', 'put'],
    ]);
    expect(Number(after[0]!.seq)).toBeGreaterThan(Number(first!.seq));
    q("DELETE FROM org_settings WHERE id = 'k'");
    expect(changes(q).at(-1)).toMatchObject({ pk: 'k', op: 'del' });
    expect(changes(q)).toHaveLength(3);
    f.close();
  });

  it('a database with the old trigger bodies gets the new ones when it opens', () => {
    const path = file();
    let f = openSqlite(path, driver);
    nodeOrgStore(f);
    // As milestones 1 to 4 made them: an INSERT OR REPLACE, which an upsert turns into ABORT.
    for (const { name } of tableInfo) {
      f.exec(`DROP TRIGGER sync_${name}_upd`);
      f.exec(`CREATE TRIGGER sync_${name}_upd AFTER UPDATE ON ${name} BEGIN
        INSERT OR REPLACE INTO sync_change (tbl, pk, op) VALUES ('${name}', NEW.id, 'put'); END`);
    }
    f.query(upsert('k', 'a'));
    expect(() => f.query(upsert('k', 'b'))).toThrow(/UNIQUE constraint failed: sync_change/);
    f.close();

    f = openSqlite(path, driver);
    const store = nodeOrgStore(f);
    expect(f.query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%OR REPLACE%'")).toEqual([]);
    store.query(upsert('k', 'b'));
    expect(store.query('SELECT value FROM org_settings')).toEqual([{ value: 'b' }]);
    f.close();
  });
});
