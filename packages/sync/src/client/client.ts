import {
  CHANGED_TABLES,
  PROTOCOL_VERSION,
  randomId,
  SCHEMA_VERSION,
  SerialQueue,
  tableByName,
  tableInfo,
  type Dump,
  type MutationResult,
  type MutatorArgs,
  type MutatorCtx,
  type MutatorName,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@gp/core';
import type { RunSql, RustCore } from '@gp/rust-core';
import { queryObjects, type ClientSqlite } from './sqlite.ts';
import type { Transport } from './transport.ts';

export interface SyncClientOptions {
  transport: Transport;
  /** What this device believes about its user. The server re-checks with its own. */
  ctx: MutatorCtx;
  /** The Rust core's WASM: every change runs on it, and it keeps the queue and rebases it (crates/gp-core's sync.rs). */
  core: RustCore;
  clientId?: string;
  /** Overridable so tests can play an old client. */
  protocol?: number;
  /**
   * Runs before each push with the pending queue, to send what a mutation
   * needs on the server first (a Bible text: `BibleTextUploads`). Returns how
   * many mutations, from the front, may go now; undefined is all of them.
   * The rest wait for the next push.
   */
  beforePush?: (pending: PendingMutation[], client: SyncClient) => Promise<number | undefined>;
}

/** A queued mutation as stored: its arguments are JSON. */
export interface PendingMutation {
  id: number;
  name: string;
  v: number;
  args: string;
}

/**
 * A device's view of one organisation: a local SQLite with the synced tables,
 * a pending-mutation queue (`_mutation`), and pre-images of the rows those
 * mutations touched (`_undo`) so a pull can rebase them. The queue, the rebase
 * and the triggers are the Rust core's (`sync…` commands); this is the shell
 * around them: the network, pokes, when to sync, and the server's refusals.
 */
export class SyncClient {
  /** Set when the server answered "update required": the client stops syncing and keeps its queue. */
  updateRequired = false;
  /**
   * Set when the server refused the credentials (signed out elsewhere,
   * removed, or the device unpaired): the client stops syncing and keeps its
   * queue, as with a revoked token (ADR 0006, SYNC-A15). Signing in again
   * opens a new client on the same database.
   */
  authError: 'unauthenticated' | 'not-a-member' | 'device-not-paired' | null = null;
  /** Mutations the server rejected, reported once each. */
  readonly rejected: MutationResult[] = [];
  private lock = new SerialQueue();
  private clientId = '';
  private listeners = new Set<(tables: ReadonlySet<string>) => void>();

  /** The connection's statements, as the Rust core asks for them. */
  private rows: RunSql;

  private constructor(
    private sqlite: ClientSqlite,
    private opts: SyncClientOptions,
  ) {
    this.rows = async (sql, params) => (await sqlite.query(sql, params)).rows;
  }

  static async open(sqlite: ClientSqlite, opts: SyncClientOptions): Promise<SyncClient> {
    const c = new SyncClient(sqlite, opts);
    await c.init();
    return c;
  }

  private exec = (sql: string, params: unknown[] = []) => this.sqlite.query(sql, params);

  private async init() {
    await this.exec('PRAGMA foreign_keys = ON');
    // The schema's migration on the Rust core, in one transaction: a refused database is left as it was.
    await this.exec('BEGIN');
    try {
      await this.opts.core.run('migrateOrgSchema', {}, undefined, this.rows);
      await this.exec('COMMIT');
    } catch (e) {
      await this.exec('ROLLBACK');
      throw e;
    }
    // The queue's tables, the triggers and the record of changed tables; outside a transaction, as PRAGMAs need.
    const id = this.opts.clientId ?? randomId(); // not crypto.randomUUID: missing over plain http on the LAN
    const opened = (await this.core('syncOpen', { clientId: id })) as { clientId: string };
    this.clientId = String(opened.clientId);
  }

  /** A sync command of the Rust core, on this connection, as this device's user. */
  private core(name: string, args: unknown): Promise<unknown> {
    return this.opts.core.run(name, args, this.opts.ctx, this.rows);
  }

  get id() {
    return this.clientId;
  }

  /**
   * Calls `fn` after every local mutation and every pull that changed rows,
   * with the tables the change wrote. Returns an unsubscribe.
   */
  onChange(fn: (tables: ReadonlySet<string>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(tables: ReadonlySet<string>) {
    for (const fn of this.listeners) fn(tables);
  }

  /** Reads the local database. For queries only; writes go through `mutate`. */
  query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.lock.run(() => queryObjects(this.sqlite, sql, params));
  }

  /**
   * What the Rust core's view `name` shows (`RustCore.view`, docs/rust-core.md 2.5 step 3), read from one state of
   * the database: serialised with every write. A refusal is thrown as MutationError with the core's code.
   */
  view<T>(name: string, args: unknown): Promise<T> {
    return this.lock.run(() => this.opts.core.view<T>(name, args, async (sql, params) => (await this.sqlite.query(sql, params)).rows));
  }

  private async meta() {
    const [m] = await queryObjects(this.sqlite, 'SELECT cookie, last_mutation_id, next_mutation_id FROM _sync_meta');
    return m as { cookie: string | null; last_mutation_id: number; next_mutation_id: number };
  }

  /**
   * Writes tables that do not sync (such as stored Bible texts) in one
   * transaction, serialised with every other write. Never a synced table:
   * those change only through `mutate` and pulls.
   */
  async localWrite(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    for (const { sql } of statements) {
      const table = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|DELETE\s+FROM|UPDATE)\s+([a-z_]+)/i.exec(sql)?.[1];
      if (!table || tableByName.has(table) || table.startsWith('_')) throw new Error(`localWrite: not a local table: ${sql.slice(0, 60)}`);
    }
    await this.transaction(async () => {
      for (const s of statements) await this.exec(s.sql, s.params ?? []);
      await this.exec(`DELETE FROM ${CHANGED_TABLES}`); // not a change pages hear of
    });
  }

  /**
   * Runs `fn` in one SQLite transaction on the client connection, serialised
   * with every other write; rolled back when it throws, or when the commit fails
   * (a foreign key a rebase left broken).
   */
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      await this.exec('BEGIN');
      try {
        const result = await fn();
        await this.exec('COMMIT');
        return result;
      } catch (e) {
        await this.exec('ROLLBACK');
        throw e;
      }
    });
  }

  /**
   * Runs a mutation optimistically and queues it for the server. If the
   * mutator throws here, nothing is written and nothing is queued.
   */
  async mutate<N extends MutatorName>(name: N, args: MutatorArgs<N>): Promise<void> {
    const { tables } = (await this.transaction(() => this.core('syncMutate', { mutator: name, args: JSON.stringify(args) }))) as { tables: string[] };
    this.changed(new Set(tables));
  }

  async pending(): Promise<PendingMutation[]> {
    return (await this.core('syncPending', {})) as PendingMutation[];
  }

  /**
   * Sends the pending queue, or the front of it that `beforePush` allows. A
   * network failure leaves it untouched; the server confirms through the next pull.
   */
  async push(): Promise<void> {
    if (this.stopped) return;
    let pending = await this.pending();
    if (pending.length && this.opts.beforePush) pending = pending.slice(0, (await this.opts.beforePush(pending, this)) ?? pending.length);
    if (!pending.length) return;
    const req: PushRequest = {
      protocol: this.opts.protocol ?? PROTOCOL_VERSION,
      schemaVersion: SCHEMA_VERSION,
      clientId: this.clientId,
      mutations: pending.map((m) => ({ id: m.id, name: m.name, v: m.v, args: JSON.parse(m.args) })),
    };
    const res = await this.opts.transport.post<PushResponse>('/api/sync/push', req);
    if (this.isRefused(res)) return;
    if (res.status !== 200) throw new Error(`push failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  /** Fetches every page of changes, then rebases the pending queue onto them in one transaction. */
  async pull(): Promise<void> {
    if (this.stopped) return;
    const meta = await this.meta();
    const pages: PullResponse[] = [];
    let cookie = meta.cookie;
    for (;;) {
      const req: PullRequest = {
        protocol: this.opts.protocol ?? PROTOCOL_VERSION,
        schemaVersion: SCHEMA_VERSION,
        clientId: this.clientId,
        cookie,
        lastMutationId: meta.last_mutation_id,
      };
      const res = await this.opts.transport.post<PullResponse>('/api/sync/pull', req);
      if (this.isRefused(res)) return;
      if (res.status !== 200) throw new Error(`pull failed: ${res.status} ${JSON.stringify(res.body)}`);
      pages.push(res.body);
      cookie = res.body.cookie;
      if (!res.body.more) break;
    }
    await this.rebase(pages);
  }

  async sync(): Promise<void> {
    await this.push();
    await this.pull();
  }

  /** Whether syncing has stopped until the app is updated or signed in again. */
  get stopped(): boolean {
    return this.updateRequired || this.authError !== null;
  }

  /** An answer that stops syncing: "update required", or credentials the server no longer accepts. */
  private isRefused(res: { status: number; body: unknown }) {
    const error = (res.body as { error?: string } | null)?.error;
    if (res.status === 426 && error === 'update-required') {
      this.updateRequired = true;
      return true;
    }
    if ((res.status === 401 || res.status === 403) && (error === 'unauthenticated' || error === 'not-a-member' || error === 'device-not-paired')) {
      this.authError = error;
      this.socket?.close();
      return true;
    }
    return false;
  }

  /**
   * Undo every optimistic write, apply the server's changes, drop the
   * mutations the server has consumed, and replay the rest. One transaction.
   */
  private async rebase(pages: PullResponse[]) {
    const answer = await this.transaction(async () => {
      const a = (await this.core('syncRebase', { pages })) as { tables: string[]; results: MutationResult[]; changed: boolean };
      this.rejected.push(...a.results);
      return a;
    });
    if (answer.changed) this.changed(new Set(answer.tables));
  }

  /** Every synced table, sorted by id: the same shape as the server's debug dump. */
  async dump(): Promise<Dump> {
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const t of tableInfo) out[t.name] = await queryObjects(this.sqlite, `SELECT * FROM ${t.name} ORDER BY id`);
    return out as Dump;
  }

  // ------------------------------------------------------------ pokes

  private socket: WebSocket | undefined;
  private syncing: Promise<void> | undefined;
  private again = false;

  /**
   * Pulls whenever the server pokes. Sync runs are coalesced: at most one
   * running and one queued. `onClose` runs once if an open socket closes.
   */
  listen(pokeUrl: string, opts: { onClose?: () => void; protocols?: string[] } = {}): Promise<void> {
    const url = new URL(pokeUrl);
    url.searchParams.set('clientId', this.clientId);
    const ws = new WebSocket(url, opts.protocols);
    this.socket = ws;
    ws.addEventListener('message', () => void this.requestSync());
    ws.addEventListener('open', () => ws.addEventListener('close', () => opts.onClose?.(), { once: true }), { once: true });
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (e) => reject(e), { once: true });
    });
  }

  requestSync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.again = false;
          await this.sync().catch(() => undefined); // offline: the next poke or poll retries
        } while (this.again);
      } finally {
        this.syncing = undefined;
        this.busyChanged();
      }
    })();
    this.busyChanged();
    return this.syncing;
  }

  private busyListeners = new Set<() => void>();

  /** A sync run (`requestSync`) is under way, queued ones included. */
  get busy(): boolean {
    return this.syncing !== undefined;
  }

  /** Calls `fn` when a sync run starts and when it ends (`busy`). Returns an unsubscribe. */
  onBusy(fn: () => void): () => void {
    this.busyListeners.add(fn);
    return () => this.busyListeners.delete(fn);
  }

  private busyChanged() {
    for (const fn of this.busyListeners) fn();
  }

  async close() {
    this.socket?.close();
    await this.syncing;
    await this.sqlite.close();
  }
}
