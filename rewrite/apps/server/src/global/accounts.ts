// `Accounts`, the end of the chain: every domain's methods, and the debug helpers tests use.
import type { Role } from '@gp/core';
import { PairingAccounts } from './pairing.ts';

/** Every read and write of the global tables. Methods return an error code instead of throwing for expected refusals. */
export class Accounts extends PairingAccounts {
  // ------------------------------------------------------------ tests

  /** Debug servers only: how many rows the tables that hold credentials have. */
  async debugCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['sessions', 'login_flows', 'passkey_flows', 'user_logins', 'invites']) out[t] = Number((await this.sql.all(`SELECT count(*) AS n FROM ${t}`))[0]?.n ?? 0);
    return out;
  }

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
