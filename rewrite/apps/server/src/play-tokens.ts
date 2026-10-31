import { MEDIA_HASH, PLAY_TOKEN_MS } from '@gp/core';
import { newSecret, sha256 } from './crypto.ts';
import type { GlobalSql } from './global/index.ts';

// What a `<video src>` streams with (TODO.md "Video"): it cannot send the
// session's header, so a signed-in caller asks for a token that names one
// blob of its organisation and is good for a few hours, and the URL carries
// it (`/api/play/{token}/{hash}`). Only the token's hash is stored. A token is
// never renewed: a page asks for a new one when its own runs out. It is good
// only while the session it was minted for is: signing out ends it too. The
// URL is never logged by the server; `Referrer-Policy: no-referrer` keeps it
// out of other sites' logs.

export class PlayTokens {
  constructor(
    private sql: GlobalSql,
    private now: () => number = Date.now,
  ) {}

  /** A new token for the blob. Expired tokens go at the same time, so the table holds only live ones. */
  async mint(orgId: string, sessionId: string, hash: string): Promise<{ token: string; expiresAt: number }> {
    const token = newSecret('gppl_');
    const now = this.now();
    const expiresAt = now + PLAY_TOKEN_MS;
    await this.sql.batch([
      ['DELETE FROM play_tokens WHERE expires_at < ?', [now]],
      [
        'INSERT INTO play_tokens (token_hash, org_id, media_hash, session_id, expires_at) VALUES (?, ?, ?, ?, ?)',
        [await sha256(token), orgId, hash, sessionId, expiresAt],
      ],
    ]);
    return { token, expiresAt };
  }

  /** The organisation a live token names, if it names this blob and its session is not revoked; null otherwise. */
  async orgOf(token: string, hash: string): Promise<string | null> {
    if (!/^gppl_[A-Za-z0-9_-]{43}$/.test(token) || !MEDIA_HASH.test(hash)) return null;
    const [row] = (await this.sql.all(
      `SELECT p.org_id FROM play_tokens p JOIN sessions s ON s.id = p.session_id
       WHERE p.token_hash = ? AND p.media_hash = ? AND p.expires_at > ? AND s.revoked_at IS NULL`,
      [await sha256(token), hash, this.now()],
    )) as {
      org_id: string;
    }[];
    return row?.org_id ?? null;
  }
}
