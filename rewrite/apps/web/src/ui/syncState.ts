// How the sync stands, in words, and whether the bar should show it (docs/layout-2-0.md, "The start page and the bar").
import { useEffect, useState } from 'react';
import type { DbStatus } from '../db/protocol.ts';
import { t } from '../i18n.ts';

/**
 * How long changes may wait, or the device be without its connection, before it counts as a problem: a device syncs
 * within a moment of every save, and connects within a moment of loading the page.
 */
const WAIT_GRACE_MS = 1500;

/**
 * What the profile menu says of the sync, and whether something is wrong: an update needed, or offline or changes
 * waiting past `WAIT_GRACE_MS` (`waitedLong`). Only then does the bar show the cloud; a page just loaded has not
 * connected yet, and is not offline for that (Lars, 2026-11-05). Signed out, the yellow line under the bar says so
 * with its button (Shell.tsx), and the bar and the columns' foot only count the changes that wait (Lars, 2026-11-07:
 * it was said three times at once).
 */
export function syncState(s: DbStatus, waitedLong: boolean): { problem: boolean; text: string } {
  const pending = s.pending === 1 ? t('status.pendingOne') : s.pending > 1 ? t('status.pending', { n: s.pending }) : null;
  if (s.authError !== null) return pending ? { problem: true, text: pending } : { problem: false, text: t('status.authNeeded') };
  const offline = !s.connected && waitedLong;
  const problem = s.updateRequired ? t('status.error') : offline ? t('status.offline') : null;
  // What is wrong, then the changes that wait for it to be put right.
  if (problem) return { problem: true, text: [problem, pending].filter(Boolean).join(' · ') };
  if (pending && waitedLong) return { problem: true, text: pending };
  return { problem: false, text: t(s.syncing || pending || !s.connected ? 'status.syncing' : 'status.idle') };
}

/**
 * Whether `waiting` has held for `WAIT_GRACE_MS`: what waits a moment, as a page connecting after it loads, is not
 * shown as a problem, and so does not flash by.
 */
export function useWaitedLong(waiting: boolean): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLong(true), WAIT_GRACE_MS);
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
