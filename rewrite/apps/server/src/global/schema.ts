// The global tables' shape and their migrations, oldest first. Order matters: a migration
// runs the versions in turn, and a new database gets `globalDdl` as it stands.
import { schemaMetaDdl } from '@gp/core';
import type { GlobalSql } from './sql.ts';

/** Bumped when a global table changes shape. Separate from the organisation schema, which clients hold. */
export const GLOBAL_SCHEMA_VERSION = 10;

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
  // As version 4 made it, with version 10's `person_name`: a new account's name, for an invitation accepted with a passkey.
  passkeyFlowDdl[0]!.replace('used_at INTEGER)', 'used_at INTEGER, person_name TEXT)'),
  ...passkeyFlowDdl.slice(1),
];

/**
 * Version 10 (docs/accounts-and-roles.md): an invitation is a pending membership of an address, accepted by whoever
 * signs in with an account they have or makes one; the `invites` table keeps the links that replace a person's logins.
 * `mailed`: the link went only by mail, so opening it confirms the address. `google_subjects` (a JSON array): a 1.x
 * import's Google logins, which accept it by signing in. A link to an address confirms it (`email_links`). What a
 * Superadmin does to someone else's account is logged (`audit_log`).
 */
const accountsDdlV10 = [
  `CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
     org_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
     mailed INTEGER NOT NULL, google_subjects TEXT, name TEXT, by_user_id TEXT, use_nonce TEXT)`,
  `CREATE INDEX IF NOT EXISTS invitations_org ON invitations (org_id, email)`,
  `CREATE TABLE IF NOT EXISTS email_links (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS email_links_user ON email_links (user_id)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY NOT NULL, at INTEGER NOT NULL, actor_id TEXT NOT NULL,
     action TEXT NOT NULL, target_id TEXT, org_id TEXT, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at)`,
];

/** Only a confirmed address is unique (version 10); an unconfirmed one may be on more than one account until one confirms it. */
const usersEmailIndex = [
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL AND email_confirmed = 1`,
  `CREATE INDEX IF NOT EXISTS users_email_any ON users (email)`,
];

/** The current tables, as a new database gets them. */
const accountDdl = [
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // `super_admin`: the Superadmin mark, which counts where the server's configuration names no Superadmins (a desktop host).
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL, last_org_id TEXT,
     email_confirmed INTEGER NOT NULL DEFAULT 0, super_admin INTEGER NOT NULL DEFAULT 0)`,
  ...usersEmailIndex,
  ...loginDdl,
  // `super_until`: superadminläge is on for this session until then.
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     user_id TEXT NOT NULL, org_id TEXT NOT NULL, device_name TEXT NOT NULL, created_at INTEGER NOT NULL,
     last_used_at INTEGER NOT NULL, revoked_at INTEGER, paired_device_id TEXT, super_until INTEGER)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, org_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, use_nonce TEXT)`,
  `CREATE INDEX IF NOT EXISTS invites_user ON invites (user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_throttle (key TEXT PRIMARY KEY NOT NULL, failures INTEGER NOT NULL,
     first_at INTEGER NOT NULL, locked_until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paired_devices (id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked_at INTEGER)`,
  pairCodesDdl(),
  ...accountsDdlV10,
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

/**
 * Version 9: "Rapportera fel" (docs/bug-reports.md), across organisations, for the Superadmins. Who and where are
 * copied in, so a report outlives a deleted user or organisation. Each report has a thread between a Superadmin and
 * the one who reported (`from_admin`), and when each side last read it.
 */
const bugReportsDdl = [
  `CREATE TABLE IF NOT EXISTS bug_reports (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, text TEXT NOT NULL,
     shot TEXT, state TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, user_email TEXT, role TEXT NOT NULL,
     org_id TEXT NOT NULL, org_name TEXT NOT NULL, done_at INTEGER, admin_read_at INTEGER, reporter_read_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS bug_reports_created ON bug_reports (created_at)`,
  `CREATE INDEX IF NOT EXISTS bug_reports_user ON bug_reports (user_id)`,
  `CREATE TABLE IF NOT EXISTS bug_report_messages (id TEXT PRIMARY KEY NOT NULL, report_id TEXT NOT NULL,
     created_at INTEGER NOT NULL, from_admin INTEGER NOT NULL, user_name TEXT NOT NULL, text TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS bug_report_messages_report ON bug_report_messages (report_id, created_at)`,
];

export const globalDdl = [membershipsDdl, ...accountDdl, watchCodesDdl, ...screensDdl, ...playTokensDdl, ...bugReportsDdl];

const globalMigrations: Record<number, string[]> = {
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
  // The organisation a user last switched to, which their next sign-in opens (spec 01 `LastSelectedOrganizationId`).
  8: [`ALTER TABLE users ADD COLUMN last_org_id TEXT`],
  9: bugReportsDdl,
  // The account is the person's (docs/accounts-and-roles.md). Every login and session stays.
  10: [
    `ALTER TABLE users ADD COLUMN email_confirmed INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN super_until INTEGER`,
    `ALTER TABLE passkey_flows ADD COLUMN person_name TEXT`,
    // The addresses here are not asked again (Lars, 2026-11-08): one a linked Google account has is confirmed.
    `UPDATE users SET email_confirmed = 1 WHERE email IS NOT NULL
       AND EXISTS (SELECT 1 FROM user_logins l WHERE l.user_id = users.id AND l.provider = 'google' AND lower(l.name) = users.email)`,
    `DROP INDEX users_email`,
    ...usersEmailIndex,
    // A SuperAdmin membership becomes the mark on the account and an Admin membership.
    `UPDATE users SET super_admin = 1 WHERE id IN (SELECT user_id FROM memberships WHERE role = 'superAdmin')`,
    `UPDATE memberships SET role = 'admin' WHERE role = 'superAdmin'`,
    // An unused link that would replace the logins of someone who can sign in was how an Admin took an account over.
    `DELETE FROM invites WHERE used_at IS NULL AND user_id IN (SELECT user_id FROM user_logins)`,
    ...accountsDdlV10,
  ],
};

/**
 * What to run to bring a global database to GLOBAL_SCHEMA_VERSION (or to `target`, for the tests of one migration);
 * `version` is null without a row.
 */
export function globalSchemaPlan(version: number | null, hasMemberships: boolean, target = GLOBAL_SCHEMA_VERSION): string[] {
  const from = version ?? (hasMemberships ? 1 : 0);
  if (from > GLOBAL_SCHEMA_VERSION) throw new Error(`the global database has schema ${from}, newer than this server's ${GLOBAL_SCHEMA_VERSION}`);
  const steps: string[] = [];
  if (from === 0) steps.push(...globalDdl);
  else for (let v = from + 1; v <= target; v++) steps.push(...globalMigrations[v]!);
  if (from !== target) steps.push(`INSERT OR REPLACE INTO _schema (one, version) VALUES (1, ${from === 0 ? GLOBAL_SCHEMA_VERSION : target})`);
  return steps;
}

export async function migrateGlobal(sql: GlobalSql): Promise<void> {
  await sql.run(schemaMetaDdl);
  const [v] = await sql.all('SELECT version FROM _schema WHERE one = 1');
  const [t] = await sql.all("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'memberships'");
  const plan = globalSchemaPlan(v ? Number(v.version) : null, Number(t?.n ?? 0) > 0);
  if (plan.length) await sql.batch(plan.map((s) => [s, []]));
}
