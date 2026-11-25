// Which nightly backups are kept (backup-retention.ts): days, then weeks, then months, then none.
import { describe, expect, it } from 'vitest';
import { backupDay, keptBackups } from '../src/backup-retention.ts';

/** Every day from `from` back `count` days, newest first. */
function nights(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => backupDay(new Date(start - i * 86_400_000)));
}

describe('which backups are kept', () => {
  const today = '2026-11-25';

  it('keeps every night of the last two weeks', () => {
    const days = nights(today, 14);

    const kept = keptBackups(days, today);

    expect([...kept].toSorted()).toEqual([...days].toSorted());
  });

  it('keeps one night a week, the newest, from two weeks to eight weeks back', () => {
    const days = nights(today, 56);

    const kept = [...keptBackups(days, today)].filter((d) => d < '2026-11-12');

    // 2026-11-11 is the Wednesday after the daily nights end; then each Sunday, the newest night of its week.
    expect(kept.toSorted().toReversed()).toEqual(['2026-11-11', '2026-11-08', '2026-11-01', '2026-10-25', '2026-10-18', '2026-10-11', '2026-10-04']);
  });

  it('keeps one night a month, the newest, from eight weeks to a year back', () => {
    const days = nights(today, 365);

    const kept = [...keptBackups(days, today)].filter((d) => d < '2026-10-01');

    expect(kept.toSorted().toReversed()).toEqual(['2026-09-30', '2026-08-31', '2026-07-31', '2026-06-30', '2026-05-31', '2026-04-30', '2026-03-31', '2026-02-28', '2026-01-31', '2025-12-31', '2025-11-30']);
  });

  it('keeps nothing older than a year', () => {
    const kept = keptBackups(['2025-11-24', '2025-06-01'], today);

    expect(kept.size).toBe(0);
  });

  it('keeps about a year of backups in a few dozen', () => {
    const kept = keptBackups(nights(today, 400), today);

    expect(kept.size).toBeLessThanOrEqual(34);
  });

  it('keeps a name that is not a day, and a day after today', () => {
    const kept = keptBackups(['latest', '2026-11-26'], today);

    expect([...kept].toSorted()).toEqual(['2026-11-26', 'latest']);
  });

  it('names a backup by its day in UTC', () => {
    expect(backupDay(new Date('2026-11-25T23:30:00+01:00'))).toBe('2026-11-25');
  });
});
