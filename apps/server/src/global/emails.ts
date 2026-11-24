// A person's own address: confirming it by a link that reached it, Google vouching for it, and the log of what a
// Superadmin did to someone else's account (docs/accounts-and-roles.md).
import { ACCOUNT_LIMITS } from '@gp/core';
import { newRowId, newSecret, sha256 } from '../crypto.ts';
import type { GlobalSql } from './sql.ts';

/** SQL: no account but ?1's has confirmed the address ?2 (the parameters in that order: the address, then the user). */
const freeSql = `NOT EXISTS (SELECT 1 FROM users o WHERE o.email = ? AND o.email_confirmed = 1 AND o.id <> ?)`;

export class EmailService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /** Whether an account other than `userId` has confirmed `email`. */
  async takenByOther(email: string, userId: string | null): Promise<boolean> {
    return (await this.sql.all('SELECT 1 FROM users WHERE email = ? AND email_confirmed = 1 AND id <> ?', [email, userId ?? ''])).length > 0;
  }

  /**
   * A link that sets `email` as the user's address, confirmed, when it is opened (a new address, or the one they have
   * to confirm it). Null when another account has confirmed the address: the caller mails a warning instead, and
   * answers the same either way.
   */
  async startConfirm(userId: string, email: string): Promise<string | null> {
    if (await this.takenByOther(email, userId)) return null;
    const token = newSecret('gpem_');
    const now = this.now();
    await this.sql.batch([
      ['DELETE FROM email_links WHERE user_id = ? AND used_at IS NULL', [userId]],
      [
        'INSERT INTO email_links (token_hash, user_id, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        [await sha256(token), userId, email, now, now + ACCOUNT_LIMITS.emailLinkTtlMs],
      ],
    ]);
    return token;
  }

  /**
   * Opens a confirming link, once: the address becomes the user's, confirmed, unless another account confirmed it
   * meanwhile (checked again here, and by the unique index for two at once).
   */
  async confirm(token: string): Promise<{ userId: string } | 'invalid' | 'email-taken'> {
    if (!token.startsWith('gpem_')) return 'invalid';
    const hash = await sha256(token);
    const now = this.now();
    const [r] = await this.sql.all('SELECT user_id, email FROM email_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', [hash, now]);
    if (!r) return 'invalid';
    const userId = String(r.user_id);
    const email = String(r.email);
    if (await this.takenByOther(email, userId)) return 'email-taken';
    try {
      await this.sql.batch([
        ['UPDATE email_links SET used_at = ? WHERE token_hash = ?', [now, hash]],
        ['UPDATE users SET email = ?, email_confirmed = 1 WHERE id = ?', [email, userId]],
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'email-taken';
      throw e;
    }
    return { userId };
  }

  /**
   * Google vouches for `email` (a verified address of the Google account the user signed in with): it confirms the
   * user's address when it is the same, or fills an empty one, unless another account has confirmed it.
   */
  async vouch(userId: string, email: string | null): Promise<void> {
    if (!email) return;
    await this.setConfirmed(userId, email, 'UPDATE users SET email = ?, email_confirmed = 1 WHERE id = ? AND (email IS NULL OR email = ?) AND email_confirmed = 0', [
      email,
      userId,
      email,
    ]);
  }

  /**
   * Gives a user `email` (only an empty one, or the same one unconfirmed, with `onlyIfEmpty`): confirmed when
   * `confirmed` and no other account has it so, else unconfirmed. For a new account and an accepted invitation.
   */
  async give(userId: string, email: string, confirmed: boolean, onlyIfEmpty: boolean): Promise<void> {
    const guard = onlyIfEmpty ? ' AND (email IS NULL OR (email = ? AND email_confirmed = 0))' : '';
    const params = onlyIfEmpty ? [email, userId, email] : [email, userId];
    if (confirmed && (await this.setConfirmed(userId, email, `UPDATE users SET email = ?, email_confirmed = 1 WHERE id = ?${guard}`, params)) > 0) return;
    await this.sql.run(`UPDATE users SET email = ?, email_confirmed = 0 WHERE id = ?${onlyIfEmpty ? ' AND email IS NULL' : ''}`, [email, userId]);
  }

  /** Runs a statement that confirms `email` for `userId`, only while no other account has confirmed it; the rows it changed. */
  private async setConfirmed(userId: string, email: string, statement: string, params: unknown[]): Promise<number> {
    try {
      return await this.sql.run(`${statement} AND ${freeSql}`, [...params, email, userId]);
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e; // confirmed by another account meanwhile: left as it was
      return 0;
    }
  }

  /** Logs what a Superadmin did to someone else's account: who, what, whom, where and when. */
  async audit(actorId: string, action: string, targetId: string | null, orgId: string | null, detail: string | null = null): Promise<void> {
    await this.sql.run('INSERT INTO audit_log (id, at, actor_id, action, target_id, org_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      newRowId(),
      this.now(),
      actorId,
      action,
      targetId,
      orgId,
      detail,
    ]);
  }
}
