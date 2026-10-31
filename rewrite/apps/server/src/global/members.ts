// Users, organisations, memberships, sessions and invites.
import { ACCOUNT_LIMITS, type InviteState, type Me, type OrgRow, type Role, type UserRow } from '@gp/core';
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

/**
 * The role user ?1 acts with in organisation ?2, as SQL (`roleIn`): the membership's, else SuperAdmin for a SuperAdmin
 * who is not a member there, while the organisation exists; else null.
 */
const ROLE_IN = `COALESCE(
  (SELECT role FROM memberships WHERE user_id = ?1 AND org_id = ?2),
  (SELECT 'superAdmin' WHERE EXISTS (SELECT 1 FROM memberships WHERE user_id = ?1 AND role = 'superAdmin') AND EXISTS (SELECT 1 FROM orgs WHERE id = ?2)))`;

/** The parameters of ROLE_IN with `?` in place of ?1 and ?2, in their order of appearance. */
const roleInParams = (userId: string, orgId: string) => [userId, orgId, userId, orgId];

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
  async createSession(userId: string, orgId: string, deviceName: string, pairedDeviceId: string | null = null, signedInAt?: number): Promise<{ token: string; sessionId: string }> {
    const token = newSecret('gpdt_');
    const id = newRowId();
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO sessions (id, token_hash, user_id, org_id, device_name, created_at, last_used_at, paired_device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, await sha256(token), userId, orgId, deviceName || 'App', signedInAt ?? now, now, pairedDeviceId],
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
      `SELECT s.id, s.user_id, s.org_id, s.created_at, s.last_used_at, s.revoked_at, s.paired_device_id, ${ROLE_IN.replace(/\?1/g, 's.user_id').replace(/\?2/g, 's.org_id')} AS role
       FROM sessions s JOIN users u ON u.id = s.user_id
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

  /**
   * The role a user acts with in `orgId`: their membership's, or, for a SuperAdmin who is not a member there, SuperAdmin
   * (visiting, as spec 01's selected organisation; decided on 2026-10-31). Null for anyone else, or an organisation that is gone.
   */
  async roleIn(userId: string, orgId: string): Promise<Role | null> {
    const [r] = await this.sql.all(`SELECT ${ROLE_IN.replace(/\?1/g, '?').replace(/\?2/g, '?')} AS role`, roleInParams(userId, orgId));
    return (r?.role as Role | null) ?? null;
  }

  /** The organisations a user may switch to, by name: theirs, or every one for a SuperAdmin. */
  async orgsOf(userId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.sql.all(
      `SELECT o.id, o.name FROM orgs o
       WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = ? AND (m.org_id = o.id OR m.role = 'superAdmin'))
       ORDER BY o.name COLLATE NOCASE, o.id`,
      [userId],
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  }

  /**
   * A session in another organisation the user may act in, for the device of `sessionId`, and remembered for their next
   * sign-in. A new session rather than the old one moved: another tab on the device syncs the old organisation's
   * database with the old token, which must keep naming that organisation. It keeps the sign-in time, so switching is
   * not a fresh sign-in (adding a login needs one).
   */
  async switchOrg(sessionId: string, userId: string, orgId: string): Promise<{ token: string; sessionId: string } | 'not-a-member'> {
    if (!(await this.roleIn(userId, orgId))) return 'not-a-member';
    const [s] = await this.sql.all('SELECT device_name, paired_device_id, created_at FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
    if (!s) return 'not-a-member';
    await this.sql.run('UPDATE users SET last_org_id = ? WHERE id = ?', [orgId, userId]);
    return this.createSession(userId, orgId, String(s.device_name), (s.paired_device_id as string | null) ?? null, Number(s.created_at));
  }

  /** Every organisation by name, with its number of members (spec 01 `/admin/organizations`). */
  async listOrgs(): Promise<OrgRow[]> {
    const rows = await this.sql.all(
      `SELECT o.id, o.name, (SELECT count(*) FROM memberships m WHERE m.org_id = o.id) AS members FROM orgs o ORDER BY o.name COLLATE NOCASE, o.id`,
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), members: Number(r.members) }));
  }

  /** A new organisation, with no members: the SuperAdmin visits it to make its first users (ORG-R2: at most 100). */
  async createOrg(name: string): Promise<string | 'limit'> {
    const id = newRowId();
    const n = await this.sql.run(`INSERT INTO orgs (id, name, created_at) SELECT ?, ?, ? WHERE (SELECT count(*) FROM orgs) < ?`, [id, name, this.now(), ACCOUNT_LIMITS.orgs]);
    return n === 1 ? id : 'limit';
  }

  async renameOrg(orgId: string, name: string): Promise<boolean> {
    return (await this.sql.run('UPDATE orgs SET name = ? WHERE id = ?', [name, orgId])) === 1;
  }

  /**
   * Deletes an organisation's accounts (ORG-R3 as decided on 2026-10-31): its memberships, invites, sessions, codes and
   * screens, and every user who is in no other organisation. Refused while it is the only organisation of a SuperAdmin,
   * who would be left with none (D20). Its data (the songs and the rest, the files) is the caller's to delete.
   */
  async deleteOrg(orgId: string): Promise<'ok' | 'not-found' | 'super-admin-home'> {
    const [o] = await this.sql.all('SELECT 1 FROM orgs WHERE id = ?', [orgId]);
    if (!o) return 'not-found';
    const only = `(SELECT user_id FROM memberships WHERE org_id = ? AND user_id NOT IN (SELECT user_id FROM memberships WHERE org_id <> ?))`;
    const [home] = await this.sql.all(`SELECT 1 FROM memberships WHERE org_id = ? AND role = 'superAdmin' AND user_id IN ${only}`, [orgId, orgId, orgId]);
    if (home) return 'super-admin-home';
    await this.sql.batch([
      [`DELETE FROM user_logins WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM invites WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM sessions WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM users WHERE id IN ${only}`, [orgId, orgId]],
      ['DELETE FROM memberships WHERE org_id = ?', [orgId]],
      ['DELETE FROM invites WHERE org_id = ?', [orgId]],
      ['DELETE FROM sessions WHERE org_id = ?', [orgId]],
      ['DELETE FROM pair_codes WHERE org_id = ?', [orgId]],
      ['DELETE FROM watch_codes WHERE org_id = ?', [orgId]],
      ['DELETE FROM screens WHERE org_id = ?', [orgId]],
      ['DELETE FROM screen_tokens WHERE org_id = ?', [orgId]],
      ['DELETE FROM play_tokens WHERE org_id = ?', [orgId]],
      ['UPDATE users SET last_org_id = NULL WHERE last_org_id = ?', [orgId]],
      ['DELETE FROM orgs WHERE id = ?', [orgId]],
    ]);
    return 'ok';
  }

  /** A user of `orgId`, with their role there; null for anyone else (PERM-R3). */
  async member(userId: string, orgId: string): Promise<{ id: string; role: Role } | null> {
    const [r] = await this.sql.all('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
    return r ? { id: userId, role: r.role as Role } : null;
  }

  /** The organisation's users by name (ORG-R11), each with their newest unused invite. */
  async listUsers(orgId: string): Promise<UserRow[]> {
    return this.userRows(orgId, null);
  }

  /** One user of `orgId`, as the list shows them; null for anyone else (PERM-R3). */
  async user(userId: string, orgId: string): Promise<UserRow | null> {
    return (await this.userRows(orgId, userId))[0] ?? null;
  }

  private async userRows(orgId: string, userId: string | null): Promise<UserRow[]> {
    const now = this.now();
    const rows = await this.sql.all(
      `SELECT u.id, u.name, u.email, m.role, EXISTS (SELECT 1 FROM user_logins l WHERE l.user_id = u.id) AS active,
         (SELECT max(expires_at) FROM invites i WHERE i.user_id = u.id AND i.org_id = m.org_id AND i.used_at IS NULL) AS invite_expires
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? AND (? IS NULL OR u.id = ?) ORDER BY u.name COLLATE NOCASE, u.id`,
      [orgId, userId, userId],
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

  /**
   * Changes a user's name and/or e-mail (null clears it). An e-mail is one
   * user's only: another user's is `email-taken`, checked in the statement
   * itself and by the unique index for a race.
   */
  async updateUser(userId: string, a: { name?: string; email?: string | null }): Promise<'ok' | 'email-taken'> {
    try {
      if (a.email !== undefined) {
        const n = await this.sql.run('UPDATE users SET email = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE email = ? AND id <> ?)', [
          a.email,
          userId,
          a.email,
          userId,
        ]);
        if (n === 0) return 'email-taken';
      }
      // After the e-mail, so a refused address leaves the name as it was too.
      if (a.name !== undefined) await this.sql.run('UPDATE users SET name = ? WHERE id = ?', [a.name, userId]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'email-taken';
      throw e;
    }
    return 'ok';
  }

  /** Deletes a member's unused invites, expired ones included: their links stop working. */
  async deleteInvites(userId: string, orgId: string): Promise<void> {
    await this.sql.run('DELETE FROM invites WHERE user_id = ? AND org_id = ? AND used_at IS NULL', [userId, orgId]);
  }

  /**
   * A new user in `orgId` with an invite, in one batch (AUTH-R2). A user who has the e-mail already becomes a member
   * here with `role` (decided on 2026-10-31), with an invite only if they have no way to sign in yet: one who has
   * switches to this organisation, and an invite would replace their logins. One who is a member here already is `email-taken`.
   */
  async createUser(orgId: string, a: { name: string; email: string; role: Role }): Promise<{ id: string; inviteToken: string | null } | 'email-taken' | 'limit'> {
    const [taken] = await this.sql.all(
      'SELECT id, EXISTS (SELECT 1 FROM user_logins l WHERE l.user_id = users.id) AS active FROM users WHERE email = ?',
      [a.email],
    );
    if (taken) return this.addMember(orgId, String(taken.id), a.role, Number(taken.active) === 1);
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

  /** An existing user made a member of `orgId` (`createUser`). */
  private async addMember(orgId: string, userId: string, role: Role, active: boolean): Promise<{ id: string; inviteToken: string | null } | 'email-taken' | 'limit'> {
    const [member] = await this.sql.all('SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
    if (member) return 'email-taken';
    const n = await this.sql.run(
      `INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, ? WHERE (SELECT count(*) FROM memberships WHERE org_id = ?) < ?`,
      [userId, orgId, role, orgId, ACCOUNT_LIMITS.usersPerOrg],
    );
    if (n !== 1) return 'limit';
    if (active) return { id: userId, inviteToken: null };
    const token = await this.createInvite(userId, orgId);
    return { id: userId, inviteToken: token === 'limit' ? null : token };
  }

  /** The user with this (lower-cased) e-mail and the organisation of their oldest membership, for "Glömt hur du loggar in?". */
  async userByEmail(email: string): Promise<{ id: string; name: string; orgId: string; orgName: string } | null> {
    const [r] = await this.sql.all(
      `SELECT u.id, u.name, o.id AS org_id, o.name AS org_name FROM users u
       JOIN memberships m ON m.user_id = u.id JOIN orgs o ON o.id = m.org_id
       WHERE u.email = ? ORDER BY m.rowid LIMIT 1`,
      [email],
    );
    return r ? { id: String(r.id), name: String(r.name), orgId: String(r.org_id), orgName: String(r.org_name) } : null;
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
    await this.sql.batch(this.deleteUserSql(userId));
  }

  /**
   * "Radera användare" in one organisation: the membership, with its invites and sessions there, goes; a user who is in
   * no other organisation is removed for good (ORG-R12).
   */
  async removeMember(userId: string, orgId: string): Promise<void> {
    const [other] = await this.sql.all('SELECT 1 FROM memberships WHERE user_id = ? AND org_id <> ?', [userId, orgId]);
    if (!other) return this.deleteUser(userId);
    await this.sql.batch([
      ['DELETE FROM sessions WHERE user_id = ? AND org_id = ?', [userId, orgId]],
      ['DELETE FROM invites WHERE user_id = ? AND org_id = ?', [userId, orgId]],
      ['DELETE FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]],
      ['UPDATE users SET last_org_id = NULL WHERE id = ? AND last_org_id = ?', [userId, orgId]],
    ]);
  }

  private deleteUserSql(userId: string): [string, unknown[]][] {
    return [
      ['DELETE FROM user_logins WHERE user_id = ?', [userId]],
      ['DELETE FROM sessions WHERE user_id = ?', [userId]],
      ['DELETE FROM invites WHERE user_id = ?', [userId]],
      ['DELETE FROM memberships WHERE user_id = ?', [userId]],
      ['DELETE FROM users WHERE id = ?', [userId]],
    ];
  }
}
