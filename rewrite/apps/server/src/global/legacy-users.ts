// The users of a 1.x organisation, brought along by its import (docs/import-from-1x.md).
import { ACCOUNT_LIMITS, type LegacyUser } from '@gp/core';
import { newRowId } from '../crypto.ts';
import type { MemberService } from './members.ts';
import type { GlobalSql } from './sql.ts';

/**
 * What became of one user: a new account, a membership for one who had an account, nothing for a member already, or
 * an invitation (`invited`, an Admin's import).
 */
export type LegacyUserOutcome = 'created' | 'member' | 'kept' | 'invited' | 'limit';

export class LegacyUserService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
    private readonly members: MemberService,
  ) {}

  /**
   * One user, by e-mail, for a Superadmin's import (an Admin's invites them instead). Their Google logins are linked,
   * so their first sign-in finds the account (AUTH-R4 matches by subject); a subject someone else has is left with
   * them. One with an account already becomes a member with `role` at once, and a member here already is left as they
   * are. One with no way to sign in gets a reset link, which a Superadmin sends from Användare.
   */
  async import(orgId: string, u: LegacyUser): Promise<LegacyUserOutcome> {
    const [taken] = await this.sql.all('SELECT id FROM users WHERE email = ? ORDER BY email_confirmed DESC, created_at LIMIT 1', [u.email]);
    let outcome: LegacyUserOutcome;
    let userId: string;
    if (taken) {
      userId = String(taken.id);
      const [member] = await this.sql.all('SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
      if (member) outcome = 'kept';
      else {
        const n = await this.sql.run(
          `INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, ? WHERE (SELECT count(*) FROM memberships WHERE org_id = ?) < ?`,
          [userId, orgId, u.role, orgId, ACCOUNT_LIMITS.usersPerOrg],
        );
        outcome = n === 1 ? 'member' : 'limit';
      }
    } else {
      userId = newRowId();
      const [inserted] = await this.sql.batch([
        [
          `INSERT INTO users (id, name, email, created_at) SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM memberships WHERE org_id = ?) < ?`,
          [userId, u.name, u.email, this.now(), orgId, ACCOUNT_LIMITS.usersPerOrg],
        ],
        [`INSERT INTO memberships (user_id, org_id, role) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`, [userId, orgId, u.role, userId]],
      ]);
      outcome = inserted === 1 ? 'created' : 'limit';
    }
    if (outcome === 'limit') return outcome;
    for (const subject of u.google) {
      await this.sql.run(
        `INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at, name) VALUES ('google', ?, ?, ?, ?, ?) ON CONFLICT (provider, subject) DO NOTHING`,
        [subject, userId, this.now(), this.now(), u.email],
      );
    }
    const [login] = await this.sql.all('SELECT 1 FROM user_logins WHERE user_id = ?', [userId]);
    if (!login && outcome !== 'kept') await this.members.createInvite(userId, orgId);
    return outcome;
  }
}
