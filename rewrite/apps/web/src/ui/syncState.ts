// How the sync stands, in words, and whether the bar should show it (docs/layout-2-0.md, "The start page and the bar").
import type { DbStatus } from '../db/protocol.ts';
import { t } from '../i18n.ts';

/** How long changes may wait before they count as a problem: a device syncs within a moment of every save. */
export const PENDING_GRACE_MS = 1500;

/**
 * What the profile menu says of the sync, and whether something is wrong: signed out, an update needed, offline, or
 * changes that have waited past `PENDING_GRACE_MS` (`pendingLong`). Only then does the bar show the cloud.
 */
export function syncState(s: DbStatus, pendingLong: boolean): { problem: boolean; text: string } {
  const pending = s.pending === 1 ? t('status.pendingOne') : s.pending > 1 ? t('status.pending', { n: s.pending }) : null;
  const problem = s.authError !== null ? t('status.authNeeded') : s.updateRequired ? t('status.error') : !s.connected ? t('status.offline') : null;
  // What is wrong, then the changes that wait for it to be put right.
  if (problem) return { problem: true, text: [problem, pending].filter(Boolean).join(' · ') };
  if (pending && pendingLong) return { problem: true, text: pending };
  return { problem: false, text: t(s.syncing || pending ? 'status.syncing' : 'status.idle') };
}

/** A user's initials for their picture until there are pictures: "Anna Andersson" is "AA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((w) => [...w][0]!.toLocaleUpperCase()).join('') || '?';
}
