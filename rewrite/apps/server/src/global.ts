// The global tables (D1 on Workers, global.sqlite on Node): users,
// organisations, memberships, sessions, invites, sign-in throttling and the
// desktop host's paired devices. Written once, in SQL, against `GlobalSql`.
//
// D1 has no interactive transactions, so nothing here reads, decides and then
// writes across awaits where a race would matter: each such step is one
// conditional statement, or a `batch` of them, which both runtimes run atomically.
import { ACCOUNT_LIMITS, schemaMetaDdl, type InviteState, type Me, type PairedDevice, type Role, type UserRow } from '@gp/core';
import { constantTimeEqual, newRowId, newSecret, sha256 } from './crypto.ts';

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
export const GLOBAL_SCHEMA_VERSION = 2;

const membershipsDdl = `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL,
     PRIMARY KEY (user_id, org_id))`;

/** Version 2: real accounts (milestone 3). */
const accountDdl = [
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT,
     password_hash TEXT, created_at INTEGER NOT NULL)`,
  // 01 Q2: only a real address must be unique; users without one are allowed.
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

export const globalDdl = [membershipsDdl, ...accountDdl];

export const globalMigrations: Record<number, string[]> = {
  // Milestones 1 and 2 had memberships only, for placeholder user ids that
  // no account backs. They would grant nothing, but are dropped all the same.
  2: [...accountDdl, `DELETE FROM memberships WHERE user_id NOT IN (SELECT id FROM users)`],
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
  /** Per account: slows guessing one password, but never locks the owner out for long. */
  account: { free: 5, windowMs: 15 * 60_000, lockMs: 60_000, maxLockMs: 15 * 60_000 },
  /** Per address: slows one machine trying many accounts, setup tokens or pairing codes. */
  address: { free: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxLockMs: 15 * 60_000 },
} satisfies Record<string, ThrottlePolicy>;

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

  async hasUsers(): Promise<boolean> {
    return (await this.sql.all('SELECT 1 FROM users LIMIT 1')).length > 0;
  }

  /**
   * First run (spec 01 `/setup`): the organisation and its SuperAdmin, only
   * while no user exists. The first statement is the guard, so two racing
   * setups cannot both succeed.
   */
  async setup(a: { name: string; orgName: string; email: string; passwordHash: string }): Promise<{ userId: string; orgId: string } | 'setup-done'> {
    const userId = newRowId();
    const orgId = newRowId();
    const now = this.now();
    const mine = `EXISTS (SELECT 1 FROM users WHERE id = ?)`;
    const [inserted] = await this.sql.batch([
      [
        `INSERT INTO users (id, name, email, password_hash, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
        [userId, a.name, a.email, a.passwordHash, now],
      ],
      [`INSERT INTO orgs (id, name, created_at) SELECT ?, ?, ? WHERE ${mine}`, [orgId, a.orgName, now, userId]],
      [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, 'superAdmin' WHERE ${mine}`, [userId, orgId, userId]],
    ]);
    return inserted === 1 ? { userId, orgId } : 'setup-done';
  }

  async userByEmail(email: string): Promise<{ id: string; passwordHash: string | null; orgId: string | null } | null> {
    const [r] = await this.sql.all(
      `SELECT u.id, u.password_hash, (SELECT org_id FROM memberships WHERE user_id = u.id ORDER BY org_id LIMIT 1) AS org_id
       FROM users u WHERE u.email = ?`,
      [email],
    );
    return r ? { id: String(r.id), passwordHash: (r.password_hash as string | null) ?? null, orgId: (r.org_id as string | null) ?? null } : null;
  }

  /** A new session token for a device. Beyond the cap, the least recently used sessions are revoked (AUTH-R8). */
  async createSession(userId: string, orgId: string, deviceName: string): Promise<{ token: string; sessionId: string }> {
    const token = newSecret('gpdt_');
    const id = newRowId();
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO sessions (id, token_hash, user_id, org_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, await sha256(token), userId, orgId, deviceName || 'App', now, now],
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
      `SELECT u.id, u.name, u.email, m.role, u.password_hash IS NOT NULL AS active,
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

  /**
   * Uses an invite (AUTH-R1): marks it used, sets the password, and revokes
   * the user's other sessions, since a new password is also how an admin
   * resets a forgotten one. One batch; the first statement is the guard.
   */
  async acceptInvite(token: string, passwordHash: string): Promise<{ userId: string; orgId: string } | 'invite-invalid' | 'invite-expired'> {
    const state = await this.invite(token);
    if (state.state === 'expired') return 'invite-expired';
    if (state.state !== 'valid') return 'invite-invalid';
    const hash = await sha256(token);
    const now = this.now();
    const nonce = newRowId();
    const used = `(SELECT user_id FROM invites WHERE token_hash = ? AND use_nonce = ?)`;
    const [claimed] = await this.sql.batch([
      [`UPDATE invites SET used_at = ?, use_nonce = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, [now, nonce, hash, now]],
      [`UPDATE users SET password_hash = ? WHERE id = ${used}`, [passwordHash, hash, nonce]],
      [`UPDATE sessions SET revoked_at = ? WHERE user_id = ${used} AND revoked_at IS NULL`, [now, hash, nonce]],
    ]);
    if (claimed !== 1) return 'invite-invalid';
    const [r] = await this.sql.all('SELECT user_id, org_id FROM invites WHERE token_hash = ?', [hash]);
    return { userId: String(r!.user_id), orgId: String(r!.org_id) };
  }

  async setRole(userId: string, orgId: string, role: Role): Promise<void> {
    await this.sql.run('UPDATE memberships SET role = ? WHERE user_id = ? AND org_id = ?', [role, userId, orgId]);
  }

  /** Removes a user for good (ORG-R12): their sessions, invites and memberships go with them. */
  async deleteUser(userId: string): Promise<void> {
    await this.sql.batch([
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

  /** A new pairing code; it replaces any earlier one (LIVE-R28: one code at a time). */
  async newPairCode(code: string, ttlMs: number): Promise<number> {
    const expiresAt = this.now() + ttlMs;
    await this.sql.run('INSERT OR REPLACE INTO pair_codes (one, code_hash, expires_at, failures) VALUES (1, ?, ?, 0)', [await sha256(code), expiresAt]);
    return expiresAt;
  }

  /**
   * Trades the code for a device token: single use, refused once expired,
   * and the code dies after `attempts` wrong guesses.
   */
  async claimPairCode(code: string, name: string, attempts: number): Promise<string | null> {
    const [r] = await this.sql.all('SELECT code_hash, expires_at FROM pair_codes WHERE one = 1');
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
    const now = this.now();
    // Deleting is the claim: of two racing claims, one deletes the row.
    if ((await this.sql.run('DELETE FROM pair_codes WHERE one = 1 AND code_hash = ? AND expires_at > ?', [hash, now])) !== 1) return null;
    await this.sql.run('INSERT INTO paired_devices (id, token_hash, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)', [
      newRowId(),
      await sha256(token),
      name,
      now,
      now,
    ]);
    return token;
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

  async revokeDevice(id: string): Promise<boolean> {
    return (await this.sql.run('UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [this.now(), id])) === 1;
  }

  // ------------------------------------------------------------ tests

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
