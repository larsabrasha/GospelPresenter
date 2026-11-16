import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, migrateOrgSchemaSync, mutators, schema, SCHEMA_VERSION, type MutatorCtx, type Tx } from '@gp/core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { runMutation, type MutationDb, type Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

/** A statement's rows as arrays, on node:sqlite. */
const rowsOn = (db0: DatabaseSync) => (sql: string, params: unknown[] = []) => {
  const st = db0.prepare(sql);
  st.setReturnArrays(true);
  return st.all(...(params as never[])) as unknown as Rows;
};

/** An organisation's database in memory, migrated by the core, with a song, and a Rust core over it: statements synchronous, or async as on wa-sqlite. */
function org(async = false): MutationDb & { db0: DatabaseSync } {
  const db0 = new DatabaseSync(':memory:');
  const all = rowsOn(db0);
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, all);
  db0.exec(`INSERT INTO songs (id, name) VALUES ('s1', 'Härlig är jorden')`);
  const db = drizzle(async (sql, params, method) => {
    const rows = all(sql, params);
    return { rows: method === 'get' ? (rows[0] as never) : rows };
  }, { schema }) as unknown as Tx;
  return { db0, db, core, rows: async ? async (sql, params) => all(sql, params) : all };
}

const rowsOf = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

describe('runMutation', () => {
  it('writes through the Rust core with synchronous statements', async () => {
    const o = org();

    await runMutation(o, 'createPresentation', { id: 'p1', name: ' Söndag ' }, admin);

    expect(rowsOf(o.db0, 'SELECT id, name, updated_at FROM presentations')).toEqual([{ id: 'p1', name: 'Söndag', updated_at: 1000 }]);
  });

  it('writes through the Rust core with async statements', async () => {
    const o = org(true);
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Söndag' }, admin);

    await runMutation(o, 'addSongToPresentation', { itemId: 'i1', presentationId: 'p1', songId: 's1' }, admin);

    expect(rowsOf(o.db0, 'SELECT id, type, title, source_id, sort FROM presentation_items')).toEqual([
      { id: 'i1', type: 'song', title: 'Härlig är jorden', source_id: 's1', sort: 0 },
    ]);
  });

  it('throws a refusal with the core code, as runMutator does', async () => {
    const o = org();

    const refused = runMutation(o, 'addHeaderToPresentation', { itemId: 'h1', presentationId: 'gone', title: 'Lovsång' }, admin);

    await expect(refused).rejects.toMatchObject({ name: 'Error', code: 'not-found' });
  });

  it('refuses invalid arguments as invalid-args', async () => {
    const o = org();

    await expect(runMutation(o, 'createPresentation', { id: '', name: 'x' }, admin)).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it('refuses a role without the permission as forbidden', async () => {
    const o = org();

    await expect(runMutation(o, 'createPresentation', { id: 'p1', name: 'x' }, { userId: 'u', role: 'guest' as never })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('runs the test probe, which the Rust core does not have, through the TS core', async () => {
    const o = org();

    await expect(runMutation(o, 'probeWriteThenThrow', { songId: 'x' }, admin)).rejects.toMatchObject({ code: 'probe-failure' });
  });

  it('knows every mutator of the TS core but the probe', async () => {
    const o = org();
    const names = Object.keys(mutators).filter((n) => n !== 'probeWriteThenThrow');

    const unknown: string[] = [];
    for (const name of names) await runMutation(o, name, {}, admin).catch((e: { code?: string }) => e.code === 'unknown-mutator' && unknown.push(name));

    expect([names.length, unknown]).toEqual([97, []]);
  });

  it('refuses a name no core knows as unknown-mutator', async () => {
    const o = org();

    await expect(runMutation(o, 'noSuchMutator', {}, admin)).rejects.toMatchObject({ code: 'unknown-mutator' });
  });

  it('answers the next call after a panic in the core', async () => {
    const o = org();
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Söndag' }, admin);
    // No row for the count of items: the core unwraps it and traps.
    const broken = { ...o, rows: (sql: string, params: unknown[]) => (sql.startsWith('SELECT count(*)') ? [] : (o.rows(sql, params) as Rows)) };
    await expect(runMutation(broken, 'addHeaderToPresentation', { itemId: 'h1', presentationId: 'p1', title: 'Lovsång' }, admin)).rejects.toBeInstanceOf(WebAssembly.RuntimeError);

    await runMutation(o, 'addHeaderToPresentation', { itemId: 'h2', presentationId: 'p1', title: 'Bön' }, admin);

    expect(rowsOf(o.db0, 'SELECT id FROM presentation_items')).toEqual([{ id: 'h2' }]);
  });
});

describe('the schema through the Rust core', () => {
  const tables = (db0: DatabaseSync) => db0.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();

  it('makes a new database as the TS core does', () => {
    const [ts, rust] = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')];
    migrateOrgSchemaSync((sql) => ts.prepare(sql).all() as never, (fn) => fn());

    nodeRustCore().runSync('migrateOrgSchema', {}, undefined, rowsOn(rust));

    expect([tables(rust), rowsOf(rust, 'SELECT version FROM _schema')]).toEqual([tables(ts), [{ version: SCHEMA_VERSION }]]);
  });

  it('refuses a database from before the first schema as schema-too-old', () => {
    const db0 = new DatabaseSync(':memory:');
    db0.exec('CREATE TABLE _schema (one INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO _schema VALUES (1, 10); CREATE TABLE songs (id TEXT)');

    const migrate = () => nodeRustCore().runSync('migrateOrgSchema', {}, undefined, rowsOn(db0));

    expect(migrate).toThrow(expect.objectContaining({ code: 'schema-too-old' }));
  });

  it('seeds the default labels once', () => {
    const o = org();
    o.core.runSync('seedLabels', {}, undefined, rowsOn(o.db0));
    o.db0.exec(`DELETE FROM labels WHERE text = 'Verse'`);

    o.core.runSync('seedLabels', {}, undefined, rowsOn(o.db0));

    expect(rowsOf(o.db0, 'SELECT count(*) AS n FROM labels')).toEqual([{ n: DEFAULT_LABELS.length - 1 }]);
  });
});
