import { THROTTLE, type Accounts, type GlobalSql } from './global/index.ts';

// Public output codes across organisations (spec 04 §6, LIVE-R30). An
// organisation's outputs are synced rows in its own database; an anonymous
// viewer has only the code, so the server keeps a global index of them.

export interface WatchTarget {
  orgId: string;
  displayId: string;
  /** For the page title (spec 04 §6). */
  orgName: string;
}

export class WatchRegistry {
  constructor(private sql: GlobalSql) {}

  /**
   * Makes the index match an organisation's outputs: its codes that are gone
   * go, new ones come. A code another organisation already holds is not
   * taken over (that output's link then answers 404 until it gets a new code;
   * with 31^7 codes this is very unlikely).
   */
  async sync(orgId: string, displays: { id: string; code: string }[]): Promise<void> {
    const known = (await this.sql.all('SELECT code, display_id FROM watch_codes WHERE org_id = ?', [orgId])) as { code: string; display_id: string }[];
    const wanted = new Map(displays.map((d) => [d.code, d.id]));
    const statements: [string, unknown[]][] = [];
    for (const k of known) if (wanted.get(k.code) !== k.display_id) statements.push(['DELETE FROM watch_codes WHERE code = ? AND org_id = ?', [k.code, orgId]]);
    for (const [code, displayId] of wanted) {
      if (!known.some((k) => k.code === code && k.display_id === displayId)) {
        statements.push(['INSERT INTO watch_codes (code, org_id, display_id) VALUES (?, ?, ?) ON CONFLICT (code) DO NOTHING', [code, orgId, displayId]]);
      }
    }
    if (statements.length) await this.sql.batch(statements);
  }

  async lookup(code: string): Promise<WatchTarget | null> {
    const [r] = (await this.sql.all('SELECT w.org_id, w.display_id, o.name FROM watch_codes w LEFT JOIN orgs o ON o.id = w.org_id WHERE w.code = ?', [
      code,
    ])) as { org_id: string; display_id: string; name: string | null }[];
    return r ? { orgId: r.org_id, displayId: r.display_id, orgName: r.name ?? '' } : null;
  }
}

/**
 * A lookup that a guesser cannot repeat for ever (spec 04 §6 has no limit; a
 * code is short enough to be found by chance across many organisations).
 * An unknown code counts as a failure for the address; after 20 in 15
 * minutes the address gets nothing, a known code included, for 15 minutes.
 * Viewers with a real code never count, however many share an address.
 */
export async function lookupThrottled(
  registry: WatchRegistry,
  accounts: Pick<Accounts, 'throttle'>,
  code: string,
  address: string,
): Promise<WatchTarget | { lockedUntil: number } | null> {
  const key = `watch:${address}`;
  const until = await accounts.throttle.lockedUntil([key]);
  if (until) return { lockedUntil: until };
  const target = await registry.lookup(code);
  if (!target) await accounts.throttle.fail(key, THROTTLE.watch);
  return target;
}
