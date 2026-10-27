import { SCREEN_ID, SCREEN_PAIRING_MS, SCREEN_PIN, SCREEN_TOKEN } from '@gp/core';
import { b64url } from './crypto.ts';
import type { GlobalSql } from './global.ts';

// Temporary screens (spec 04 §5, LIVE-R28). A TV that opens `/display` gets
// an id, its only credential, and a four-digit code to show. An operator who
// types the code, or a TV that opens the operator's QR token, pairs the screen
// with that operator's organisation. Kept in the global tables, since an
// unpaired screen belongs to no organisation yet.

/** A screen nobody paired is forgotten after a day; one that was paired, when its session lets it go. */
const UNPAIRED_KEPT_MS = 24 * 60 * 60_000;

export type ScreenStart = { id: string; pin: string; expiresAt: number } | { id: string; paired: true };

const secret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export class ScreenRegistry {
  constructor(
    private sql: GlobalSql,
    private now: () => number = Date.now,
  ) {}

  /**
   * A screen's state, for the TV: its code while unpaired (a new one once the
   * old has run out), or that it is paired. `id` is the one the tab kept; an
   * unknown one gets a new screen. Null when no free code was found.
   */
  async start(id: string | null): Promise<ScreenStart | null> {
    const now = this.now();
    const [known] = id && SCREEN_ID.test(id) ? ((await this.sql.all('SELECT id, pin, pin_expires, org_id FROM screens WHERE id = ?', [id])) as unknown as Row[]) : [];
    if (known?.org_id) return { id: known.id, paired: true };
    if (known?.pin && Number(known.pin_expires) > now) return { id: known.id, pin: known.pin, expiresAt: Number(known.pin_expires) };
    // Only when a code is handed out, not on every poll: old unpaired screens and expired tokens go; a used
    // token waits a day for its dialog to ask, then goes too.
    await this.sql.batch([
      ['DELETE FROM screens WHERE org_id IS NULL AND created_at < ?', [now - UNPAIRED_KEPT_MS]],
      ['DELETE FROM screen_tokens WHERE expires < ? AND (screen_id IS NULL OR expires < ?)', [now, now - UNPAIRED_KEPT_MS]],
    ]);
    const screenId = known?.id ?? secret();
    const expiresAt = now + SCREEN_PAIRING_MS;
    for (let attempt = 0; attempt < 20; attempt++) {
      const pin = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 8999)); // [1000, 9998]
      const [taken] = (await this.sql.all('SELECT id FROM screens WHERE pin = ? AND pin_expires > ?', [pin, now])) as { id: string }[];
      if (taken) continue;
      // An expired code that is still in a row gives way; then this screen takes it. A code another
      // screen took since the check stays its own: the unique pin makes this batch fail, and another is tried.
      try {
        await this.sql.batch([
          ['UPDATE screens SET pin = NULL, pin_expires = NULL WHERE pin = ? AND pin_expires <= ?', [pin, now]],
          [
            'INSERT INTO screens (id, pin, pin_expires, org_id, created_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT (id) DO UPDATE SET pin = excluded.pin, pin_expires = excluded.pin_expires',
            [screenId, pin, expiresAt, now],
          ],
        ]);
      } catch {
        continue;
      }
      return { id: screenId, pin, expiresAt };
    }
    return null;
  }

  /** A TV that opened the operator's QR code: a new screen, paired at once. Null for an unknown, used or expired token. */
  async startWithToken(token: string): Promise<string | null> {
    if (!SCREEN_TOKEN.test(token)) return null;
    const now = this.now();
    const [t] = (await this.sql.all('SELECT org_id FROM screen_tokens WHERE token = ? AND expires > ? AND screen_id IS NULL', [token, now])) as { org_id: string }[];
    if (!t) return null;
    const id = secret();
    // Single use (LIVE-R28): only the update that finds it unused pairs.
    const [used] = await this.sql.batch([
      ['UPDATE screen_tokens SET screen_id = ? WHERE token = ? AND screen_id IS NULL', [id, token]],
      ['INSERT INTO screens (id, pin, pin_expires, org_id, created_at) SELECT ?, NULL, NULL, ?, ? WHERE changes() = 1', [id, t.org_id, now]],
    ]);
    return used === 1 ? id : null;
  }

  /** The operator typed a code: the screen showing it is paired with the organisation. Null for a wrong or expired code. */
  async claimPin(pin: string, orgId: string): Promise<string | null> {
    if (!SCREEN_PIN.test(pin)) return null;
    const [s] = (await this.sql.all('SELECT id FROM screens WHERE pin = ? AND pin_expires > ? AND org_id IS NULL', [pin, this.now()])) as { id: string }[];
    if (!s) return null;
    const changed = await this.sql.run('UPDATE screens SET org_id = ?, pin = NULL, pin_expires = NULL WHERE id = ? AND org_id IS NULL', [orgId, s.id]);
    return changed === 1 ? s.id : null;
  }

  /** A QR token for the pairing dialog: single use, ten minutes (LIVE-R28). */
  async newToken(orgId: string): Promise<{ token: string; expiresAt: number }> {
    const token = secret();
    const expiresAt = this.now() + SCREEN_PAIRING_MS;
    await this.sql.run('INSERT INTO screen_tokens (token, org_id, expires, screen_id) VALUES (?, ?, ?, NULL)', [token, orgId, expiresAt]);
    return { token, expiresAt };
  }

  /** The screen a token paired, once a TV used it; the token is then gone. Null while unused, or not this organisation's. */
  async tokenUsed(token: string, orgId: string): Promise<string | null> {
    if (!SCREEN_TOKEN.test(token)) return null;
    const [t] = (await this.sql.all('SELECT screen_id FROM screen_tokens WHERE token = ? AND org_id = ? AND screen_id IS NOT NULL', [token, orgId])) as {
      screen_id: string;
    }[];
    if (!t) return null;
    await this.sql.run('DELETE FROM screen_tokens WHERE token = ?', [token]);
    return t.screen_id;
  }

  /**
   * A dialog closed, or renewed its token: the token can no longer pair (LIVE-R28).
   * Returns the screen a TV paired with it since the dialog last asked, which no session took in: the caller lets it go.
   */
  async dropToken(token: string, orgId: string): Promise<string | null> {
    const [t] = (await this.sql.all('SELECT screen_id FROM screen_tokens WHERE token = ? AND org_id = ?', [token, orgId])) as { screen_id: string | null }[];
    await this.sql.run('DELETE FROM screen_tokens WHERE token = ? AND org_id = ?', [token, orgId]);
    return t?.screen_id ?? null;
  }

  /** The organisation a screen is paired with, if any, and its name for the page title. */
  async orgOf(id: string): Promise<{ orgId: string; orgName: string } | null> {
    if (!SCREEN_ID.test(id)) return null;
    const [s] = (await this.sql.all('SELECT s.org_id, o.name FROM screens s LEFT JOIN orgs o ON o.id = s.org_id WHERE s.id = ? AND s.org_id IS NOT NULL', [id])) as {
      org_id: string;
      name: string | null;
    }[];
    return s ? { orgId: s.org_id, orgName: s.name ?? '' } : null;
  }

  /** Screens a session let go: they are forgotten, and their TVs start again with a new code. */
  async release(ids: string[]): Promise<void> {
    if (ids.length) await this.sql.batch(ids.map((id) => ['DELETE FROM screens WHERE id = ?', [id]] as [string, unknown[]]));
  }
}

interface Row {
  id: string;
  pin: string | null;
  pin_expires: number | null;
  org_id: string | null;
}
