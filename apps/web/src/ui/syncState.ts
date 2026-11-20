// How the sync stands, in words, and whether the bar should show it (docs/layout-2-0.md, "The start page and the bar"):
// the core's `syncStatusView` (crates/gp-core/src/sync_status.rs), which every shell asks; the words are each shell's.
import { useEffect, useState } from 'react';
import { pageCore } from '../db/pageCore.ts';
import type { DbStatus } from '../db/protocol.ts';
import { t } from '../i18n.ts';

/** A text of the core's, by its code. */
interface StatusText {
  code: 'idle' | 'syncing' | 'offline' | 'error' | 'authNeeded' | 'pending' | 'pendingOne';
  n?: number;
}

/** What needs the person's attention until it is dealt with (the yellow line under the bar, Shell.tsx). */
interface Notice {
  code: 'updateRequired' | 'notPaired' | 'authRequired';
  action: 'pairAgain' | 'signIn' | null;
}

interface SyncStatus {
  problem: boolean;
  texts: StatusText[];
  notice: Notice | null;
  /** Whether the grace applies: changes waiting, or no connection. */
  waiting: boolean;
  graceMs: number;
}

/** The core's word on the sync as `s` has it, `waitedLong` once `waiting` has held for the grace. */
function syncStatus(s: DbStatus | null, waitedLong: boolean): SyncStatus {
  const stopped = s?.updateRequired ? 'update-required' : (s?.authError ?? null);
  return pageCore().pure<SyncStatus>('syncStatusView', { pending: s?.pending ?? 0, stopped, connected: s?.connected ?? true, busy: s?.syncing ?? false, waitedLong });
}

/** The words of a text of the core's, each key written out. */
function word(text: StatusText): string {
  switch (text.code) {
    case 'idle':
      return t('status.idle');
    case 'syncing':
      return t('status.syncing');
    case 'offline':
      return t('status.offline');
    case 'error':
      return t('status.error');
    case 'authNeeded':
      return t('status.authNeeded');
    case 'pendingOne':
      return t('status.pendingOne');
    case 'pending':
      return t('status.pending', { n: text.n ?? 0 });
  }
}

/**
 * What the profile menu says of the sync, and whether something is wrong: an update needed, or offline or changes
 * waiting past the grace (`waitedLong`). Only then does the bar show the cloud; a page just loaded has not
 * connected yet, and is not offline for that (Lars, 2026-11-05). Signed out, the yellow line under the bar says so
 * with its button (Shell.tsx), and the bar and the columns' foot only count the changes that wait (Lars, 2026-11-07:
 * it was said three times at once).
 */
export function syncState(s: DbStatus, waitedLong: boolean): { problem: boolean; text: string } {
  const status = syncStatus(s, waitedLong);
  // What is wrong, then the changes that wait for it to be put right.
  return { problem: status.problem, text: status.texts.map(word).join(' · ') };
}

/** Whether the grace applies to `s` (`useWaitedLong`). */
export const syncWaiting = (s: DbStatus | null) => !!s && syncStatus(s, false).waiting;

/** What needs the person's attention, if anything (the yellow line, Shell.tsx). */
export const syncNotice = (s: DbStatus | null) => (s ? syncStatus(s, false).notice : null);

/**
 * Whether `waiting` has held for the grace (the core's): what waits a moment, as a page connecting after it loads, is
 * not shown as a problem, and so does not flash by.
 */
export function useWaitedLong(waiting: boolean): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLong(true), syncStatus(null, false).graceMs);
    return () => {
      clearTimeout(timer);
      setLong(false);
    };
  }, [waiting]);
  return waiting && long;
}

/** A user's initials for their picture until there are pictures: "Anna Andersson" is "AA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((w) => [...w][0]!.toLocaleUpperCase()).join('') || '?';
}
