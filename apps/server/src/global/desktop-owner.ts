// The desktop app used without an account (Lars, 2026-11-26; docs/sign-in-and-pairing.md): the person who set the
// computer up so owns it, and its own window is them without signing in. Phones and screens still come in by pairing.
import type { MemberService } from './members.ts';
import type { GlobalSql } from './sql.ts';

export class DesktopOwnerService {
  constructor(
    private sql: GlobalSql,
    private members: MemberService,
  ) {}

  /**
   * The first run without an account: the person and the church, the person an Admin with the Superadmin mark as setup
   * makes them (`MemberService.setup`), with no invite to accept, and the computer's owner. Only while setup is not
   * done; a setup left before its sign-in is finished so, its person and church renamed.
   */
  async setup(a: { name: string; orgName: string }): Promise<{ userId: string; orgId: string } | 'setup-done'> {
    if (await this.members.setupDone()) return 'setup-done';
    const r = await this.members.setup(a);
    if (r === 'setup-done') return r;
    const [, owned] = await this.sql.batch([
      ['DELETE FROM invites WHERE user_id = ? AND used_at IS NULL', [r.userId]],
      [`INSERT INTO host_owner (user_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM user_logins) AND NOT EXISTS (SELECT 1 FROM host_owner)`, [r.userId]],
    ]);
    return owned === 1 ? { userId: r.userId, orgId: r.orgId } : 'setup-done';
  }

  /**
   * Whom the computer's own window is without signing in: the owner setup without an account made, else (a computer
   * set up with a sign-in before there was this way) its first Superadmin; null before setup.
   */
  async owner(): Promise<string | null> {
    const [own] = await this.sql.all('SELECT user_id FROM host_owner LIMIT 1');
    if (own) return String(own.user_id);
    const [first] = await this.sql.all('SELECT id FROM users WHERE super_admin = 1 ORDER BY created_at, id LIMIT 1');
    return first ? String(first.id) : null;
  }
}
