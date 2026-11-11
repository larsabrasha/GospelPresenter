// Users, organisations, memberships, sessions and invites.
import { ACCOUNT_LIMITS, type InviteState, type Me, type MemberRole, type OrgRow, type Role, type UserRow } from '@gp/core';
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
  /** Superadminläge is on until then; null while it is off. */
  superUntil: number | null;
}

/**
 * Who is a Superadmin, as SQL on a `users` row aliased `u`: one whose confirmed address the server's configuration
 * names (a cloud server), else one with the mark in the database (a desktop host: whoever ran setup).
 */
function superAdminSql(superAdmins: readonly string[] | null): string {
  if (!superAdmins) return 'u.super_admin = 1';
  const quoted = superAdmins.map((e) => `'${e.trim().toLowerCase().replace(/'/g, "''")}'`);
  return quoted.length ? `(u.email_confirmed = 1 AND u.email IN (${quoted.join(', ')}))` : '0';
}

/**
 * SQL on a `memberships` row (unaliased) whose organisation is the next parameter: it is no Admin, or not the
 * organisation's last one.
 */
const NOT_LAST_ADMIN = "(role <> 'admin' OR (SELECT count(*) FROM memberships a WHERE a.org_id = ? AND a.role = 'admin') > 1)";

/** Users, organisations, memberships, sessions and invites. */
export class MemberService {
  /** `superAdminSql` for this server. */
  readonly superSql: string;

  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
    /** A session unused for this long is refused. */
    private readonly idleMs: number,
    /** The configured Superadmins' addresses; null where the mark in the database counts. */
    superAdmins: readonly string[] | null = null,
  ) {
    this.superSql = superAdminSql(superAdmins);
  }

  /** Whether the account has the Superadmin mark (docs/accounts-and-roles.md). */
  async isSuperAdmin(userId: string): Promise<boolean> {
    return (await this.sql.all(`SELECT 1 FROM users u WHERE u.id = ? AND ${this.superSql}`, [userId])).length > 0;
  }

  /** Whether the first run is finished: some user has linked a sign-in (AUTH-R12). */
  async setupDone(): Promise<boolean> {
    return (await this.sql.all('SELECT 1 FROM user_logins LIMIT 1')).length > 0;
  }

  /**
   * First run (spec 01 `/setup`, D19): the organisation and its first Admin, who has the Superadmin mark, with an
   * invite that links their Google account or passkey. Setup is not done until that link exists, so a setup that was
   * left before signing in can be finished again: the existing Superadmin and organisation are renamed and get a new
   * invite rather than a second organisation being made. Every statement is guarded by "no login exists", so a setup
   * racing a finished one changes nothing.
   */
  async setup(a: { name: string; orgName: string }): Promise<{ userId: string; orgId: string; inviteToken: string } | 'setup-done'> {
    const noLogin = `NOT EXISTS (SELECT 1 FROM user_logins)`;
    const [existing] = await this.sql.all(
      `SELECT m.user_id, m.org_id FROM memberships m JOIN users u ON u.id = m.user_id JOIN orgs o ON o.id = m.org_id
       WHERE u.super_admin = 1 ORDER BY u.created_at, u.id LIMIT 1`,
    );
    const userId = existing ? String(existing.user_id) : newRowId();
    const orgId = existing ? String(existing.org_id) : newRowId();
    const inviteToken = newSecret('gpin_');
    const now = this.now();
    const invite: [string, unknown[]] = [
      `INSERT INTO invites (token_hash, user_id, org_id, created_at, expires_at) SELECT ?, ?, ?, ?, ?
       WHERE ${noLogin} AND EXISTS (SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ? AND role = 'admin')`,
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
            `INSERT INTO users (id, name, created_at, super_admin) SELECT ?, ?, ?, 1
             WHERE ${noLogin} AND NOT EXISTS (SELECT 1 FROM users WHERE super_admin = 1)`,
            [userId, a.name, now],
          ],
          [`INSERT INTO orgs (id, name, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`, [orgId, a.orgName, now, userId]],
          [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, 'admin' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`, [userId, orgId, userId]],
          invite,
        ]);
    return changed.at(-1) === 1 ? { userId, orgId, inviteToken } : 'setup-done';
  }

  /**
   * A new session token for a device. Beyond the cap, the least recently used
   * sessions are revoked (AUTH-R8). A session made by pairing names its paired
   * device, so disconnecting the device ends it too.
   */
  async createSession(
    userId: string,
    orgId: string,
    deviceName: string,
    pairedDeviceId: string | null = null,
    signedInAt?: number,
    superUntil: number | null = null,
  ): Promise<{ token: string; sessionId: string }> {
    const token = newSecret('gpdt_');
    const id = newRowId();
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO sessions (id, token_hash, user_id, org_id, device_name, created_at, last_used_at, paired_device_id, super_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, await sha256(token), userId, orgId, deviceName || 'App', signedInAt ?? now, now, pairedDeviceId, superUntil],
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
   * AUTH-R7): a role change applies from the next request, and superadminläge
   * ends when its hour is up.
   */
  async session(token: string): Promise<SessionInfo | null> {
    if (!token.startsWith('gpdt_')) return null;
    return this.sessionByHash(await sha256(token));
  }

  /** The session whose token has this hash, as `session` finds it: for a live socket, which keeps only the hash. */
  async sessionByHash(tokenHash: string): Promise<SessionInfo | null> {
    const [r] = await this.sql.all(
      `SELECT s.id, s.user_id, s.org_id, s.created_at, s.last_used_at, s.revoked_at, s.paired_device_id, s.super_until,
         (SELECT role FROM memberships m WHERE m.user_id = s.user_id AND m.org_id = s.org_id) AS member_role,
         (s.super_until > ? AND ${this.superSql} AND EXISTS (SELECT 1 FROM orgs WHERE id = s.org_id)) AS super_on
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      [this.now(), tokenHash],
    );
    if (!r || r.revoked_at !== null) return null;
    const now = this.now();
    const lastUsed = Number(r.last_used_at);
    if (now - lastUsed > this.idleMs) return null;
    // Renewing on every request would write on every request; a fraction of the idle limit is enough.
    if (now - lastUsed > Math.min(5 * 60_000, this.idleMs / 4)) {
      await this.sql.run('UPDATE sessions SET last_used_at = ? WHERE id = ?', [now, r.id]);
    }
    const superOn = Number(r.super_on) === 1;
    return {
      sessionId: String(r.id),
      userId: String(r.user_id),
      orgId: String(r.org_id),
      role: superOn ? 'superAdmin' : ((r.member_role as MemberRole | null) ?? null),
      createdAt: Number(r.created_at),
      paired: r.paired_device_id !== null,
      superUntil: superOn ? Number(r.super_until) : null,
    };
  }

  /** Turns superadminläge on for a session until `until`, or off (null). */
  async setSuperMode(sessionId: string, until: number | null): Promise<void> {
    await this.sql.run('UPDATE sessions SET super_until = ? WHERE id = ?', [until, sessionId]);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sql.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [this.now(), sessionId]);
  }

  async me(s: Pick<SessionInfo, 'sessionId' | 'userId' | 'orgId'> & { role: Role }): Promise<Me | null> {
    const [r] = await this.sql.all(
      `SELECT u.name, u.email, u.email_confirmed, o.name AS org_name, ${this.superSql} AS super_admin,
         (SELECT super_until FROM sessions WHERE id = ?) AS super_until
       FROM users u JOIN orgs o ON o.id = ? WHERE u.id = ?`,
      [s.sessionId, s.orgId, s.userId],
    );
    if (!r) return null;
    const superUntil = s.role === 'superAdmin' && r.super_until !== null ? Number(r.super_until) : null;
    return {
      userId: s.userId,
      name: String(r.name),
      email: (r.email as string | null) ?? null,
      emailConfirmed: Number(r.email_confirmed) === 1,
      role: s.role,
      superAdmin: Number(r.super_admin) === 1,
      superUntil,
      orgId: s.orgId,
      orgName: String(r.org_name),
      sessionId: s.sessionId,
    };
  }

  /**
   * The role a user acts with in `orgId`: in superadminläge (`superMode`) a Superadmin's, in any organisation that
   * exists (visiting, as spec 01's selected organisation); else their membership's. Null for anyone else.
   */
  async roleIn(userId: string, orgId: string, superMode = false): Promise<Role | null> {
    if (superMode && (await this.isSuperAdmin(userId))) {
      return (await this.sql.all('SELECT 1 FROM orgs WHERE id = ?', [orgId])).length ? 'superAdmin' : null;
    }
    const [r] = await this.sql.all('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
    return (r?.role as MemberRole | undefined) ?? null;
  }

  /** The organisations a user may switch to, by name: theirs, or every one in superadminläge. */
  async orgsOf(userId: string, superMode = false): Promise<{ id: string; name: string }[]> {
    const rows = await this.sql.all(
      `SELECT o.id, o.name FROM orgs o
       WHERE ? OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = ? AND m.org_id = o.id)
       ORDER BY o.name COLLATE NOCASE, o.id`,
      [superMode ? 1 : 0, userId],
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
  }

  /**
   * A session in another organisation the user may act in, for the device of `sessionId`, and remembered for their next
   * sign-in. A new session rather than the old one moved: another tab on the device syncs the old organisation's
   * database with the old token, which must keep naming that organisation. It keeps the sign-in time, so switching is
   * not a fresh sign-in (adding a login needs one), and superadminläge as it was. Only an organisation one is a
   * member of is remembered.
   */
  async switchOrg(sessionId: string, userId: string, orgId: string): Promise<{ token: string; sessionId: string } | 'not-a-member'> {
    const [s] = await this.sql.all('SELECT device_name, paired_device_id, created_at, super_until FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
    if (!s) return 'not-a-member';
    const superUntil = s.super_until !== null && Number(s.super_until) > this.now() ? Number(s.super_until) : null;
    if (!(await this.roleIn(userId, orgId, superUntil !== null))) return 'not-a-member';
    await this.sql.run('UPDATE users SET last_org_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?)', [orgId, userId, userId, orgId]);
    return this.createSession(userId, orgId, String(s.device_name), (s.paired_device_id as string | null) ?? null, Number(s.created_at), superUntil);
  }

  /** Every organisation by name, with its number of members (spec 01 `/admin/organizations`). */
  async listOrgs(): Promise<OrgRow[]> {
    const rows = await this.sql.all(
      `SELECT o.id, o.name, (SELECT count(*) FROM memberships m WHERE m.org_id = o.id) AS members FROM orgs o ORDER BY o.name COLLATE NOCASE, o.id`,
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), members: Number(r.members) }));
  }

  /** A new organisation, with no members: a Superadmin visits it to invite its first Admin (ORG-R2: at most 100). */
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
   * screens, and every user who is in no other organisation. Refused while it is the only organisation of a
   * Superadmin, who would be left with none to sign in to. Its data (the songs and the rest, the files) is the
   * caller's to delete.
   */
  async deleteOrg(orgId: string): Promise<'ok' | 'not-found' | 'super-admin-home'> {
    const [o] = await this.sql.all('SELECT 1 FROM orgs WHERE id = ?', [orgId]);
    if (!o) return 'not-found';
    const only = `(SELECT user_id FROM memberships WHERE org_id = ? AND user_id NOT IN (SELECT user_id FROM memberships WHERE org_id <> ?))`;
    const [home] = await this.sql.all(`SELECT 1 FROM users u WHERE u.id IN ${only} AND ${this.superSql}`, [orgId, orgId]);
    if (home) return 'super-admin-home';
    await this.sql.batch([
      [`DELETE FROM user_logins WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM invites WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM sessions WHERE user_id IN ${only}`, [orgId, orgId]],
      [`DELETE FROM users WHERE id IN ${only}`, [orgId, orgId]],
      ['DELETE FROM memberships WHERE org_id = ?', [orgId]],
      ['DELETE FROM invites WHERE org_id = ?', [orgId]],
      ['DELETE FROM invitations WHERE org_id = ?', [orgId]],
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

  /**
   * A user of `orgId`, with their role there; null for anyone else (PERM-R3). `hostOnly`: it is their only
   * membership; `superAdmin`: the account has the mark (`accountRefusal`).
   */
  async member(userId: string, orgId: string): Promise<{ id: string; role: MemberRole; hostOnly: boolean; superAdmin: boolean } | null> {
    const [r] = await this.sql.all(
      `SELECT m.role, NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = m.user_id AND o.org_id <> m.org_id) AS only_here,
         ${this.superSql} AS super_admin
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.org_id = ?`,
      [userId, orgId],
    );
    return r ? { id: userId, role: r.role as MemberRole, hostOnly: Number(r.only_here) === 1, superAdmin: Number(r.super_admin) === 1 } : null;
  }

  /** How many Admins `orgId` has: the last one stays one (`roleChangeRefusal`). */
  async adminCount(orgId: string): Promise<number> {
    const [r] = await this.sql.all("SELECT count(*) AS n FROM memberships WHERE org_id = ? AND role = 'admin'", [orgId]);
    return Number(r?.n ?? 0);
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
      `SELECT u.id, u.name, u.email, m.role, EXISTS (SELECT 1 FROM user_logins l WHERE l.user_id = u.id) AS active, ${this.superSql} AS super_admin,
         NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = u.id AND o.org_id <> m.org_id) AS only_here,
         (SELECT max(expires_at) FROM invites i WHERE i.user_id = u.id AND i.org_id = m.org_id AND i.used_at IS NULL) AS invite_expires
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? AND (? IS NULL OR u.id = ?) ORDER BY u.name COLLATE NOCASE, u.id`,
      [orgId, userId, userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      email: (r.email as string | null) ?? null,
      role: r.role as MemberRole,
      active: Number(r.active) === 1,
      invite: r.invite_expires === null ? null : { expiresAt: Number(r.invite_expires), expired: Number(r.invite_expires) <= now },
      onlyHere: Number(r.only_here) === 1,
      superAdmin: Number(r.super_admin) === 1,
    }));
  }

  /**
   * Changes a user's name and/or e-mail (null clears it), for a Superadmin or for themselves (their name). An address
   * set so is unconfirmed until a link reaches it, so it is never another account's confirmed one.
   */
  async updateUser(userId: string, a: { name?: string; email?: string | null }): Promise<void> {
    if (a.email !== undefined) await this.sql.run('UPDATE users SET email = ?, email_confirmed = 0 WHERE id = ?', [a.email, userId]);
    if (a.name !== undefined) await this.sql.run('UPDATE users SET name = ? WHERE id = ?', [a.name, userId]);
  }

  /** A person who is a member of `orgId` only, for a desktop host (`createUserRequest`), within ORG-R10's cap. */
  async createLocalUser(orgId: string, a: { name: string; email: string | null; role: MemberRole }): Promise<{ id: string } | 'limit'> {
    const id = newRowId();
    const [inserted] = await this.sql.batch([
      [
        `INSERT INTO users (id, name, email, created_at) SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM memberships WHERE org_id = ?) < ?`,
        [id, a.name, a.email, this.now(), orgId, ACCOUNT_LIMITS.usersPerOrg],
      ],
      ['INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)', [id, orgId, a.role, id]],
    ]);
    return inserted === 1 ? { id } : 'limit';
  }

  /** Deletes a member's unused invites, expired ones included: their links stop working. */
  async deleteInvites(userId: string, orgId: string): Promise<void> {
    await this.sql.run('DELETE FROM invites WHERE user_id = ? AND org_id = ? AND used_at IS NULL', [userId, orgId]);
  }

  /**
   * The user who has confirmed this (lower-cased) address, and the organisation of their oldest membership, for
   * "Glömt hur du loggar in?": an unconfirmed address may be anyone's, so it never gets a link.
   */
  async userByEmail(email: string): Promise<{ id: string; name: string; orgId: string; orgName: string } | null> {
    const [r] = await this.sql.all(
      `SELECT u.id, u.name, o.id AS org_id, o.name AS org_name FROM users u
       JOIN memberships m ON m.user_id = u.id JOIN orgs o ON o.id = m.org_id
       WHERE u.email = ? AND u.email_confirmed = 1 ORDER BY m.rowid LIMIT 1`,
      [email],
    );
    return r ? { id: String(r.id), name: String(r.name), orgId: String(r.org_id), orgName: String(r.org_name) } : null;
  }

  /**
   * A new link that replaces a member's logins when it is used (setup, recovery, a Superadmin's reset), at most 20
   * unused per user, expired ones included (AUTH-R3).
   */
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
    return { state: 'valid', kind: 'reset', name: String(r.name), orgName: String(r.org_name), email: (r.email as string | null) ?? null };
  }

  /**
   * A member's new role, in one statement that keeps the organisation's last Admin one (`last-admin`), so two Admins
   * demoting each other at once cannot leave none.
   */
  async setRole(userId: string, orgId: string, role: MemberRole): Promise<'ok' | 'last-admin'> {
    const n = await this.sql.run(`UPDATE memberships SET role = ? WHERE user_id = ? AND org_id = ? AND (? = 'admin' OR ${NOT_LAST_ADMIN})`, [role, userId, orgId, role, orgId]);
    return n === 1 ? 'ok' : 'last-admin';
  }

  /** Removes a user for good (ORG-R12): their logins, sessions, invites and memberships go with them. */
  async deleteUser(userId: string): Promise<void> {
    await this.sql.batch(this.deleteUserSql(userId));
  }

  /**
   * "Radera användare" in one organisation: the membership, with its invites and sessions there, goes; a user who is in
   * no other organisation is removed for good (ORG-R12). The organisation's last Admin stays (`last-admin`): the
   * membership goes first, in one statement that checks it, and the rest only once it is gone.
   */
  async removeMember(userId: string, orgId: string): Promise<'ok' | 'last-admin'> {
    const [other] = await this.sql.all('SELECT 1 FROM memberships WHERE user_id = ? AND org_id <> ?', [userId, orgId]);
    const gone = 'NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?)';
    const rest: [string, unknown[]][] = other
      ? [
          ['DELETE FROM sessions WHERE user_id = ? AND org_id = ?', [userId, orgId]],
          ['DELETE FROM invites WHERE user_id = ? AND org_id = ?', [userId, orgId]],
          ['UPDATE users SET last_org_id = NULL WHERE id = ? AND last_org_id = ?', [userId, orgId]],
        ]
      : this.deleteUserSql(userId);
    const [removed] = await this.sql.batch([
      [`DELETE FROM memberships WHERE user_id = ? AND org_id = ? AND ${NOT_LAST_ADMIN}`, [userId, orgId, orgId]],
      ...rest.map(([q, params]): [string, unknown[]] => [`${q} AND ${gone}`, [...params, userId, orgId]]),
    ]);
    return removed === 1 ? 'ok' : 'last-admin';
  }

  private deleteUserSql(userId: string): [string, unknown[]][] {
    return [
      ['DELETE FROM user_logins WHERE user_id = ?', [userId]],
      ['DELETE FROM sessions WHERE user_id = ?', [userId]],
      ['DELETE FROM invites WHERE user_id = ?', [userId]],
      ['DELETE FROM email_links WHERE user_id = ?', [userId]],
      ['DELETE FROM memberships WHERE user_id = ?', [userId]],
      ['DELETE FROM users WHERE id = ?', [userId]],
    ];
  }
}
