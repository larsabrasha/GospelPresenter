// The global tables' shape and their migrations, oldest first. Order matters: a migration
// runs the versions in turn, and a new database gets `globalDdl` as it stands.
import { schemaMetaDdl } from '@gp/core';
import type { GlobalSql } from './sql.ts';

/** Bumped when a global table changes shape. Separate from the organisation schema, which clients hold. */
export const GLOBAL_SCHEMA_VERSION = 7;

const membershipsDdl = `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`;

/** Version 2 as milestone 3 shipped it (passwords). Frozen: the version 2 migration must make exactly this. */
const accountDdlV2 = [
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
];

/** Version 3 (Google sign-in) as it shipped. Frozen: the version 3 migration must make exactly this. */
const loginDdlV3 = [
  `CREATE TABLE IF NOT EXISTS user_logins (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS user_logins_user ON user_logins (user_id)`,
  // A sign-in between leaving for Google and coming back: single use, 10 minutes, bound to one browser.
  `CREATE TABLE IF NOT EXISTS login_flows (state_hash TEXT PRIMARY KEY NOT NULL, address TEXT NOT NULL,
     nonce TEXT NOT NULL, verifier TEXT NOT NULL, invite_hash TEXT, device_name TEXT NOT NULL, callback_scheme TEXT,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, browser_hash TEXT, used_at INTEGER,
     user_id TEXT, org_id TEXT, handoff_hash TEXT)`,
  `CREATE INDEX IF NOT EXISTS login_flows_address ON login_flows (address, expires_at)`,
];

/**
 * A passkey ceremony between its options and the credential coming back
 * (version 4): single use, 5 minutes, bound to one browser by a cookie, and
 * found by its challenge, which only that browser was given.
 */
const passkeyFlowDdl = [
  `CREATE TABLE IF NOT EXISTS passkey_flows (state_hash TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, address TEXT NOT NULL,
     challenge_hash TEXT, browser_hash TEXT, user_id TEXT, session_id TEXT, invite_hash TEXT, name TEXT,
     device_name TEXT NOT NULL, callback_scheme TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS passkey_flows_challenge ON passkey_flows (challenge_hash) WHERE challenge_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS passkey_flows_address ON passkey_flows (address, expires_at)`,
];

/**
 * A user signs in through a linked login, never a password (docs/sign-in-and-pairing.md,
 * "Sign-in"): a Google account (`provider` 'google', its `sub` as `subject`)
 * or a passkey ('passkey', its credential id, with its COSE public key,
 * signature counter and transports beside it). `name` is the passkey's name,
 * or the Google account's email when it was linked.
 */
const loginDdl = [
  `CREATE TABLE IF NOT EXISTS user_logins (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, name TEXT, public_key TEXT, sign_count INTEGER, transports TEXT,
     PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS user_logins_user ON user_logins (user_id)`,
  // A Google sign-in between leaving for Google and coming back: single use, 10 minutes, bound to one browser.
  // With `link_user_id`, it links the account to that user's session instead of signing in.
  `CREATE TABLE IF NOT EXISTS login_flows (state_hash TEXT PRIMARY KEY NOT NULL, address TEXT NOT NULL,
     nonce TEXT NOT NULL, verifier TEXT NOT NULL, invite_hash TEXT, device_name TEXT NOT NULL, callback_scheme TEXT,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, browser_hash TEXT, used_at INTEGER,
     user_id TEXT, org_id TEXT, handoff_hash TEXT, link_user_id TEXT, link_session_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS login_flows_address ON login_flows (address, expires_at)`,
  ...passkeyFlowDdl,
];

/** The current tables, as a new database gets them. */
const accountDdl = [
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL)`,
  // 01 Q2: only a real address must be unique; users without one are allowed.
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL`,
  ...loginDdl,
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
  pairCodesDdl(),
];

/** A pairing code names the user the device will be signed in as (version 3). */
function pairCodesDdl() {
  return `CREATE TABLE IF NOT EXISTS pair_codes (one INTEGER PRIMARY KEY CHECK (one = 1), code_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL, failures INTEGER NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL)`;
}

/**
 * Version 5: public output codes, so an anonymous `/watch/{code}` finds its
 * organisation (LIVE-R30). Written by the server after a push that changed an
 * organisation's outputs; the code is unique across organisations.
 */
const watchCodesDdl = `CREATE TABLE IF NOT EXISTS watch_codes (code TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, display_id TEXT NOT NULL)`;

