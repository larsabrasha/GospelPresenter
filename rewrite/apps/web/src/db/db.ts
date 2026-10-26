import type { MutatorArgs, MutatorName } from '@gp/core';
import type { DbCall, DbMessage, DbStatus, Session } from './protocol.ts';
import type { ReadDb } from './share.ts';

/** The page's handle on its database worker, which owns the database and syncs it. */
export class Db implements ReadDb {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private next = 1;
  private changeListeners = new Set<() => void>();
  private statusListeners = new Set<(s: DbStatus) => void>();

  constructor() {
    this.worker.addEventListener('message', (e: MessageEvent<DbMessage>) => {
      const m = e.data;
      if (m.type === 'changed') for (const fn of this.changeListeners) fn();
      else if (m.type === 'status') for (const fn of this.statusListeners) fn(m.status);
      else {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.ok) w?.resolve(m.value);
        else w?.reject(new Error(m.error));
      }
    });
  }

  private call<T>(c: DbCall): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, call: c });
    });
  }

  /** Opens the session's database and starts syncing it. */
  open(session: Session): Promise<string> {
    return this.call({ op: 'open', session });
  }

  mutate<N extends MutatorName>(name: N, args: MutatorArgs<N>): Promise<void> {
    return this.call({ op: 'mutate', name, args });
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.call({ op: 'query', sql, params });
  }

  status(): Promise<DbStatus> {
    return this.call({ op: 'status' });
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onStatus(fn: (s: DbStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
}
