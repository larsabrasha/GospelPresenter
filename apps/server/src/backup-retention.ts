// Which nightly backups are kept, thinned out as Time Machine thins its own (Lars, 2026-11-25): every day for two
// weeks, then the newest of each week for eight weeks, then the newest of each month for a year. At most about 34, and
// the rest are removed. The Docker image's backups (backup-node.ts) and Cloudflare's (backup-r2.ts) keep the same.

/** How far back each kind reaches, in days. */
const BACKUP_RETENTION = { daily: 14, weekly: 56, monthly: 365 } as const;

/** A backup's day, `YYYY-MM-DD` in UTC, as backups are named. */
export const backupDay = (at: Date) => at.toISOString().slice(0, 10);

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/** The Monday of a day's week, as a day number: two days in one week share it. */
const weekOf = (n: number) => n - ((n + 3) % 7);

/**
 * The days among `days` to keep on `today`: every one of the last two weeks; older, the newest of each week up to
 * eight weeks back; older still, the newest of each month up to a year back; nothing older. A name that is not a day,
 * or a day after today, is kept: this rule did not make it, so it does not remove it.
 */
export function keptBackups(days: readonly string[], today: string): Set<string> {
  const now = dayNumber(today);
  const keep = new Set<string>();
  const weeks = new Set<number>();
  const months = new Set<string>();
  for (const day of days.toSorted().toReversed()) {
    const n = dayNumber(day);
    const age = now - n;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(n) || age < BACKUP_RETENTION.daily) keep.add(day);
    else if (age < BACKUP_RETENTION.weekly) {
      if (!weeks.has(weekOf(n))) keep.add(day);
      weeks.add(weekOf(n));
    } else if (age < BACKUP_RETENTION.monthly) {
      if (!months.has(day.slice(0, 7))) keep.add(day);
      months.add(day.slice(0, 7));
    }
  }
  return keep;
}
