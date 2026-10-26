import type { Session } from './protocol.ts';

// The windows of one machine share one database: the operator window's worker
// owns it, and windows without a database of their own (the output) read
// through it over a BroadcastChannel. This works the same whether the owner
// keeps the file on OPFS or, without OPFS, in memory, where no other window
// could open it.

/** What every window that reads a database needs. `Db` has it; so does `SharedReader`. */
export interface ReadDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Calls `fn` whenever the database changed. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
}

export type ShareMessage =
  | { type: 'changed' }
  | { type: 'query'; id: string; sql: string; params: unknown[] }
  | { type: 'result'; id: string; ok: true; rows: Record<string, unknown>[] }
  | { type: 'result'; id: string; ok: false; error: string };

/** One file per account and organisation (D3). */
export function dbFileName(s: Pick<Session, 'userId' | 'orgId'>): string {
  return `gp-${encodeURIComponent(s.userId)}-${encodeURIComponent(s.orgId)}.db`;
}

export function shareChannelName(s: Pick<Session, 'userId' | 'orgId'>): string {
  return `gp-db:${dbFileName(s)}`;
}

/**
 * Owner side: answers reads from other windows and reports changes from them.
 * Returns `changed`, to call after every change of the database.
 */
export function serveReads(
  channel: BroadcastChannel,
  query: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  onOtherChanged: () => void,
): { changed: () => void } {
  channel.addEventListener('message', (e: MessageEvent<ShareMessage>) => {
    const m = e.data;
    if (m.type === 'changed') onOtherChanged();
    else if (m.type === 'query') {
      query(m.sql, m.params).then(
        (rows) => channel.postMessage({ type: 'result', id: m.id, ok: true, rows } satisfies ShareMessage),
        (err: unknown) =>
          channel.postMessage({ type: 'result', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ShareMessage),
      );
    }
  });
  return { changed: () => channel.postMessage({ type: 'changed' } satisfies ShareMessage) };
}

/**
 * Reader side: a read-only database that lives in another window. A read
 * waits until an owner answers, and is asked again every `retryMs`, so an
 * owner that reloads or opens late still answers. The first answer wins;
 * every owner of the same file holds the same rows.
 */
export class SharedReader implements ReadDb {
  private channel: BroadcastChannel;
  private waiting = new Map<string, { resolve: (rows: never[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setInterval> }>();
  private listeners = new Set<() => void>();
  private next = 1;
  private readonly prefix = Math.random().toString(36).slice(2);

  constructor(
    channelName: string,
    private retryMs = 1000,
  ) {
    this.channel = new BroadcastChannel(channelName);
    this.channel.addEventListener('message', (e: MessageEvent<ShareMessage>) => {
      const m = e.data;
      if (m.type === 'changed') for (const fn of this.listeners) fn();
      else if (m.type === 'result') {
        const w = this.waiting.get(m.id);
        if (!w) return; // another reader's, or a second owner's late answer
        this.waiting.delete(m.id);
        clearInterval(w.timer);
        if (m.ok) w.resolve(m.rows as never[]);
        else w.reject(new Error(m.error));
      }
    });
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const id = `${this.prefix}-${this.next++}`;
    const msg: ShareMessage = { type: 'query', id, sql, params };
    return new Promise<T[]>((resolve, reject) => {
      const timer = setInterval(() => this.channel.postMessage(msg), this.retryMs);
      this.waiting.set(id, { resolve: resolve as (rows: never[]) => void, reject, timer });
      this.channel.postMessage(msg);
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    for (const w of this.waiting.values()) clearInterval(w.timer);
    this.waiting.clear();
    this.channel.close();
  }
}
