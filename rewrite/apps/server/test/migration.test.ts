// An organisation database is made from one DDL (SCHEMA_BASELINE): one made
// before then is refused, on the server and on a client. The server's global
// database has its own version (see the end).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, orgDdl, schemaMetaDdl, tableInfo } from '@gp/core';
import { SyncClient } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { Accounts, GLOBAL_SCHEMA_VERSION, globalSchemaPlan, migrateGlobal } from '@gp/server';
import { sha256 } from '../src/crypto.ts';
import { nodeGlobalSql, nodeOrgStore, openSqlite, type NodeDriver } from '@gp/server/node';

/** The organisation DDL milestone 1 shipped, with no version row: from before the baseline. */
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

/** A new SQLite file, holding `statements`. */
function fileWith(driver: NodeDriver, statements: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
  dirs.push(dir);
  const file = join(dir, 'org.sqlite');
  const old = openSqlite(file, driver);
  for (const s of statements) old.exec(s);
  old.close();
  return file;
}

describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('server, %s', (driver) => {
  it('a new file gets the current DDL and its version; opening it again changes nothing', () => {
    const file = fileWith(driver, []);

    const f = openSqlite(file, driver);
    nodeOrgStore(f);
    f.exec(`INSERT INTO songs (id, name) VALUES ('S1', 'Härlig är jorden')`);
    f.close();
    const again = openSqlite(file, driver);
    nodeOrgStore(again);

    expect(again.query('SELECT version FROM _schema')).toEqual([{ version: SCHEMA_VERSION }]);
    expect(columnsOf(again.query)).toEqual(Object.fromEntries(tableInfo.map((t) => [t.name, t.columns])));
    expect(again.query('SELECT id FROM songs')).toEqual([{ id: 'S1' }]);
    again.close();
  });

  it('a milestone 1 file (no version row) is refused and left as it was', () => {
    const file = fileWith(driver, [...milestone1Ddl, ...milestone1Rows]);

    const f = openSqlite(file, driver);
    expect(() => nodeOrgStore(f)).toThrow(/made before this app's first/);

    expect(f.query('SELECT id FROM presentation_items')).toEqual([{ id: 'I1' }]);
    f.close();
  });

  it('a file of a version before the baseline is refused', () => {
    const file = fileWith(driver, [...milestone1Ddl, schemaMetaDdl, `INSERT INTO _schema (one, version) VALUES (1, 10)`]);

    const f = openSqlite(file, driver);
    expect(() => nodeOrgStore(f)).toThrow(/schema 10, made before this app's first/);
    f.close();
  });
});

describe('client (wa-sqlite)', () => {
  it('a new database gets the current DDL, and its undo triggers capture every column', async () => {
    const sqlite = await openWaSqlite();

    const client = await SyncClient.open(sqlite, {
      transport: { post: async () => ({ status: 503, body: {} }) as never },
      ctx: { userId: 'u', role: 'admin' },
    });

    await client.mutate('createSong', { id: 'S1', name: 'Härlig är jorden' });
    await client.mutate('createPresentation', { id: 'P', name: 'Söndag' });
    await client.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'S1' });
    const [trigger] = await client.query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'undo_presentation_items_upd'");
    expect(String(trigger!.sql)).toContain('overlay_id');
    // Every table is made by the DDL: the synced ones, and the five that do not sync (Bible texts, media blobs, pins, kept Bibles).
    expect(orgDdl.length).toBe(tableInfo.length + 5);
    await client.close();
  });

  it('a copy from before the baseline is refused, as on the server', async () => {
    const sqlite = await openWaSqlite();
    for (const s of [...milestone1Ddl, ...milestone1Rows]) await sqlite.query(s);

    const open = SyncClient.open(sqlite, {
      transport: { post: async () => ({ status: 503, body: {} }) as never },
      ctx: { userId: 'u', role: 'admin' },
    });

    await expect(open).rejects.toThrow(/made before this app's first/);
  });
});

// The global database: milestones 1 and 2 had only `memberships`, for
// placeholder user ids. Version 2 (milestone 3) added accounts with
// passwords; version 3 replaces the passwords with linked Google logins;
// version 4 adds passkeys beside them.
const milestone2Global = [
  `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`,
  `INSERT INTO memberships VALUES ('operator', 'church', 'admin'), ('second', 'church', 'user')`,
];

/** The global DDL milestone 3 shipped (version 2), as it was. */
const milestone3Global = [
  `CREATE TABLE IF NOT EXISTS _schema (one INTEGER PRIMARY KEY CHECK (one = 1), version INTEGER NOT NULL)`,
  `INSERT INTO _schema (one, version) VALUES (1, 2)`,
  `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`,
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT,
     password_hash TEXT, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     user_id TEXT NOT NULL, org_id TEXT NOT NULL, device_name TEXT NOT NULL, created_at INTEGER NOT NULL,
     last_used_at INTEGER NOT NULL, revoked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, use_nonce TEXT)`,
  `CREATE INDEX IF NOT EXISTS invites_user ON invites (user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_throttle (key TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL,
     first_at INTEGER NOT NULL, locked_until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paired_devices (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pair_codes (one INTEGER PRIMARY KEY CHECK (one = 1), code_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL, failures INTEGER NOT NULL)`,
  // A church set up with milestone 3: Anna (SuperAdmin, with a password) and a signed-in device.
  `INSERT INTO orgs VALUES ('church', 'Lilla Kyrkan', 1)`,
  `INSERT INTO users VALUES ('anna', 'Anna', 'anna@x.se', 'pbkdf2-sha256$600000$salt$hash', 1)`,
  `INSERT INTO memberships VALUES ('anna', 'church', 'superAdmin')`,
  `INSERT INTO sessions VALUES ('s1', 'tokenhash', 'anna', 'church', 'Mac', 1, 1, NULL)`,
  `INSERT INTO auth_throttle VALUES ('account:anna@x.se', 3, 1, 0), ('address:10.0.0.9', 2, 1, 0)`,
  `INSERT INTO pair_codes VALUES (1, 'codehash', 9999999999999, 0)`,
];

/** The global DDL version 3 shipped (Google sign-in, before passkeys), as it was, with a church that signs in with Google. */
const version3Global = [
  `CREATE TABLE IF NOT EXISTS _schema (one INTEGER PRIMARY KEY CHECK (one = 1), version INTEGER NOT NULL)`,
  `INSERT INTO _schema (one, version) VALUES (1, 3)`,
  `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`,
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS user_logins (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS user_logins_user ON user_logins (user_id)`,
  `CREATE TABLE IF NOT EXISTS login_flows (state_hash TEXT PRIMARY KEY NOT NULL, address TEXT NOT NULL,
     nonce TEXT NOT NULL, verifier TEXT NOT NULL, invite_hash TEXT, device_name TEXT NOT NULL, callback_scheme TEXT,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, browser_hash TEXT, used_at INTEGER,
     user_id TEXT, org_id TEXT, handoff_hash TEXT)`,
  `CREATE INDEX IF NOT EXISTS login_flows_address ON login_flows (address, expires_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     user_id TEXT NOT NULL, org_id TEXT NOT NULL, device_name TEXT NOT NULL, created_at INTEGER NOT NULL,
     last_used_at INTEGER NOT NULL, revoked_at INTEGER, paired_device_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, use_nonce TEXT)`,
  `CREATE INDEX IF NOT EXISTS invites_user ON invites (user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_throttle (key TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL,
     first_at INTEGER NOT NULL, locked_until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paired_devices (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pair_codes (one INTEGER PRIMARY KEY CHECK (one = 1), code_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL, failures INTEGER NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL)`,
  `INSERT INTO orgs VALUES ('church', 'Lilla Kyrkan', 1)`,
  `INSERT INTO users VALUES ('anna', 'Anna', 'anna@gmail.com', 1)`,
  `INSERT INTO memberships VALUES ('anna', 'church', 'superAdmin')`,
  `INSERT INTO user_logins VALUES ('google', 'google-anna', 'anna', 1, 5)`,
  `INSERT INTO sessions VALUES ('s1', 'tokenhash', 'anna', 'church', 'Mac', 1, 1, NULL, NULL)`,
  `INSERT INTO login_flows (state_hash, address, nonce, verifier, device_name, created_at, expires_at) VALUES ('st', '1.2.3.4', 'n', 'v', 'Mac', 1, 9999999999999)`,
];

describe.each<NodeDriver>(['better-sqlite3', 'node:sqlite'])('global database, %s', (driver) => {
  const tables = (f: ReturnType<typeof openSqlite>) =>
    f.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
  /** Every table's columns, sorted (a migrated table has its added columns last). */
  const shape = (f: ReturnType<typeof openSqlite>) =>
    Object.fromEntries(tables(f).map((t) => [t, f.query(`SELECT name FROM pragma_table_info('${String(t)}')`).map((r) => String(r.name)).toSorted()]));
  const ALL = ['_schema', 'auth_throttle', 'invites', 'login_flows', 'memberships', 'orgs', 'pair_codes', 'paired_devices', 'passkey_flows', 'screen_tokens', 'screens', 'sessions', 'user_logins', 'users', 'watch_codes'];

  async function freshShape(dir: string) {
    const f = openSqlite(join(dir, `fresh-${crypto.randomUUID()}.sqlite`), driver);
    await migrateGlobal(nodeGlobalSql(f));
    const s = shape(f);
    f.close();
    return s;
  }

  it('migrates a milestone 2 file: accounts tables appear and placeholder memberships go', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const file = join(dir, 'global.sqlite');
    const old = openSqlite(file, driver);
    for (const sql of milestone2Global) old.exec(sql);
    old.close();

    const f = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(f));
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: GLOBAL_SCHEMA_VERSION }]);
    expect(tables(f)).toEqual(ALL);
    expect(f.query('SELECT * FROM memberships')).toEqual([]);
    expect(shape(f)).toEqual(await freshShape(dir));
    f.close();

    // Opened again, nothing runs.
    const again = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(again));
    expect(tables(again)).toEqual(ALL);
    again.close();
  });

  it('migrates a milestone 3 file: passwords and their lockout go; users, memberships and sessions stay; logins can be linked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const file = join(dir, 'global.sqlite');
    const old = openSqlite(file, driver);
    for (const sql of milestone3Global) old.exec(sql);
    old.close();

    const f = openSqlite(file, driver);
    const sql = nodeGlobalSql(f);
    await migrateGlobal(sql);
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: GLOBAL_SCHEMA_VERSION }]);
    expect(shape(f)).toEqual(await freshShape(dir));
    expect(shape(f).users).not.toContain('password_hash');
    expect(f.query('SELECT id, name, email FROM users')).toEqual([{ id: 'anna', name: 'Anna', email: 'anna@x.se' }]);
    expect(f.query('SELECT * FROM memberships')).toEqual([{ user_id: 'anna', org_id: 'church', role: 'superAdmin' }]);
    expect(f.query('SELECT id, paired_device_id FROM sessions')).toEqual([{ id: 's1', paired_device_id: null }]);
    expect(f.query('SELECT key FROM auth_throttle')).toEqual([{ key: 'address:10.0.0.9' }]);
    expect(f.query('SELECT * FROM pair_codes')).toEqual([]);

    // Nobody has a login yet, so setup is open again, and it finishes Anna's church rather than making a second one.
    const accounts = new Accounts(sql);
    expect(await accounts.members.setupDone()).toBe(false);
    const setup = await accounts.members.setup({ name: 'Anna', orgName: 'Lilla Kyrkan' });
    expect(setup).toMatchObject({ userId: 'anna', orgId: 'church' });
    const linked = await accounts.signIn.signInWithGoogle({ sub: 'google-anna', email: 'anna@gmail.com', name: 'Anna' }, await sha256((setup as { inviteToken: string }).inviteToken));
    expect(linked).toEqual({ userId: 'anna', orgId: 'church' });
    expect(f.query('SELECT provider, subject, user_id FROM user_logins')).toEqual([{ provider: 'google', subject: 'google-anna', user_id: 'anna' }]);
    expect(await accounts.members.setupDone()).toBe(true);
    f.close();

    const again = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(again));
    expect(again.query('SELECT count(*) AS n FROM user_logins')).toEqual([{ n: 1 }]);
    again.close();
  });

  it('migrates a version 3 file: Google logins, sessions and flows stay; passkeys can be added beside them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    const file = join(dir, 'global.sqlite');
    const old = openSqlite(file, driver);
    for (const sql of version3Global) old.exec(sql);
    old.close();

    const f = openSqlite(file, driver);
    const sql = nodeGlobalSql(f);
    await migrateGlobal(sql);
    expect(f.query('SELECT version FROM _schema')).toEqual([{ version: GLOBAL_SCHEMA_VERSION }]);
    expect(shape(f)).toEqual(await freshShape(dir));
    expect(f.query('SELECT provider, subject, user_id, name, public_key, sign_count FROM user_logins')).toEqual([
      { provider: 'google', subject: 'google-anna', user_id: 'anna', name: null, public_key: null, sign_count: null },
    ]);
    expect(f.query('SELECT id, revoked_at FROM sessions')).toEqual([{ id: 's1', revoked_at: null }]);
    expect(f.query('SELECT state_hash, link_user_id FROM login_flows')).toEqual([{ state_hash: 'st', link_user_id: null }]);

    // Still set up; Anna signs in with Google, and her session can add a passkey beside it.
    const accounts = new Accounts(sql);
    expect(await accounts.members.setupDone()).toBe(true);
    expect(await accounts.signIn.signInWithGoogle({ sub: 'google-anna', email: 'anna@gmail.com', name: 'Anna' }, null)).toEqual({ userId: 'anna', orgId: 'church' });
    const { sessionId } = await accounts.members.createSession('anna', 'church', 'Mac');
    const added = await accounts.logins.add('anna', sessionId, { provider: 'passkey', passkey: { id: 'cred-1', publicKey: 'cose', signCount: 0, transports: ['internal'] }, name: 'Mac' });
    expect(added).toMatchObject({ provider: 'passkey', id: 'cred-1', name: 'Mac' });
    expect((await accounts.logins.list('anna')).map((l) => l.provider)).toEqual(['google', 'passkey']);
    f.close();

    const again = openSqlite(file, driver);
    await migrateGlobal(nodeGlobalSql(again));
    expect(again.query('SELECT count(*) AS n FROM user_logins')).toEqual([{ n: 2 }]);
    again.close();
  });

  it('a new file gets the current tables', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-migrate-'));
    dirs.push(dir);
    expect(Object.keys(await freshShape(dir))).toEqual(ALL);
  });

  it('refuses a global database newer than this server', () => {
    expect(() => globalSchemaPlan(GLOBAL_SCHEMA_VERSION + 1, true)).toThrow(/newer than this server/);
    expect(globalSchemaPlan(GLOBAL_SCHEMA_VERSION, true)).toEqual([]);
  });
});
