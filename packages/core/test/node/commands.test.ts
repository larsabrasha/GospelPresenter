// The core's commands as the shells run them (core.ts), and the schema they make. That they did what the Rust core did
// was the parity checks' (crates/gp-core/parity at the tag native-experiment-end; docs/core-back-to-typescript.md).
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, MUTATOR_VERSIONS, SCHEMA_VERSION, tableInfo, type MutatorCtx } from '@gp/core';
import { Core, runMutation, type MutationDb, type Rows } from '../../src/core.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

/** A statement's rows as arrays, on node:sqlite. */
const rowsOn = (db0: DatabaseSync) => (sql: string, params: unknown[] = []) => {
  const st = db0.prepare(sql);
  st.setReturnArrays(true);
  return st.all(...(params as never[])) as unknown as Rows;
};

/** An organisation's database in memory, migrated by the core, with a song, and a core over it: statements synchronous, or async as on wa-sqlite. */
function org(async = false): MutationDb & { db0: DatabaseSync } {
  const db0 = new DatabaseSync(':memory:');
  const all = rowsOn(db0);
  const core = new Core();
  core.runSync('migrateOrgSchema', all);
  db0.exec(`INSERT INTO songs (id, name) VALUES ('s1', 'Härlig är jorden')`);
  return { db0, core, rows: async ? async (sql, params) => all(sql, params) : all };
}

const rowsOf = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

describe('runMutation', () => {
  it('writes through the core with synchronous statements', async () => {
    const o = org();

    await runMutation(o, 'createPresentation', { id: 'p1', name: ' Söndag ' }, admin);

    expect(rowsOf(o.db0, 'SELECT id, name, updated_at FROM presentations')).toEqual([{ id: 'p1', name: 'Söndag', updated_at: 1000 }]);
  });

  it('writes through the core with async statements', async () => {
    const o = org(true);
    await runMutation(o, 'createPresentation', { id: 'p1', name: 'Söndag' }, admin);

    await runMutation(o, 'addSongToPresentation', { itemId: 'i1', presentationId: 'p1', songId: 's1' }, admin);

    expect(rowsOf(o.db0, 'SELECT id, type, title, source_id, sort FROM presentation_items')).toEqual([
      { id: 'i1', type: 'song', title: 'Härlig är jorden', source_id: 's1', sort: 0 },
    ]);
  });

  it('throws a refusal with the core code', async () => {
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

  it('runs the test probe on the core, which writes and then refuses (the caller rolls back)', async () => {
    const o = org();

    await expect(runMutation(o, 'probeWriteThenThrow', { songId: 'x' }, admin)).rejects.toMatchObject({ code: 'probe-failure' });
  });

  it('knows every mutator the shells may call', async () => {
    const o = org();
    const names = Object.keys(MUTATOR_VERSIONS);

    const unknown: string[] = [];
    for (const name of names) await runMutation(o, name, {}, admin).catch((e: { code?: string }) => e.code === 'unknown-mutator' && unknown.push(name));

    expect([names.length, unknown]).toEqual([99, []]);
  });

  it('refuses a name no core knows as unknown-mutator', async () => {
    const o = org();

    await expect(runMutation(o, 'noSuchMutator', {}, admin)).rejects.toMatchObject({ code: 'unknown-mutator' });
  });
});

describe('the schema through the core', () => {
  it('makes every synced table with the columns the shells read and send', () => {
    const db0 = new DatabaseSync(':memory:');

    new Core().runSync('migrateOrgSchema', rowsOn(db0));

    const columns = (t: string) => (db0.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect([tableInfo.filter((t) => t.columns.join() !== columns(t.name).join()).map((t) => t.name), rowsOf(db0, 'SELECT version FROM _schema')]).toEqual([
      [],
      [{ version: SCHEMA_VERSION }],
    ]);
  });

  it('refuses a database from before the first schema as schema-too-old', () => {
    const db0 = new DatabaseSync(':memory:');
    db0.exec('CREATE TABLE _schema (one INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO _schema VALUES (1, 10); CREATE TABLE songs (id TEXT)');

    const migrate = () => new Core().runSync('migrateOrgSchema', rowsOn(db0));

    expect(migrate).toThrow(expect.objectContaining({ code: 'schema-too-old' }));
  });

  it('refuses a database newer than the app as schema-too-new', () => {
    const db0 = new DatabaseSync(':memory:');
    db0.exec(`CREATE TABLE _schema (one INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO _schema VALUES (1, ${SCHEMA_VERSION + 1}); CREATE TABLE songs (id TEXT)`);

    const migrate = () => new Core().runSync('migrateOrgSchema', rowsOn(db0));

    expect(migrate).toThrow(expect.objectContaining({ code: 'schema-too-new' }));
  });

  it('seeds the default labels once', () => {
    const o = org();
    o.core.runSync('seedLabels', rowsOn(o.db0));
    o.db0.exec(`DELETE FROM labels WHERE text = 'Verse'`);

    o.core.runSync('seedLabels', rowsOn(o.db0));

    expect(rowsOf(o.db0, 'SELECT count(*) AS n FROM labels')).toEqual([{ n: DEFAULT_LABELS.length - 1 }]);
  });
});