/**
 * Temporary screens (spec 04 §5, LIVE-R28) across organisations: a TV that
 * opened `/display` has no organisation until someone pairs it, by its code or
 * by a QR token. `id` is the screen's secret; `org_id` is set once paired.
 */
const screensDdl = [
  `CREATE TABLE IF NOT EXISTS screens (id TEXT PRIMARY KEY NOT NULL, pin TEXT UNIQUE, pin_expires INTEGER, org_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS screen_tokens (token TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, expires INTEGER NOT NULL, screen_id TEXT)`,
];

/**
 * Version 7: what lets a plain `<video src>` stream a video (TODO.md "Video"),
 * which cannot send the session's header. A token names one organisation's
 * one blob, for a few hours, and the session it was minted for: it ends with
 * that session (signing out, revoking). Only its hash is stored, as for every
 * secret. Global, so the Worker finds the organisation from the token alone.
 */
const playTokensDdl = [
  `CREATE TABLE IF NOT EXISTS play_tokens (token_hash TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, media_hash TEXT NOT NULL,
     session_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS play_tokens_expiry ON play_tokens (expires_at)`,
];

export const globalDdl = [membershipsDdl, ...accountDdl, watchCodesDdl, ...screensDdl, ...playTokensDdl];

export const globalMigrations: Record<number, string[]> = {
  // Milestones 1 and 2 had memberships only, for placeholder user ids that
  // no account backs. They would grant nothing, but are dropped all the same.
  2: [...accountDdlV2, `DELETE FROM memberships WHERE user_id NOT IN (SELECT id FROM users)`],
  // Milestone 3 had passwords. They go, with the per-account lockout that
  // guarded them; users, memberships and sessions stay. A user signs in
  // again through a new invite, or on a desktop host through setup or pairing.
  3: [
    ...loginDdlV3,
    `ALTER TABLE users DROP COLUMN password_hash`,
    `DELETE FROM auth_throttle WHERE key LIKE 'account:%'`,
    `ALTER TABLE sessions ADD COLUMN paired_device_id TEXT`,
    // A code waiting to be typed is ten minutes old at most; it names no user, so it goes.
    `DROP TABLE pair_codes`,
    pairCodesDdl(),
  ],
  // Passkeys beside Google: a passkey is a login with its key in the same row.
  // Every login stays; nothing is signed out.
  4: [
    `ALTER TABLE user_logins ADD COLUMN name TEXT`,
    `ALTER TABLE user_logins ADD COLUMN public_key TEXT`,
    `ALTER TABLE user_logins ADD COLUMN sign_count INTEGER`,
    `ALTER TABLE user_logins ADD COLUMN transports TEXT`,
    `ALTER TABLE login_flows ADD COLUMN link_user_id TEXT`,
    `ALTER TABLE login_flows ADD COLUMN link_session_id TEXT`,
    ...passkeyFlowDdl,
  ],
  5: [watchCodesDdl],
  6: screensDdl,
  7: playTokensDdl,
};

/** What to run to bring a global database to GLOBAL_SCHEMA_VERSION; `version` is null without a row. */
export function globalSchemaPlan(version: number | null, hasMemberships: boolean): string[] {
  const from = version ?? (hasMemberships ? 1 : 0);
  if (from > GLOBAL_SCHEMA_VERSION) throw new Error(`the global database has schema ${from}, newer than this server's ${GLOBAL_SCHEMA_VERSION}`);
  const steps: string[] = [];
  if (from === 0) steps.push(...globalDdl);
  else for (let v = from + 1; v <= GLOBAL_SCHEMA_VERSION; v++) steps.push(...globalMigrations[v]!);
  if (from !== GLOBAL_SCHEMA_VERSION) steps.push(`INSERT OR REPLACE INTO _schema (one, version) VALUES (1, ${GLOBAL_SCHEMA_VERSION})`);
  return steps;
}

export async function migrateGlobal(sql: GlobalSql): Promise<void> {
  await sql.run(schemaMetaDdl);
  const [v] = await sql.all('SELECT version FROM _schema WHERE one = 1');
  const [t] = await sql.all("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'memberships'");
  const plan = globalSchemaPlan(v ? Number(v.version) : null, Number(t?.n ?? 0) > 0);
  if (plan.length) await sql.batch(plan.map((s) => [s, []]));
}
