// The global tables (D1 on Workers, global.sqlite on Node): users, their
// linked logins, organisations, memberships, sessions, invites, sign-ins in
// progress, throttling and the desktop host's paired devices. Written once,
// in SQL, against `GlobalSql`.
//
// D1 has no interactive transactions, so nothing here reads, decides and then
// writes across awaits where a race would matter: each such step is one
// conditional statement, or a `batch` of them, which both runtimes run atomically.
import { ACCOUNT_LIMITS, schemaMetaDdl, type AuthError, type InviteState, type Me, type PairedDevice, type Role, type UserRow } from '@gp/core';
import { constantTimeEqual, newRowId, newSecret, sha256 } from './crypto.ts';
import type { GoogleIdentity } from './google.ts';

export type Row = Record<string, unknown>;

/** One global database, whichever runtime holds it. */
export interface GlobalSql {
  all(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs one statement; resolves to the number of rows it changed. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** Runs the statements in order, atomically; resolves to each one's changed rows. */
  batch(statements: [sql: string, params: unknown[]][]): Promise<number[]>;
}

/** Bumped when a global table changes shape. Separate from the organisation schema, which clients hold. */
export const GLOBAL_SCHEMA_VERSION = 3;

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

/**
 * Version 3: Google sign-in (README, "Sign-in"). A user signs in through a
 * linked login, never a password. `provider` is 'google' today; a passkey
 * will be a row with provider 'passkey' and its credential id as `subject`.
 */
const loginDdl = [
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

export const globalDdl = [membershipsDdl, ...accountDdl];

export const globalMigrations: Record<number, string[]> = {
  // Milestones 1 and 2 had memberships only, for placeholder user ids that
  // no account backs. They would grant nothing, but are dropped all the same.
  2: [...accountDdlV2, `DELETE FROM memberships WHERE user_id NOT IN (SELECT id FROM users)`],
  // Milestone 3 had passwords. They go, with the per-account lockout that
  // guarded them; users, memberships and sessions stay. A user signs in
  // again through a new invite, or on a desktop host through setup or pairing.
  3: [
    ...loginDdl,
    `ALTER TABLE users DROP COLUMN password_hash`,
    `DELETE FROM auth_throttle WHERE key LIKE 'account:%'`,
    `ALTER TABLE sessions ADD COLUMN paired_device_id TEXT`,
    // A code waiting to be typed is ten minutes old at most; it names no user, so it goes.
    `DROP TABLE pair_codes`,
    pairCodesDdl(),
  ],
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

/** How sign-in failures slow an attacker down (README, "Assumptions"). */
export interface ThrottlePolicy {
  /** Failures allowed in `windowMs` before a lock. */
  free: number;
  windowMs: number;
  /** The first lock; each further failure doubles it, up to `maxLockMs`. */
  lockMs: number;
  maxLockMs: number;
}

export const THROTTLE = {
  /** Per address: slows one machine trying setup tokens or pairing codes. */
  address: { free: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxLockMs: 15 * 60_000 },
} satisfies Record<string, ThrottlePolicy>;

/** A sign-in that left for Google, as the callback finds it. */
export interface LoginFlow {
  nonce: string;
  verifier: string;
  inviteHash: string | null;
  deviceName: string;
  /** Set when a desktop app gets the token through its callback scheme; null for this browser. */
  callbackScheme: string | null;
}

/** How long a sign-in may take from start to callback, and the most one address may have open. */
export const LOGIN_FLOW = { ttlMs: 10 * 60_000, perAddress: 20 } as const;

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string;
  /** Null when the user is no longer a member of the session's organisation. */
  role: Role | null;
}

export interface AccountOptions {
  now?: () => number;
  /** A session unused for this long is refused (ACCOUNT_LIMITS.sessionIdleMs by default). */
  sessionIdleMs?: number;
}

/** Every read and write of the global tables. Methods return an error code instead of throwing for expected refusals. */
export class Accounts {
  readonly now: () => number;
  private readonly idleMs: number;

  constructor(
    readonly sql: GlobalSql,
    opts: AccountOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.idleMs = opts.sessionIdleMs ?? ACCOUNT_LIMITS.sessionIdleMs;
  }

  /** Whether the first run is finished: some user has linked a sign-in (AUTH-R12). */
  async setupDone(): Promise<boolean> {
    return (await this.sql.all('SELECT 1 FROM user_logins LIMIT 1')).length > 0;
  }

  /**
   * First run (spec 01 `/setup`, D19): the organisation and its SuperAdmin,
   * with an invite that links the SuperAdmin's Google account. Setup is not
   * done until that link exists, so a setup that was left before signing in
   * (or a SuperAdmin from milestone 3, who had a password) can be finished
   * again: the existing SuperAdmin and organisation are renamed and get a new
   * invite rather than a second organisation being made. Every statement is
   * guarded by "no login exists", so a setup racing a finished one changes nothing.
   */
  async setup(a: { name: string; orgName: string }): Promise<{ userId: string; orgId: string; inviteToken: string } | 'setup-done'> {
    const noLogin = `NOT EXISTS (SELECT 1 FROM user_logins)`;
    const [existing] = await this.sql.all(
      `SELECT m.user_id, m.org_id FROM memberships m JOIN users u ON u.id = m.user_id JOIN orgs o ON o.id = m.org_id
       WHERE m.role = 'superAdmin' ORDER BY u.created_at, u.id LIMIT 1`,
    );
    const userId = existing ? String(existing.user_id) : newRowId();
    const orgId = existing ? String(existing.org_id) : newRowId();
    const inviteToken = newSecret('gpin_');
    const now = this.now();
    const invite: [string, unknown[]] = [
      `INSERT INTO invites (token_hash, user_id, org_id, created_at, expires_at) SELECT ?, ?, ?, ?, ?
       WHERE ${noLogin} AND EXISTS (SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ? AND role = 'superAdmin')`,
      [await sha256(inviteToken), userId, orgId, now, now + ACCOUNT_LIMITS.inviteTtlMs, userId, orgId],
    ];
    const changed = existing
      ? await this.sql.batch([
          [`UPDATE users SET name = ? WHERE id = ? AND ${noLogin}`, [a.name, userId]],
          [`UPDATE orgs SET name = ? WHERE id = ? AND ${noLogin}`, [a.orgName, orgId]],
          // Only the newest setup invite is meant to be used.
          [`DELETE FROM invites WHERE user_id = ? AND used_at IS NULL AND ${noLogin}`, [userId]],
          invite,
        ])
      : await this.sql.batch([
          [
            `INSERT INTO users (id, name, created_at) SELECT ?, ?, ?
             WHERE ${noLogin} AND NOT EXISTS (SELECT 1 FROM memberships WHERE role = 'superAdmin')`,
            [userId, a.name, now],
          ],
          [`INSERT INTO orgs (id, name, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`, [orgId, a.orgName, now, userId]],
          [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, 'superAdmin' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`, [userId, orgId, userId]],
          invite,
        ]);
    return changed.at(-1) === 1 ? { userId, orgId, inviteToken } : 'setup-done';
  }

  /**
   * A new session token for a device. Beyond the cap, the least recently used
   * sessions are revoked (AUTH-R8). A session made by pairing names its paired
   * device, so disconnecting the device ends it too.
   */
  async createSession(userId: string, orgId: string, deviceName: string, pairedDeviceId: string | null = null): Promise<{ token: string; sessionId: string }> {
    const token = newSecret('gpdt_');
    const id = newRowId();
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO sessions (id, token_hash, user_id, org_id, device_name, created_at, last_used_at, paired_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, await sha256(token), userId, orgId, deviceName || 'App', now, now, pairedDeviceId],
      ],
      [
        `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN
           (SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_used_at DESC, created_at DESC LIMIT ?)`,
        [now, userId, userId, ACCOUNT_LIMITS.activeSessionsPerUser],
      ],
    ]);
    return { token, sessionId: id };
  }

  /**
   * The session a bearer token names, with the user's role read now (D22,
   * AUTH-R7): a role change applies from the next request.
   */
  async session(token: string): Promise<SessionInfo | null> {
    if (!token.startsWith('gpdt_')) return null;
    const [r] = await this.sql.all(
      `SELECT s.id, s.user_id, s.org_id, s.last_used_at, s.revoked_at, m.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
       WHERE s.token_hash = ?`,
      [await sha256(token)],
    );
    if (!r || r.revoked_at !== null) return null;
    const now = this.now();
    const lastUsed = Number(r.last_used_at);
    if (now - lastUsed > this.idleMs) return null;
    // Renewing on every request would write on every request; a fraction of the idle limit is enough.
    if (now - lastUsed > Math.min(5 * 60_000, this.idleMs / 4)) {
      await this.sql.run('UPDATE sessions SET last_used_at = ? WHERE id = ?', [now, r.id]);
    }
    return { sessionId: String(r.id), userId: String(r.user_id), orgId: String(r.org_id), role: (r.role as Role | null) ?? null };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sql.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [this.now(), sessionId]);
  }

  async me(s: SessionInfo & { role: Role }): Promise<Me | null> {
    const [r] = await this.sql.all(
      `SELECT u.name, u.email, o.name AS org_name FROM users u JOIN orgs o ON o.id = ? WHERE u.id = ?`,
      [s.orgId, s.userId],
    );
    if (!r) return null;
    return {
      userId: s.userId,
      name: String(r.name),
      email: (r.email as string | null) ?? null,
      role: s.role,
      orgId: s.orgId,
      orgName: String(r.org_name),
      sessionId: s.sessionId,
    };
  }

  /** A user of `orgId`, with their role there; null for anyone else (PERM-R3). */
  async member(userId: string, orgId: string): Promise<{ id: string; role: Role } | null> {
    const [r] = await this.sql.all('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
    return r ? { id: userId, role: r.role as Role } : null;
  }

  /** The organisation's users by name (ORG-R11), each with their newest unused invite. */
  async listUsers(orgId: string): Promise<UserRow[]> {
    const now = this.now();
    const rows = await this.sql.all(
      `SELECT u.id, u.name, u.email, m.role, EXISTS (SELECT 1 FROM user_logins l WHERE l.user_id = u.id) AS active,
         (SELECT max(expires_at) FROM invites i WHERE i.user_id = u.id AND i.org_id = m.org_id AND i.used_at IS NULL) AS invite_expires
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY u.name COLLATE NOCASE, u.id`,
      [orgId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      email: (r.email as string | null) ?? null,
      role: r.role as Role,
      active: Number(r.active) === 1,
      invite: r.invite_expires === null ? null : { expiresAt: Number(r.invite_expires), expired: Number(r.invite_expires) <= now },
    }));
  }

  /** A new user in `orgId` with an invite, in one batch (AUTH-R2). */
  async createUser(orgId: string, a: { name: string; email: string; role: Role }): Promise<{ id: string; inviteToken: string } | 'email-taken' | 'limit'> {
    const [taken] = await this.sql.all('SELECT 1 FROM users WHERE email = ?', [a.email]);
    if (taken) return 'email-taken';
    const id = newRowId();
    const inviteToken = newSecret('gpin_');
    const now = this.now();
    const mine = `EXISTS (SELECT 1 FROM users WHERE id = ?)`;
    let inserted: number | undefined;
    try {
      [inserted] = await this.sql.batch([
        [
          `INSERT INTO users (id, name, email, created_at) SELECT ?, ?, ?, ?
           WHERE (SELECT count(*) FROM memberships WHERE org_id = ?) < ?`,
          [id, a.name, a.email, now, orgId, ACCOUNT_LIMITS.usersPerOrg],
        ],
        [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, ? WHERE ${mine}`, [id, orgId, a.role, id]],
        [
          `INSERT INTO invites (token_hash, user_id, org_id, created_at, expires_at) SELECT ?, ?, ?, ?, ? WHERE ${mine}`,
          [await sha256(inviteToken), id, orgId, now, now + ACCOUNT_LIMITS.inviteTtlMs, id],
        ],
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'email-taken'; // a concurrent create with the same address
      throw e;
    }
    return inserted === 1 ? { id, inviteToken } : 'limit';
  }

  /** A new invite for a member, at most 20 unused per user, expired ones included (AUTH-R3). */
  async createInvite(userId: string, orgId: string): Promise<string | 'limit'> {
    const token = newSecret('gpin_');
    const now = this.now();
    const n = await this.sql.run(
      `INSERT INTO invites (token_hash, user_id, org_id, created_at, expires_at) SELECT ?, ?, ?, ?, ?
       WHERE (SELECT count(*) FROM invites WHERE user_id = ? AND used_at IS NULL) < ?`,
      [await sha256(token), userId, orgId, now, now + ACCOUNT_LIMITS.inviteTtlMs, userId, ACCOUNT_LIMITS.unusedInvitesPerUser],
    );
    return n === 1 ? token : 'limit';
  }

  async invite(token: string): Promise<InviteState> {
    if (!token.startsWith('gpin_')) return { state: 'invalid' };
    const [r] = await this.sql.all(
      `SELECT i.expires_at, i.used_at, u.name, u.email, o.name AS org_name
       FROM invites i JOIN users u ON u.id = i.user_id JOIN orgs o ON o.id = i.org_id
       JOIN memberships m ON m.user_id = i.user_id AND m.org_id = i.org_id
       WHERE i.token_hash = ?`,
      [await sha256(token)],
    );
    if (!r || r.used_at !== null) return { state: 'invalid' };
    if (Number(r.expires_at) <= this.now()) return { state: 'expired' };
    return { state: 'valid', name: String(r.name), orgName: String(r.org_name), email: (r.email as string | null) ?? null };
  }

  // ------------------------------------------------------------ sign-in with Google

  /**
   * A sign-in about to leave for Google. Its `state` is the returned secret;
   * only its hash is kept. At most LOGIN_FLOW.perAddress unfinished per address,
   * so a stranger cannot fill the table; old ones are swept here.
   */
  async createFlow(a: { address: string; inviteToken: string | null; deviceName: string; callbackScheme: string | null }): Promise<string | 'limit'> {
    const state = newSecret('');
    const now = this.now();
    const [, inserted] = await this.sql.batch([
      ['DELETE FROM login_flows WHERE expires_at < ?', [now - 24 * 60 * 60_000]],
      [
        `INSERT INTO login_flows (state_hash, address, nonce, verifier, invite_hash, device_name, callback_scheme, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT count(*) FROM login_flows WHERE address = ? AND used_at IS NULL AND expires_at > ?) < ?`,
        [
          await sha256(state),
          a.address,
          newSecret(''),
          newSecret(''), // the PKCE verifier: 43 characters of [A-Za-z0-9_-], as RFC 7636 asks
          a.inviteToken ? await sha256(a.inviteToken) : null,
          a.deviceName.slice(0, 200) || 'App',
          a.callbackScheme,
          now,
          now + LOGIN_FLOW.ttlMs,
          a.address,
          now,
          LOGIN_FLOW.perAddress,
        ],
      ],
    ]);
    return inserted === 1 ? state : 'limit';
  }

  /**
   * Binds a flow to the browser that opens it first (its hash of `browser`,
   * a secret in that browser's cookie) and gives what the authorization
   * request needs. A flow starts once.
   */
  async startFlow(state: string, browser: string): Promise<{ nonce: string; verifier: string } | null> {
    const hash = await sha256(state);
    const n = await this.sql.run('UPDATE login_flows SET browser_hash = ? WHERE state_hash = ? AND browser_hash IS NULL AND used_at IS NULL AND expires_at > ?', [
      await sha256(browser),
      hash,
      this.now(),
    ]);
    if (n !== 1) return null;
    const [r] = await this.sql.all('SELECT nonce, verifier FROM login_flows WHERE state_hash = ?', [hash]);
    return r ? { nonce: String(r.nonce), verifier: String(r.verifier) } : null;
  }

  /**
   * The callback's flow: the one `state` names, in the browser that started
   * it, not expired, and not used before. Taking it uses it, so a replayed
   * callback finds nothing.
   */
  async takeFlow(state: string, browser: string): Promise<LoginFlow | null> {
    const hash = await sha256(state);
    const now = this.now();
    const n = await this.sql.run('UPDATE login_flows SET used_at = ? WHERE state_hash = ? AND browser_hash = ? AND used_at IS NULL AND expires_at > ?', [
      now,
      hash,
      await sha256(browser),
      now,
    ]);
    if (n !== 1) return null;
    const [r] = await this.sql.all('SELECT nonce, verifier, invite_hash, device_name, callback_scheme FROM login_flows WHERE state_hash = ?', [hash]);
    if (!r) return null;
    return {
      nonce: String(r.nonce),
      verifier: String(r.verifier),
      inviteHash: (r.invite_hash as string | null) ?? null,
      deviceName: String(r.device_name),
      callbackScheme: (r.callback_scheme as string | null) ?? null,
    };
  }

  /** After a web sign-in: who signed in, waiting for the page to collect it with `handoff` (a secret in its cookie). */
  async setHandoff(state: string, handoff: string, userId: string, orgId: string): Promise<void> {
    await this.sql.run('UPDATE login_flows SET handoff_hash = ?, user_id = ?, org_id = ? WHERE state_hash = ?', [await sha256(handoff), userId, orgId, await sha256(state)]);
  }

  /** Collects a web sign-in, once, before its flow expires. */
  async takeHandoff(handoff: string): Promise<{ userId: string; orgId: string } | null> {
    const hash = await sha256(handoff);
    const now = this.now();
    const [r] = await this.sql.all('SELECT state_hash, user_id, org_id FROM login_flows WHERE handoff_hash = ? AND expires_at > ?', [hash, now]);
    if (!r || r.user_id === null) return null;
    const n = await this.sql.run('UPDATE login_flows SET handoff_hash = NULL WHERE state_hash = ? AND handoff_hash = ?', [r.state_hash, hash]);
    return n === 1 ? { userId: String(r.user_id), orgId: String(r.org_id) } : null;
  }

  /**
   * Who a verified Google identity signs in as (spec 01 callback rules).
   * Without an invite: the user its `sub` is linked to, or no one (AUTH-R4:
   * no self-registration, and never a match by email). With an invite: the
   * invited user, whose Google login becomes this one. That replaces the
   * Google account they had and revokes their sessions, since a new invite
   * is also how an admin resets a lost account. The invite is used in the
   * same batch, so it is spent only by a sign-in that succeeds.
   */
  async signInWithGoogle(id: GoogleIdentity, inviteHash: string | null): Promise<{ userId: string; orgId: string } | AuthError> {
    const now = this.now();
    const [linked] = await this.sql.all("SELECT user_id FROM user_logins WHERE provider = 'google' AND subject = ?", [id.sub]);
    let userId: string;
    if (!inviteHash) {
      if (!linked) return 'not-linked';
      userId = String(linked.user_id);
      await this.sql.run("UPDATE user_logins SET last_used_at = ? WHERE provider = 'google' AND subject = ?", [now, id.sub]);
    } else {
      const [inv] = await this.sql.all(
        `SELECT i.user_id, i.expires_at, i.used_at FROM invites i JOIN memberships m ON m.user_id = i.user_id AND m.org_id = i.org_id
         WHERE i.token_hash = ?`,
        [inviteHash],
      );
      if (!inv || inv.used_at !== null) return 'invite-invalid';
      if (Number(inv.expires_at) <= now) return 'invite-expired';
      userId = String(inv.user_id);
      // E4 in spec 01 signs in as the invited user while the login stays with another; here it is refused.
      if (linked && String(linked.user_id) !== userId) return 'login-taken';
      const nonce = newRowId();
      const used = `(SELECT user_id FROM invites WHERE token_hash = ? AND use_nonce = ?)`;
      let claimed: number | undefined;
      try {
        [claimed] = await this.sql.batch([
          [`UPDATE invites SET used_at = ?, use_nonce = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, [now, nonce, inviteHash, now]],
          [`DELETE FROM user_logins WHERE provider = 'google' AND user_id = ${used}`, [inviteHash, nonce]],
          [
            `INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at) SELECT 'google', ?, user_id, ?, ?
             FROM invites WHERE token_hash = ? AND use_nonce = ?`,
            [id.sub, now, now, inviteHash, nonce],
          ],
          // Spec 01: an empty email is filled from Google's, unless another user has that address.
          [
            `UPDATE users SET email = ? WHERE id = ${used} AND email IS NULL AND ? IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
            [id.email, inviteHash, nonce, id.email, id.email],
          ],
          [`UPDATE sessions SET revoked_at = ? WHERE user_id = ${used} AND revoked_at IS NULL`, [now, inviteHash, nonce]],
        ]);
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) return 'login-taken'; // linked to someone else meanwhile; the batch rolled back
        throw e;
      }
      if (claimed !== 1) return 'invite-invalid';
    }
    const [m] = await this.sql.all('SELECT org_id FROM memberships WHERE user_id = ? ORDER BY org_id LIMIT 1', [userId]);
    return m ? { userId, orgId: String(m.org_id) } : 'not-a-member';
  }

  async setRole(userId: string, orgId: string, role: Role): Promise<void> {
    await this.sql.run('UPDATE memberships SET role = ? WHERE user_id = ? AND org_id = ?', [role, userId, orgId]);
  }

  /** Removes a user for good (ORG-R12): their logins, sessions, invites and memberships go with them. */
  async deleteUser(userId: string): Promise<void> {
    await this.sql.batch([
      ['DELETE FROM user_logins WHERE user_id = ?', [userId]],
      ['DELETE FROM sessions WHERE user_id = ?', [userId]],
      ['DELETE FROM invites WHERE user_id = ?', [userId]],
      ['DELETE FROM memberships WHERE user_id = ?', [userId]],
      ['DELETE FROM users WHERE id = ?', [userId]],
    ]);
  }

  // ------------------------------------------------------------ throttling

  /** Until when any of `keys` is locked (0 when none is). */
  async lockedUntil(keys: string[]): Promise<number> {
    const rows = await this.sql.all(`SELECT max(locked_until) AS t FROM auth_throttle WHERE key IN (${keys.map(() => '?').join(', ')})`, keys);
    const t = Number(rows[0]?.t ?? 0);
    return t > this.now() ? t : 0;
  }

  /** Counts a failure for `key`; a failure after the window starts a new one. */
  async fail(key: string, p: ThrottlePolicy): Promise<void> {
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO auth_throttle (key, failures, first_at, locked_until) VALUES (?, 1, ?, 0)
         ON CONFLICT (key) DO UPDATE SET
           failures = CASE WHEN ? - first_at > ? THEN 1 ELSE failures + 1 END,
           first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`,
        [key, now, now, p.windowMs, now, p.windowMs, now],
      ],
      [
        `UPDATE auth_throttle SET locked_until = ? + min(?, ? * (1 << min(failures - ?, 20)))
         WHERE key = ? AND failures >= ?`,
        [now, p.maxLockMs, p.lockMs, p.free, key, p.free],
      ],
    ]);
  }

  async clearThrottle(key: string): Promise<void> {
    await this.sql.run('DELETE FROM auth_throttle WHERE key = ?', [key]);
  }

  // ------------------------------------------------------------ pairing (desktop host)

  /** A new pairing code, which will sign the device in as `userId`; it replaces any earlier one (LIVE-R28: one code at a time). */
  async newPairCode(code: string, ttlMs: number, userId: string, orgId: string): Promise<number> {
    const expiresAt = this.now() + ttlMs;
    await this.sql.run('INSERT OR REPLACE INTO pair_codes (one, code_hash, expires_at, failures, user_id, org_id) VALUES (1, ?, ?, 0, ?, ?)', [
      await sha256(code),
      expiresAt,
      userId,
      orgId,
    ]);
    return expiresAt;
  }

  /**
   * Trades the code for a device token and the user it pairs the device as:
   * single use, refused once expired, and the code dies after `attempts`
   * wrong guesses.
   */
  async claimPairCode(code: string, name: string, attempts: number): Promise<{ token: string; deviceId: string; userId: string; orgId: string } | null> {
    const [r] = await this.sql.all('SELECT code_hash, expires_at, user_id, org_id FROM pair_codes WHERE one = 1');
    if (!r || Number(r.expires_at) <= this.now()) return null;
    const hash = await sha256(code);
    if (!constantTimeEqual(hash, String(r.code_hash))) {
      await this.sql.batch([
        ['UPDATE pair_codes SET failures = failures + 1 WHERE one = 1', []],
        ['DELETE FROM pair_codes WHERE one = 1 AND failures >= ?', [attempts]],
      ]);
      return null;
    }
    const token = newSecret('gppd_');
    const deviceId = newRowId();
    const now = this.now();
    // Deleting is the claim: of two racing claims, one deletes the row.
    if ((await this.sql.run('DELETE FROM pair_codes WHERE one = 1 AND code_hash = ? AND expires_at > ?', [hash, now])) !== 1) return null;
    await this.sql.run('INSERT INTO paired_devices (id, token_hash, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)', [
      deviceId,
      await sha256(token),
      name,
      now,
      now,
    ]);
    return { token, deviceId, userId: String(r.user_id), orgId: String(r.org_id) };
  }

  /** Whether `token` names a paired device that has not been disconnected. */
  async pairedDevice(token: string): Promise<boolean> {
    if (!token.startsWith('gppd_')) return false;
    const [r] = await this.sql.all('SELECT id, last_used_at FROM paired_devices WHERE token_hash = ? AND revoked_at IS NULL', [await sha256(token)]);
    if (!r) return false;
    const now = this.now();
    if (now - Number(r.last_used_at) > 5 * 60_000) await this.sql.run('UPDATE paired_devices SET last_used_at = ? WHERE id = ?', [now, r.id]);
    return true;
  }

  async pairedDevices(): Promise<PairedDevice[]> {
    const rows = await this.sql.all('SELECT id, name, created_at, last_used_at, revoked_at FROM paired_devices ORDER BY created_at DESC');
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.last_used_at),
      revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
    }));
  }

  /** Disconnects a device, and ends the sessions its pairing made. */
  async revokeDevice(id: string): Promise<boolean> {
    const now = this.now();
    const [n] = await this.sql.batch([
      ['UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now, id]],
      ['UPDATE sessions SET revoked_at = ? WHERE paired_device_id = ? AND revoked_at IS NULL', [now, id]],
    ]);
    return n === 1;
  }

  // ------------------------------------------------------------ tests

  /** Debug servers only: how many rows the tables that hold credentials have. */
  async debugCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['sessions', 'login_flows', 'user_logins', 'invites']) out[t] = Number((await this.sql.all(`SELECT count(*) AS n FROM ${t}`))[0]?.n ?? 0);
    return out;
  }

  /** Debug servers only: a user (made if missing) with a role in `orgId`, and a fresh session. */
  async debugSession(userId: string, orgId: string, role: Role): Promise<string> {
    const now = this.now();
    await this.sql.batch([
      ['INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [userId, userId, now]],
      ['INSERT OR IGNORE INTO orgs (id, name, created_at) VALUES (?, ?, ?)', [orgId, orgId, now]],
      ['INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [userId, orgId, role]],
    ]);
    return (await this.createSession(userId, orgId, 'test')).token;
  }
}
