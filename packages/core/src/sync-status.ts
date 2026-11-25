// How the sync stands, in words, and whether it is a problem (ADR 0008; ported back from
// crates/gp-core/src/sync_status.rs; docs/layout-2-0.md, "The start page and the bar"). Changes waiting a moment after
// a save, or a page not yet connected after it loads, are no problem until they have waited `GRACE_MS` (Lars,
// 2026-11-05); and no connection is Offline only once a try to connect has failed (`unreachable`, Lars, 2026-11-25: a
// page that loads slowly flashed it); the shell keeps that timer, the core says when it runs. Signed out, the bar only counts the changes that
// wait, and the notice says to sign in again (Lars, 2026-11-07).

/** How long changes may wait, or the device be without its connection, before it counts as a problem. */
const GRACE_MS = 1_500;

/** A text, by its code: each shell has the words (`status.<code>` in apps/web/src/i18n.ts). */
type SyncText = { code: 'idle' | 'syncing' | 'offline' | 'error' | 'authNeeded' | 'pendingOne' } | { code: 'pending'; n: number };

export interface SyncStatus {
  problem: boolean;
  texts: SyncText[];
  notice: { code: 'updateRequired' | 'notPaired' | 'authRequired'; action: 'pairAgain' | 'signIn' | null } | null;
  waiting: boolean;
  graceMs: number;
}

const pendingText = (n: number): SyncText => (n === 1 ? { code: 'pendingOne' } : { code: 'pending', n });

/**
 * `syncStatusView` {pending, stopped, connected, unreachable, busy, waitedLong}: {problem, texts, notice, waiting, graceMs}. The
 * texts are shown joined by " · "; `waiting` says the grace applies, so the shell asks again with `waitedLong` once
 * it has held for `graceMs`.
 */
export function syncStatusView(args: unknown): SyncStatus {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const pending = typeof a.pending === 'number' && Number.isInteger(a.pending) ? a.pending : 0;
  const stopped = typeof a.stopped === 'string' ? a.stopped : null;
  const connected = a.connected === true;
  const unreachable = a.unreachable === true;
  const busy = a.busy === true;
  const waitedLong = a.waitedLong === true;

  const notice: SyncStatus['notice'] =
    stopped === null
      ? null
      : stopped === 'update-required'
        ? { code: 'updateRequired', action: null }
        : stopped === 'device-not-paired'
          ? { code: 'notPaired', action: 'pairAgain' }
          : { code: 'authRequired', action: 'signIn' };
  const waiting = pending > 0 || !connected;
  const answer = (problem: boolean, texts: SyncText[]): SyncStatus => ({ problem, texts, notice, waiting, graceMs: GRACE_MS });

  const waitingText = pending > 0 ? pendingText(pending) : null;
  if (stopped !== null && stopped !== 'update-required') return waitingText ? answer(true, [waitingText]) : answer(false, [{ code: 'authNeeded' }]);
  const offline = !connected && unreachable && waitedLong;
  const problem: SyncText | null = stopped !== null ? { code: 'error' } : offline ? { code: 'offline' } : null;
  if (problem) return answer(true, waitingText ? [problem, waitingText] : [problem]);
  if (waitingText && waitedLong) return answer(true, [waitingText]);
  return answer(false, [busy || pending > 0 || !connected ? { code: 'syncing' } : { code: 'idle' }]);
}
