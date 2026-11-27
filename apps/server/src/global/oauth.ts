// OAuth for MCP (docs/mcp.md, "OAuth"), as praliner's (github.com/larsabrasha/praliner, server/oauth.ts): an assistant
// registers itself, the person allows it on the app's own page, and it gets a code it trades, with PKCE, for tokens.
// What is allowed is a row of `mcp_keys` (McpKeyService.create): listed under Mina inställningar, deleted there, and
// ended with the experiment, the membership or a reset link as any key is. Codes and tokens are kept only as hashes.
import { newSecret, sha256 } from '../crypto.ts';
import type { GlobalSql } from './sql.ts';

export const OAUTH = {
  codeMs: 10 * 60_000,
  accessMs: 60 * 60_000,
  refreshMs: 90 * 24 * 60 * 60_000,
} as const;

/** Where a code may be sent: Claude's and ChatGPT's own pages, and this machine (Claude Code, MCP Inspector). */
export const REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'];

/** Whether an address may receive a code: one of REDIRECT_HOSTS over https, or this machine. */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return REDIRECT_HOSTS.includes(u.hostname);
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
}

/**
 * What a code stands for: the client it was handed to and its name, where to, its PKCE challenge, and who allowed it
 * where. Its key is made only when it is traded, so a code never traded leaves nothing behind.
 */
interface CodeData {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  userId: string;
  orgId: string;
}

/** The tokens an assistant gets: an access token for an hour, and one to renew it with, once, for up to 90 days. */
export interface OAuthTokens {
  access: string;
  refresh: string;
}

/** What an access token and a refresh token start with, so a log or a scan for secrets tells them apart. */
export const OAUTH_PREFIX = { access: 'gpoa_', refresh: 'gpor_' } as const;

/** A PKCE challenge of `verifier`: its SHA-256, base64url (RFC 7636, S256). */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export class OAuthService {
  constructor(
    private sql: GlobalSql,
    private now: () => number,
  ) {}

  async addClient(name: string, redirectUris: string[]): Promise<OAuthClient> {
    const client = { id: newSecret('gpoc_'), name, redirectUris };
    await this.sql.run('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)', [client.id, name, JSON.stringify(redirectUris), this.now()]);
    return client;
  }

  async client(id: string): Promise<OAuthClient | null> {
    const [r] = await this.sql.all('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?', [id]);
    return r ? { id: String(r.id), name: String(r.name), redirectUris: JSON.parse(String(r.redirect_uris)) as string[] } : null;
  }

  /** A code for `data`, usable once within ten minutes. */
  async addCode(data: CodeData): Promise<string> {
    const code = newSecret('');
    await this.sql.run(
      'INSERT INTO oauth_codes (hash, client_id, client_name, redirect_uri, challenge, user_id, org_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [await sha256(code), data.clientId, data.clientName, data.redirectUri, data.challenge, data.userId, data.orgId, this.now() + OAUTH.codeMs],
    );
    return code;
  }

  /** What a code stands for, once: it is deleted as it is read. Null when unknown or too old. */
  async takeCode(code: string): Promise<CodeData | null> {
    const [r] = await this.sql.all(
      'DELETE FROM oauth_codes WHERE hash = ? RETURNING client_id, client_name, redirect_uri, challenge, user_id, org_id, expires_at',
      [await sha256(code)],
    );
    if (!r || Number(r.expires_at) < this.now()) return null;
    return {
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      redirectUri: String(r.redirect_uri),
      challenge: String(r.challenge),
      userId: String(r.user_id),
      orgId: String(r.org_id),
    };
  }

  /** New tokens for a sign-in that is still allowed (its key row there). */
  async issue(keyId: string, clientId: string): Promise<OAuthTokens> {
    const tokens = { access: newSecret(OAUTH_PREFIX.access), refresh: newSecret(OAUTH_PREFIX.refresh) };
    const now = this.now();
    const insert = 'INSERT INTO oauth_tokens (hash, kind, key_id, client_id, expires_at) VALUES (?, ?, ?, ?, ?)';
    await this.sql.batch([
      [insert, [await sha256(tokens.access), 'access', keyId, clientId, now + OAUTH.accessMs]],
      [insert, [await sha256(tokens.refresh), 'refresh', keyId, clientId, now + OAUTH.refreshMs]],
    ]);
    return tokens;
  }

  /**
   * A refresh token traded once (rotation): deleted as it is read. Null when unknown, too old, or its sign-in is no
   * longer allowed, its key deleted.
   */
  async takeRefresh(token: string): Promise<{ keyId: string; clientId: string } | null> {
    const [r] = await this.sql.all(`DELETE FROM oauth_tokens WHERE hash = ? AND kind = 'refresh' RETURNING key_id, client_id, expires_at`, [await sha256(token)]);
    if (!r || Number(r.expires_at) < this.now()) return null;
    const [key] = await this.sql.all('SELECT 1 FROM mcp_keys WHERE id = ?', [r.key_id]);
    return key ? { keyId: String(r.key_id), clientId: String(r.client_id) } : null;
  }

  /**
   * Removes codes and tokens that have run out, tokens of a sign-in no longer allowed, and clients registered a day ago
   * or more that nothing was ever allowed for.
   */
  async purge(): Promise<void> {
    const now = this.now();
    await this.sql.batch([
      ['DELETE FROM oauth_codes WHERE expires_at < ?', [now]],
      ['DELETE FROM oauth_tokens WHERE expires_at < ? OR key_id NOT IN (SELECT id FROM mcp_keys)', [now]],
      [
        `DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_tokens) AND id NOT IN (SELECT client_id FROM oauth_codes)`,
        [now - 24 * 60 * 60_000],
      ],
    ]);
  }
}
