// Users, organisations, memberships, sessions and invites.
import { ACCOUNT_LIMITS, type InviteState, type Me, type Role, type UserRow } from '@gp/core';
import { newRowId, newSecret, sha256 } from '../crypto.ts';
import type { GlobalSql } from './sql.ts';

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string;
  /** Null when the user is no longer a member of the session's organisation. */
  role: Role | null;
  /** When the sign-in that made the session happened. */
  createdAt: number;
  /** Made by pairing a device at a desktop host, not by the user signing in themselves. */
  paired: boolean;
}

/** Users, organisations, memberships, sessions and invites. */
export class MemberService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
    /** A session unused for this long is refused. */
    private readonly idleMs: number,
  ) {}

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
      `SELECT s.id, s.user_id, s.org_id, s.created_at, s.last_used_at, s.revoked_at, s.paired_device_id, m.role
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
    return {
      sessionId: String(r.id),
      userId: String(r.user_id),
      orgId: String(r.org_id),
      role: (r.role as Role | null) ?? null,
      createdAt: Number(r.created_at),
      paired: r.paired_device_id !== null,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sql.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [this.now(), sessionId]);
  }

  async me(s: Pick<SessionInfo, 'sessionId' | 'userId' | 'orgId'> & { role: Role }): Promise<Me | null> {
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
}
