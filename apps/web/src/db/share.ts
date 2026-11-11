import type { Session } from './protocol.ts';

// The windows of one machine share one database: the operator window's worker
// owns it, and windows without a database of their own (the output) read
// through it over a BroadcastChannel. This works the same whether the owner
// keeps the file on OPFS or, without OPFS, in memory, where no other window
// could open it.

/** What every window that reads a database needs. `Db` has it; so does `SharedReader`. */
export interface ReadDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Calls `fn` whenever the database changed, with the tables the change
   * wrote, or none when that is not known (then anything may have changed).
   * Returns an unsubscribe.
   */
  onChange(fn: (tables?: ReadonlySet<string>) => void): () => void;
  /**
   * A media blob this database does not hold, from where it is kept instead:
   * the server, for a desktop host's own window; null elsewhere (`blobUrl`).
   */
  fetchMedia(hash: string): Promise<MediaBytes | null>;
}

export interface MediaBytes {
  contentType: string;
  bytes: Uint8Array;
}

export type ShareMessage =
  | { type: 'changed'; tables?: string[] }
  | { type: 'query'; id: string; sql: string; params: unknown[] }
  | { type: 'media'; id: string; hash: string }
  | { type: 'result'; id: string; ok: true; rows: Record<string, unknown>[] }
  | { type: 'result'; id: string; ok: false; error: string };

/**
 * Whether a load that reads `reads` (every table it reads, or undefined for
 * unknown) must run again after a change that wrote `changed` (undefined
 * when the change does not say).
 */
export function needsReload(reads: readonly string[] | undefined, changed: ReadonlySet<string> | undefined): boolean {
  return !reads || !changed || reads.some((t) => changed.has(t));
}

/** One file per account and organisation (D3). */
export function dbFileName(s: Pick<Session, 'userId' | 'orgId'>): string {
  return `gp-${encodeURIComponent(s.userId)}-${encodeURIComponent(s.orgId)}.db`;
}

export function shareChannelName(s: Pick<Session, 'userId' | 'orgId'>): string {
  return `gp-db:${dbFileName(s)}`;
}

/**
 * Owner side: answers reads from other windows and reports changes from them.
 * Returns `changed`, to call after every change of the database, with the
 * tables it wrote when they are known.
 */
export function serveReads(
  channel: BroadcastChannel,
  query: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  onOtherChanged: (tables?: string[]) => void,
  media: (hash: string) => Promise<MediaBytes | null> = async () => null,
): { changed: (tables?: Iterable<string>) => void } {
  channel.addEventListener('message', (e: MessageEvent<ShareMessage>) => {
    const m = e.data;
    if (m.type === 'changed') onOtherChanged(m.tables);
    else if (m.type === 'query' || m.type === 'media') {
      // A blob comes back as one row, or none.
      const answer = m.type === 'query' ? query(m.sql, m.params) : media(m.hash).then((b) => (b ? [{ ...b }] : []));
      answer.then(
        (rows) => channel.postMessage({ type: 'result', id: m.id, ok: true, rows } satisfies ShareMessage),
        (err: unknown) =>
          channel.postMessage({ type: 'result', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ShareMessage),
      );
    }
  });
  return { changed: (tables) => channel.postMessage({ type: 'changed', ...(tables ? { tables: [...tables] } : {}) } satisfies ShareMessage) };
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
  private listeners = new Set<(tables?: ReadonlySet<string>) => void>();
  private next = 1;
  private readonly prefix = Math.random().toString(36).slice(2);

  constructor(
    channelName: string,
    private retryMs = 1000,
  ) {
    this.channel = new BroadcastChannel(channelName);
    this.channel.addEventListener('message', (e: MessageEvent<ShareMessage>) => {
      const m = e.data;
      if (m.type === 'changed') {
        const tables = m.tables && new Set(m.tables);
        for (const fn of this.listeners) fn(tables);
      } else if (m.type === 'result') {
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
    return this.ask({ type: 'query', id: `${this.prefix}-${this.next++}`, sql, params });
  }

  async fetchMedia(hash: string): Promise<MediaBytes | null> {
    const [b] = await this.ask<MediaBytes>({ type: 'media', id: `${this.prefix}-${this.next++}`, hash });
    return b ?? null;
  }

  private ask<T>(msg: Extract<ShareMessage, { type: 'query' | 'media' }>): Promise<T[]> {
    const id = msg.id;
    return new Promise<T[]>((resolve, reject) => {
      const timer = setInterval(() => this.channel.postMessage(msg), this.retryMs);
      this.waiting.set(id, { resolve: resolve as (rows: never[]) => void, reject, timer });
      this.channel.postMessage(msg);
    });
  }

  onChange(fn: (tables?: ReadonlySet<string>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    for (const w of this.waiting.values()) clearInterval(w.timer);
    this.waiting.clear();
    this.channel.close();
  }
}
