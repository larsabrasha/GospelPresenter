// MCP keys (docs/mcp.md): the experiment a Superadmin turns on per person, and the keys someone it is on for makes.
import { MCP_KEY_PREFIX, MCP_LIMITS, type McpKeyCreated, type McpKeyRow, type MemberRole } from '@gp/core';
import { newRowId, newSecret, sha256 } from '../crypto.ts';
import { OAUTH_PREFIX } from './oauth.ts';
import type { GlobalSql, Row } from './sql.ts';

/** Who a key acts as: its maker, in its organisation, with the role they have there now (D27). */
export interface McpCaller {
  keyId: string;
  userId: string;
  orgId: string;
  role: MemberRole;
}

const keyRow = (r: Row): McpKeyRow => ({
  id: String(r.id),
  name: String(r.name),
  orgName: String(r.org_name),
  createdAt: Number(r.created_at),
  lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
});

export class McpKeyService {
  constructor(
    private sql: GlobalSql,
    private now: () => number,
  ) {}

  /** Turns the experiment on or off for a user. Off deletes their keys: none comes back when it is turned on again. */
  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.sql.batch([
      ['UPDATE users SET mcp = ? WHERE id = ?', [enabled ? 1 : 0, userId]],
      ...(enabled ? [] : [['DELETE FROM mcp_keys WHERE user_id = ?', [userId]] as [string, unknown[]]]),
    ]);
  }

  /** A user's keys in every organisation, newest first. */
  async list(userId: string): Promise<McpKeyRow[]> {
    const rows = await this.sql.all(
      `SELECT k.id, k.name, k.created_at, k.last_used_at, o.name AS org_name FROM mcp_keys k JOIN orgs o ON o.id = k.org_id
       WHERE k.user_id = ? ORDER BY k.created_at DESC, k.id`,
      [userId],
    );
    return rows.map(keyRow);
  }

  /**
   * A new key in `orgId`, at most MCP_LIMITS.keysPerUser; `forbidden` unless the experiment is on for the user and
   * they are a member there (a Superadmin may be in an organisation without one, where a key would never work).
   */
  async create(userId: string, orgId: string, name: string): Promise<McpKeyCreated | 'forbidden' | 'limit'> {
    const [u] = await this.sql.all('SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id AND m.org_id = ? WHERE u.id = ? AND u.mcp = 1', [orgId, userId]);
    if (!u) return 'forbidden';
    const id = newRowId();
    const secret = newSecret(MCP_KEY_PREFIX);
    const now = this.now();
    // One statement checks the cap and inserts, so two at once cannot pass it.
    const n = await this.sql.run(
      `INSERT INTO mcp_keys (id, token_hash, user_id, org_id, name, created_at) SELECT ?, ?, ?, ?, ?, ?
       WHERE (SELECT count(*) FROM mcp_keys WHERE user_id = ?) < ?`,
      [id, await sha256(secret), userId, orgId, name, now, userId, MCP_LIMITS.keysPerUser],
    );
    if (n !== 1) return 'limit';
    const [o] = await this.sql.all('SELECT name FROM orgs WHERE id = ?', [orgId]);
    return { key: { id, name, orgName: String(o?.name ?? ''), createdAt: now, lastUsedAt: null }, secret };
  }

  /** Whether the user may make a key in `orgId`: the experiment on and a member there (the cap is checked as it is made). */
  async mayMake(userId: string, orgId: string): Promise<boolean> {
    const [u] = await this.sql.all('SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id AND m.org_id = ? WHERE u.id = ? AND u.mcp = 1', [orgId, userId]);
    return !!u;
  }

  /**
   * The key of an assistant's sign-in by OAuth (docs/mcp.md, "OAuth"), as `create` makes one; an earlier sign-in of
   * the same assistant (its name) in the organisation goes, so connecting Claude again does not fill the ten. A key made
   * by hand, which has no OAuth tokens, is never replaced.
   */
  async createForAssistant(userId: string, orgId: string, name: string): Promise<McpKeyCreated | 'forbidden' | 'limit'> {
    await this.sql.run('DELETE FROM mcp_keys WHERE user_id = ? AND org_id = ? AND name = ? AND id IN (SELECT key_id FROM oauth_tokens)', [userId, orgId, name]);
    return this.create(userId, orgId, name);
  }

  /** Deletes one of the user's own keys: whatever uses it is refused from the next request. */
  async remove(userId: string, keyId: string): Promise<'ok' | 'not-found'> {
    const n = await this.sql.run('DELETE FROM mcp_keys WHERE id = ? AND user_id = ?', [keyId, userId]);
    return n === 1 ? 'ok' : 'not-found';
  }

  /** Whether the experiment is on for a user: off, an assistant's sign-in by OAuth is not offered. */
  async enabled(userId: string): Promise<boolean> {
    const [u] = await this.sql.all('SELECT 1 FROM users WHERE id = ? AND mcp = 1', [userId]);
    return !!u;
  }

  /**
   * Who a bearer secret acts as: a key, or an OAuth access token of a sign-in allowed (a key row too); null for an
   * unknown one, one run out, a maker the experiment is off for, or one no longer a member there.
   */
  async authenticate(secret: string): Promise<McpCaller | null> {
    const key = secret.startsWith(MCP_KEY_PREFIX);
    if (!key && !secret.startsWith(OAUTH_PREFIX.access)) return null;
    const [r] = await this.sql.all(
      `SELECT k.id, k.user_id, k.org_id, k.last_used_at, m.role FROM mcp_keys k
       JOIN users u ON u.id = k.user_id AND u.mcp = 1
       JOIN memberships m ON m.user_id = k.user_id AND m.org_id = k.org_id
       ${key ? 'WHERE k.token_hash = ?' : `JOIN oauth_tokens t ON t.key_id = k.id AND t.kind = 'access' WHERE t.hash = ? AND t.expires_at > ?`}`,
      key ? [await sha256(secret)] : [await sha256(secret), this.now()],
    );
    if (!r) return null;
    const now = this.now();
    // Not written on every call: an assistant makes many in a row, and the list shows the day, not the second.
    if (r.last_used_at === null || now - Number(r.last_used_at) > 5 * 60_000) await this.sql.run('UPDATE mcp_keys SET last_used_at = ? WHERE id = ?', [now, r.id]);
    return { keyId: String(r.id), userId: String(r.user_id), orgId: String(r.org_id), role: r.role as MemberRole };
  }
}
