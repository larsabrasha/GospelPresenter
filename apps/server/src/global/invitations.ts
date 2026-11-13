// Invitations (docs/accounts-and-roles.md): a pending membership of an address, accepted by whoever opens the link
// with an account they have, which gains the membership and nothing else, or with a new account.
import { ACCOUNT_LIMITS, type AuthError, type InvitationRow, type InviteState, type MemberRole } from '@gp/core';
import { newRowId, newSecret, sha256 } from '../crypto.ts';
import type { EmailService } from './emails.ts';
import { loginValues, type NewLogin } from './sign-in.ts';
import type { GlobalSql, Row } from './sql.ts';

/** An invitation as accepting it reads it. */
interface Invitation {
  hash: string;
  email: string;
  orgId: string;
  role: MemberRole;
  mailed: boolean;
  name: string | null;
}

/**
 * SQL on an `invitations` row: its organisation has room for one more member (ORG-R10, the limit the first parameter),
 * or the account accepting (the second) is a member there already.
 */
const ROOM = `((SELECT count(*) FROM memberships m WHERE m.org_id = invitations.org_id) < ?
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = ? AND m.org_id = invitations.org_id))`;

export class InvitationService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
    private readonly emails: EmailService,
  ) {}

  /**
   * An invitation of `email` to `orgId` with `role`, in place of an unused one to the same address there (with
   * `keepOthers`, beside it, for `replaceOthers` once its mail has gone). Members and invitations together stay within
   * ORG-R10's cap, an older invitation to the same address not counted. A member here who has the address already is `email-taken`: the
   * Admin sees the members' addresses, so that tells nothing new; whether anyone else has it is never told.
   */
  async create(
    orgId: string,
    a: { email: string; role: MemberRole; mailed: boolean; byUserId: string | null; name?: string; googleSubjects?: string[]; ttlMs?: number; keepOthers?: boolean },
  ): Promise<{ id: string; token: string } | 'email-taken' | 'limit'> {
    const [member] = await this.sql.all('SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ?', [orgId, a.email]);
    if (member) return 'email-taken';
    const id = newRowId();
    const token = newSecret('gpin_');
    const now = this.now();
    const [, inserted] = await this.sql.batch([
      ['DELETE FROM invitations WHERE org_id = ? AND email = ? AND used_at IS NULL AND ? = 0', [orgId, a.email, a.keepOthers ? 1 : 0]],
      [
        `INSERT INTO invitations (id, token_hash, email, org_id, role, created_at, expires_at, mailed, google_subjects, name, by_user_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT count(*) FROM memberships WHERE org_id = ?)
             + (SELECT count(*) FROM invitations WHERE org_id = ? AND used_at IS NULL AND expires_at > ? AND email <> ?) < ?`,
        [
          id,
          await sha256(token),
          a.email,
          orgId,
          a.role,
          now,
          now + (a.ttlMs ?? ACCOUNT_LIMITS.inviteTtlMs),
          a.mailed ? 1 : 0,
          a.googleSubjects?.length ? JSON.stringify(a.googleSubjects) : null,
          a.name ?? null,
          a.byUserId,
          orgId,
          orgId,
          now,
          a.email,
          ACCOUNT_LIMITS.usersPerOrg,
        ],
      ],
    ]);
    return inserted === 1 ? { id, token } : 'limit';
  }

  /** The organisation's invitations not yet accepted, by address (Inbjuden). */
  async list(orgId: string): Promise<InvitationRow[]> {
    const now = this.now();
    const rows = await this.sql.all('SELECT id, email, role, expires_at FROM invitations WHERE org_id = ? AND used_at IS NULL ORDER BY email, created_at', [orgId]);
    return rows.map((r) => ({ id: String(r.id), email: String(r.email), role: r.role as MemberRole, expiresAt: Number(r.expires_at), expired: Number(r.expires_at) <= now }));
  }

  /** Withdraws the other unused invitations to the address of invitation `id`, once its mail has gone. */
  async replaceOthers(orgId: string, id: string): Promise<void> {
    await this.sql.run(
      'DELETE FROM invitations WHERE org_id = ? AND used_at IS NULL AND id <> ? AND email = (SELECT email FROM invitations WHERE id = ?)',
      [orgId, id, id],
    );
  }

  /** Withdraws an invitation: its link stops working. */
  async remove(orgId: string, id: string): Promise<boolean> {
    return (await this.sql.run('DELETE FROM invitations WHERE id = ? AND org_id = ? AND used_at IS NULL', [id, orgId])) === 1;
  }

  /** What an invitation's link shows, or null when the token is no invitation (it may be a reset link). */
  async lookup(token: string): Promise<InviteState | null> {
    if (!token.startsWith('gpin_')) return null;
    const [r] = await this.sql.all(
      'SELECT i.email, i.expires_at, i.used_at, o.name AS org_name FROM invitations i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?',
      [await sha256(token)],
    );
    if (!r) return null;
    if (r.used_at !== null) return { state: 'invalid' };
    if (Number(r.expires_at) <= this.now()) return { state: 'expired' };
    return { state: 'valid', kind: 'join', orgName: String(r.org_name), email: String(r.email) };
  }

  /** A usable invitation by its token's hash; an AuthError when it is used or expired; null when there is none. */
  async get(hash: string): Promise<Invitation | AuthError | null> {
    const [r] = await this.sql.all(
      'SELECT i.email, i.org_id, i.role, i.mailed, i.name, i.expires_at, i.used_at FROM invitations i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?',
      [hash],
    );
    if (!r) return null;
    if (r.used_at !== null) return 'invite-invalid';
    if (Number(r.expires_at) <= this.now()) return 'invite-expired';
    return invitation(hash, r);
  }

  /**
   * Accepts an invitation with an account one has: it gains the membership (a member already keeps their role) and
   * nothing else; no login is replaced, no session ends. A link that went only by mail confirms its address for an
   * account that has none, or has it unconfirmed.
   */
  async accept(hash: string, userId: string): Promise<{ userId: string; orgId: string } | AuthError> {
    const inv = await this.get(hash);
    if (!inv) return 'invite-invalid';
    if (typeof inv === 'string') return inv;
    const nonce = newRowId();
    const now = this.now();
    const [claimed] = await this.sql.batch([
      [`UPDATE invitations SET used_at = ?, use_nonce = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND ${ROOM}`, [now, nonce, hash, now, ACCOUNT_LIMITS.usersPerOrg, userId]],
      [
        'INSERT OR IGNORE INTO memberships (user_id, org_id, role) SELECT ?, org_id, role FROM invitations WHERE token_hash = ? AND use_nonce = ?',
        [userId, hash, nonce],
      ],
      ['UPDATE users SET last_org_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM invitations WHERE token_hash = ? AND use_nonce = ?)', [inv.orgId, userId, hash, nonce]],
    ]);
    if (claimed !== 1) return this.whyNotClaimed(hash);
    await this.emails.give(userId, inv.email, inv.mailed, true);
    return { userId, orgId: inv.orgId };
  }

  /**
   * Accepts an invitation with a new account: `name`, `login` (a Google account no one has, or a new passkey), and an
   * address: the invitation's, confirmed when its link went only by mail; else the one Google vouches for; else the
   * invitation's, unconfirmed. Its other invitations (a 1.x import's, by its Google subject) are accepted with it.
   */
  async createAccount(hash: string, a: { userId?: string; name: string | null; login: NewLogin; googleEmail: string | null }): Promise<{ userId: string; orgId: string } | AuthError> {
    const inv = await this.get(hash);
    if (!inv) return 'invite-invalid';
    if (typeof inv === 'string') return inv;
    const userId = a.userId ?? newRowId();
    const [provider, subject, loginName, publicKey, signCount, transports] = loginValues(a.login);
    const nonce = newRowId();
    const now = this.now();
    const claimed = `EXISTS (SELECT 1 FROM invitations WHERE token_hash = ? AND use_nonce = ?)`;
    const name = (a.name ?? inv.name ?? inv.email.split('@')[0]!).slice(0, 200);
    let done: number | undefined;
    try {
      [done] = await this.sql.batch([
        [`UPDATE invitations SET used_at = ?, use_nonce = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND ${ROOM}`, [now, nonce, hash, now, ACCOUNT_LIMITS.usersPerOrg, userId]],
        [`INSERT INTO users (id, name, created_at, last_org_id) SELECT ?, ?, ?, ? WHERE ${claimed}`, [userId, name, now, inv.orgId, hash, nonce]],
        [
          `INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at, name, public_key, sign_count, transports)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${claimed}`,
          [provider, subject, userId, now, now, loginName, publicKey, signCount, transports, hash, nonce],
        ],
        [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, org_id, role FROM invitations WHERE token_hash = ? AND use_nonce = ?`, [userId, hash, nonce]],
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'login-taken'; // linked to someone meanwhile; the batch rolled back
      throw e;
    }
    if (done !== 1) return this.whyNotClaimed(hash);
    if (inv.mailed) await this.emails.give(userId, inv.email, true, false);
    else if (a.googleEmail) await this.emails.give(userId, a.googleEmail, true, false);
    else await this.emails.give(userId, inv.email, false, false);
    if (a.login.provider === 'google') for (const other of await this.forGoogle(a.login.subject)) await this.accept(other, userId);
    return { userId, orgId: inv.orgId };
  }

  /** Why an invitation was not claimed: the organisation was full while it is still usable, or it was used meanwhile. */
  private async whyNotClaimed(hash: string): Promise<AuthError> {
    const still = await this.get(hash);
    return still && typeof still === 'object' ? 'limit' : 'invite-invalid';
  }

  /** The hashes of the usable invitations a 1.x import made for this Google subject, oldest first. */
  async forGoogle(subject: string): Promise<string[]> {
    const rows = await this.sql.all(
      `SELECT i.token_hash FROM invitations i, json_each(i.google_subjects) s
       WHERE i.google_subjects IS NOT NULL AND s.value = ? AND i.used_at IS NULL AND i.expires_at > ? ORDER BY i.created_at`,
      [subject, this.now()],
    );
    return rows.map((r) => String(r.token_hash));
  }
}

function invitation(hash: string, r: Row): Invitation {
  return {
    hash,
    email: String(r.email),
    orgId: String(r.org_id),
    role: r.role as MemberRole,
    mailed: Number(r.mailed) === 1,
    name: (r.name as string | null) ?? null,
  };
}
