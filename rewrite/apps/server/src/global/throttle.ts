// Throttling: failures (or asks) per key, and the locks they earn.
import type { GlobalSql } from './sql.ts';

/** How failures slow an attacker down (docs/assumptions.md): `free` in `windowMs`, then a lock as long as the window. */
export interface ThrottlePolicy {
  free: number;
  windowMs: number;
}

const QUARTER = 15 * 60_000;
const HOUR = 60 * 60_000;

export const THROTTLE = {
  /** Per address (setup tokens, pairing and screen codes, public output codes), and per user and organisation for screen codes. */
  address: { free: 20, windowMs: QUARTER },
  /** "Glömt hur du loggar in?" per address and per e-mail address: every ask counts, so nobody floods a mailbox. */
  recover: { free: 5, windowMs: HOUR },
  /** Per address: slows one machine making temporary screens, each a row until it is paired or a day old. */
  screen: { free: 30, windowMs: QUARTER },
  /** Bug reports per user: every one counts, so one user cannot push the others out of the kept cap. */
  report: { free: 10, windowMs: HOUR },
  /** Client errors per user: every one counts, so one client in a loop cannot flood the log. */
  clientError: { free: 30, windowMs: QUARTER },
} satisfies Record<string, ThrottlePolicy>;

/** The answer to a key that is locked: 429 with how long to wait. */
export function tooManyAttempts(lockedUntil: number, now: number): Response {
  const seconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
  return new Response(JSON.stringify({ error: 'too-many-attempts', retryAfter: seconds }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(seconds) },
  });
}

/** Failures per key, and the locks they earn. */
export class ThrottleService {
  constructor(
    private readonly sql: GlobalSql,
    private readonly now: () => number,
  ) {}

  /** Until when any of `keys` is locked (0 when none is). */
  async lockedUntil(keys: string[]): Promise<number> {
    const rows = await this.sql.all(`SELECT max(locked_until) AS t FROM auth_throttle WHERE key IN (${keys.map(() => '?').join(', ')})`, keys);
    const t = Number(rows[0]?.t ?? 0);
    return t > this.now() ? t : 0;
  }

  /** Counts a failure for each of `keys`, in one batch; a failure after a key's window starts a new one. */
  async fail(keys: string | string[], p: ThrottlePolicy): Promise<void> {
    const now = this.now();
    await this.sql.batch(
      [keys].flat().flatMap((key): [string, unknown[]][] => [
        [
          `INSERT INTO auth_throttle (key, failures, first_at, locked_until) VALUES (?, 1, ?, 0)
           ON CONFLICT (key) DO UPDATE SET
             failures = CASE WHEN ? - first_at > ? THEN 1 ELSE failures + 1 END,
             first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`,
          [key, now, now, p.windowMs, now, p.windowMs, now],
        ],
        ['UPDATE auth_throttle SET locked_until = ? WHERE key = ? AND failures >= ?', [now + p.windowMs, key, p.free]],
      ]),
    );
  }

  /**
   * An ask where every one counts (a mail sent, a report kept): the time `keys` are locked until, or 0, and then the
   * ask counted against each of them.
   */
  async count(keys: string[], p: ThrottlePolicy): Promise<number> {
    const locked = await this.lockedUntil(keys);
    if (!locked) await this.fail(keys, p);
    return locked;
  }
}
