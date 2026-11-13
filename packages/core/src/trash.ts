// The trash (spec 03 section 5): songs and presentations stay there for 30
// days before they are purged.

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;

/** max(0, 30 − whole days since deletion) (SONG-R26, PRES-R26). */
export function daysRemaining(deletedAt: number, now: number): number {
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - deletedAt) / DAY_MS));
}
