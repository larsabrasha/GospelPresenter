// Helpers for debug servers and tests only.
import type { Role } from '@gp/core';
import type { MemberService } from './members.ts';
import type { GlobalSql } from './sql.ts';

/** Debug servers only: counting credential rows and making sessions without signing in. */
export class DebugService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
    private readonly members: MemberService,
  ) {}

  /** How many rows the tables that hold credentials have. */
  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['sessions', 'login_flows', 'passkey_flows', 'user_logins', 'invites']) out[t] = Number((await this.sql.all(`SELECT count(*) AS n FROM ${t}`))[0]?.n ?? 0);
    return out;
  }

  /** A user (made if missing) with a role in `orgId`, and a fresh session. */
  async session(userId: string, orgId: string, role: Role): Promise<string> {
    const now = this.now();
    await this.sql.batch([
      ['INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [userId, userId, now]],
      ['INSERT OR IGNORE INTO orgs (id, name, created_at) VALUES (?, ?, ?)', [orgId, orgId, now]],
      ['INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [userId, orgId, role]],
    ]);
    return (await this.members.createSession(userId, orgId, 'test')).token;
  }
}
