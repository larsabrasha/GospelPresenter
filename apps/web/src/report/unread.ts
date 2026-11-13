import { useSyncExternalStore } from 'react';
import { api } from '../auth/api.ts';

// How many answers to the user's own bug reports wait unread (docs/bug-reports.md), for the dot on the picture and
// Mina felrapporter. Asked of the server when the app starts, when it comes back into view, and after a thread is
// read: one small question, never on a timer. Offline it stays as it was.

let unread = 0;
const listeners = new Set<() => void>();

/** Asks the server again, and tells whoever shows the count. */
export async function refreshUnread(): Promise<void> {
  try {
    const r = await api<{ unread: number }>('GET', '/api/my-reports/unread');
    if (r.error || r.body.unread === unread) return;
    unread = r.body.unread;
    for (const fn of listeners) fn();
  } catch {
    // Offline: the count waits for the next time the app comes into view.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The count, kept up to date. */
export function useUnreadReplies(): number {
  return useSyncExternalStore(subscribe, () => unread);
}
