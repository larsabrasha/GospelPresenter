// Sign-in throttling: failures per key, and the locks they earn.
import { PasskeyAccounts } from './passkeys.ts';

/** How sign-in failures slow an attacker down (docs/assumptions.md). */
export interface ThrottlePolicy {
  /** Failures allowed in `windowMs` before a lock. */
  free: number;
  windowMs: number;
  /** The first lock; each further failure doubles it, up to `maxLockMs`. */
  lockMs: number;
  maxLockMs: number;
}

export const THROTTLE = {
  /** Per address: slows one machine trying setup tokens or pairing codes. */
  address: { free: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxLockMs: 15 * 60_000 },
  /** Per address: slows one machine guessing public output codes (`/api/watch/`). Only unknown codes count. */
  watch: { free: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxLockMs: 15 * 60_000 },
  /** Per address: slows one machine making temporary screens, each a row until it is paired or a day old. */
  screen: { free: 30, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxLockMs: 15 * 60_000 },
} satisfies Record<string, ThrottlePolicy>;

export class ThrottleAccounts extends PasskeyAccounts {
  // ------------------------------------------------------------ throttling

  /** Until when any of `keys` is locked (0 when none is). */
  async lockedUntil(keys: string[]): Promise<number> {
    const rows = await this.sql.all(`SELECT max(locked_until) AS t FROM auth_throttle WHERE key IN (${keys.map(() => '?').join(', ')})`, keys);
    const t = Number(rows[0]?.t ?? 0);
    return t > this.now() ? t : 0;
  }

  /** Counts a failure for `key`; a failure after the window starts a new one. */
  async fail(key: string, p: ThrottlePolicy): Promise<void> {
    const now = this.now();
    await this.sql.batch([
      [
        `INSERT INTO auth_throttle (key, failures, first_at, locked_until) VALUES (?, 1, ?, 0)
         ON CONFLICT (key) DO UPDATE SET
           failures = CASE WHEN ? - first_at > ? THEN 1 ELSE failures + 1 END,
           first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`,
        [key, now, now, p.windowMs, now, p.windowMs, now],
      ],
      [
        `UPDATE auth_throttle SET locked_until = ? + min(?, ? * (1 << min(failures - ?, 20)))
         WHERE key = ? AND failures >= ?`,
        [now, p.maxLockMs, p.lockMs, p.free, key, p.free],
      ],
    ]);
  }

  async clearThrottle(key: string): Promise<void> {
    await this.sql.run('DELETE FROM auth_throttle WHERE key = ?', [key]);
  }
}
