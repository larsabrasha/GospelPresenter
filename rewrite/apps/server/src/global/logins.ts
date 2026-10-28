// A signed-in user's own logins: adding, listing, renaming and removing them.
import { ACCOUNT_LIMITS, type AuthError, type LoginMethod, type LoginProvider } from '@gp/core';
import { loginValues, type NewLogin } from './sign-in.ts';
import type { GlobalSql } from './sql.ts';

/** A signed-in user's own logins. */
export class LoginService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /**
   * Adds a login to a signed-in user: a passkey, or a Google account linked
   * from their session. Only while that session is valid, within the cap
   * (ORG-R13), and at most one Google account per user. A login that is
   * already this user's is fine; another user's is `login-taken`.
   */
  async add(userId: string, sessionId: string, login: NewLogin, email: string | null = null): Promise<LoginMethod | AuthError> {
    const now = this.now();
    const [provider, subject, name, publicKey, signCount, transports] = loginValues(login);
    const [linked] = await this.sql.all('SELECT user_id FROM user_logins WHERE provider = ? AND subject = ?', [provider, subject]);
    if (linked) return String(linked.user_id) === userId ? ((await this.list(userId)).find((l) => l.provider === provider && l.id === subject) ?? 'login-taken') : 'login-taken';
    const session = `EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL)`;
    let inserted: number | undefined;
    try {
      [inserted] = await this.sql.batch([
        [
          `INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at, name, public_key, sign_count, transports)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE ${session}
             AND (SELECT count(*) FROM user_logins WHERE user_id = ?) < ?
             AND (? <> 'google' OR NOT EXISTS (SELECT 1 FROM user_logins WHERE user_id = ? AND provider = 'google'))`,
          [provider, subject, userId, now, now, name, publicKey, signCount, transports, sessionId, userId, userId, ACCOUNT_LIMITS.loginsPerUser, provider, userId],
        ],
        [
          `UPDATE users SET email = ? WHERE id = ? AND email IS NULL AND ? IS NOT NULL AND ${session}
             AND EXISTS (SELECT 1 FROM user_logins WHERE provider = ? AND subject = ? AND user_id = ?)
             AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
          [email, userId, email, sessionId, userId, provider, subject, userId, email],
        ],
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return 'login-taken';
      throw e;
    }
    if (inserted !== 1) {
      const [s] = await this.sql.all('SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [sessionId, userId]);
      return s ? 'limit' : 'unauthenticated';
    }
    return { provider: login.provider, id: subject, name, createdAt: now, lastUsedAt: now };
  }

  /** The user's logins, oldest first. */
  async list(userId: string): Promise<LoginMethod[]> {
    const rows = await this.sql.all('SELECT provider, subject, name, created_at, last_used_at FROM user_logins WHERE user_id = ? ORDER BY created_at, provider, subject', [userId]);
    return rows.map((r) => ({
      provider: r.provider as LoginProvider,
      id: String(r.subject),
      name: (r.name as string | null) ?? null,
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.last_used_at),
    }));
  }

  /** Renames one of the user's own passkeys. */
  async renamePasskey(userId: string, id: string, name: string): Promise<boolean> {
    return (await this.sql.run("UPDATE user_logins SET name = ? WHERE provider = 'passkey' AND subject = ? AND user_id = ?", [name, id, userId])) === 1;
  }

  /**
   * Removes one of the user's own logins, never the last: in one statement,
   * so two removals at once cannot leave none. A user who loses every way in
   * gets a new invite from an admin.
   */
  async remove(userId: string, provider: string, id: string): Promise<'ok' | 'last-login' | 'not-found'> {
    const n = await this.sql.run(
      `DELETE FROM user_logins WHERE provider = ? AND subject = ? AND user_id = ? AND (SELECT count(*) FROM user_logins WHERE user_id = ?) > 1`,
      [provider, id, userId, userId],
    );
    if (n === 1) return 'ok';
    const [r] = await this.sql.all('SELECT 1 FROM user_logins WHERE provider = ? AND subject = ? AND user_id = ?', [provider, id, userId]);
    return r ? 'last-login' : 'not-found';
  }
}
