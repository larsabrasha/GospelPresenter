// The desktop host's pairing codes and paired devices.
import type { PairedDevice } from '@gp/core';
import { constantTimeEqual, newRowId, newSecret, sha256 } from '../crypto.ts';
import type { GlobalSql } from './sql.ts';

/** The desktop host's pairing codes and paired devices. */
export class PairingService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /** A new pairing code, which will sign the device in as `userId`; it replaces any earlier one (LIVE-R28: one code at a time). */
  async newPairCode(code: string, ttlMs: number, userId: string, orgId: string): Promise<number> {
    const expiresAt = this.now() + ttlMs;
    await this.sql.run('INSERT OR REPLACE INTO pair_codes (one, code_hash, expires_at, failures, user_id, org_id) VALUES (1, ?, ?, 0, ?, ?)', [
      await sha256(code),
      expiresAt,
      userId,
      orgId,
    ]);
    return expiresAt;
  }

  /**
   * Trades the code for a device token and the user it pairs the device as:
   * single use, refused once expired, and the code dies after `attempts`
   * wrong guesses.
   */
  async claimPairCode(code: string, name: string, attempts: number): Promise<{ token: string; deviceId: string; userId: string; orgId: string } | null> {
    const [r] = await this.sql.all('SELECT code_hash, expires_at, user_id, org_id FROM pair_codes WHERE one = 1');
    if (!r || Number(r.expires_at) <= this.now()) return null;
    const hash = await sha256(code);
    if (!constantTimeEqual(hash, String(r.code_hash))) {
      await this.sql.batch([
        ['UPDATE pair_codes SET failures = failures + 1 WHERE one = 1', []],
        ['DELETE FROM pair_codes WHERE one = 1 AND failures >= ?', [attempts]],
      ]);
      return null;
    }
    const token = newSecret('gppd_');
    const deviceId = newRowId();
    const now = this.now();
    // Deleting is the claim: of two racing claims, one deletes the row.
    if ((await this.sql.run('DELETE FROM pair_codes WHERE one = 1 AND code_hash = ? AND expires_at > ?', [hash, now])) !== 1) return null;
    await this.sql.run('INSERT INTO paired_devices (id, token_hash, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)', [
      deviceId,
      await sha256(token),
      name,
      now,
      now,
    ]);
    return { token, deviceId, userId: String(r.user_id), orgId: String(r.org_id) };
  }

  /** Whether `token` names a paired device that has not been disconnected. */
  async pairedDevice(token: string): Promise<boolean> {
    if (!token.startsWith('gppd_')) return false;
    const [r] = await this.sql.all('SELECT id, last_used_at FROM paired_devices WHERE token_hash = ? AND revoked_at IS NULL', [await sha256(token)]);
    if (!r) return false;
    const now = this.now();
    if (now - Number(r.last_used_at) > 5 * 60_000) await this.sql.run('UPDATE paired_devices SET last_used_at = ? WHERE id = ?', [now, r.id]);
    return true;
  }

  async pairedDevices(): Promise<PairedDevice[]> {
    const rows = await this.sql.all('SELECT id, name, created_at, last_used_at, revoked_at FROM paired_devices ORDER BY created_at DESC');
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.last_used_at),
      revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
    }));
  }

  /** Disconnects a device, and ends the sessions its pairing made. */
  async revokeDevice(id: string): Promise<boolean> {
    const now = this.now();
    const [n] = await this.sql.batch([
      ['UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now, id]],
      ['UPDATE sessions SET revoked_at = ? WHERE paired_device_id = ? AND revoked_at IS NULL', [now, id]],
    ]);
    return n === 1;
  }
}
