import {
  CHANGED_TABLES,
  randomId,
  SerialQueue,
  tableByName,
  tableInfo,
  type Dump,
  type MutationResult,
  type MutatorArgs,
  type MutatorCtx,
  type MutatorName,
  type PullResponse,
} from '@gp/core';
import type { RunSql, RustCore } from '@gp/rust-core';
import { queryObjects, type ClientSqlite } from './sqlite.ts';
import type { Transport } from './transport.ts';

export interface SyncClientOptions {
  transport: Transport;
  /** What this device believes about its user. The server re-checks with its own. */
  ctx: MutatorCtx;
  /** The Rust core's WASM: every change runs on it, and it keeps the queue, rebases it and decides when to sync. */
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
  /** After the sync on a connection and on each poll: fetch what a failed download left out (Bible texts, media). */
  onMedia?: () => void;
}

/** A queued mutation as stored: its arguments are JSON. */
export interface PendingMutation {
  id: number;
  name: string;
  v: number;
  args: string;
}

/** The poke socket's address and the subprotocols that carry the credentials (`socketProtocols`). */
interface PokeSocket {
  url: string;
  protocols?: string[];
}

/** The core's sync driver's state (crates/gp-core/src/sync_driver.rs): given back with each event; these fields are read. */
interface DriverState {
  connected: boolean;
  busy: boolean;
  stopped: string | null;
}

/** What the core's sync driver tells the shell to do, in order. */
type Effect =
  | { type: 'queued'; run: number }
  | { type: 'beforePush' }
  | { type: 'post'; path: string; body: string }
  | { type: 'keepPage' }
  | { type: 'rebase' }
  | { type: 'ended'; run: number; error: string | null }
  | { type: 'idle' }
  | { type: 'media' }
  | { type: 'openSocket' }
  | { type: 'closeSocket' }
  | { type: 'timer'; name: string; ms: number }
  | { type: 'cancelTimers' };

/** What a caller of `send` waits for: nothing, the end of the run its sync event starts, or the device idle. */
type Wait = 'none' | 'run' | 'idle';

const AUTH_ERRORS = ['unauthenticated', 'not-a-member', 'device-not-paired'] as const;

/**
 * What the driver reads of an answer (sync_wire.rs `read`): a refusal's `error`, and a page's `cookie` and `more`. Not
 * the page itself, which may be megabytes, kept here for the rebase.
 */
function answerHead(body: unknown) {
  const b = (body ?? {}) as { error?: unknown; cookie?: unknown; more?: unknown };
  return { error: b.error, cookie: b.cookie, more: b.more };
}

/**
 * A device's view of one organisation: a local SQLite with the synced tables,
 * a pending-mutation queue (`_mutation`), and pre-images of the rows those
 * mutations touched (`_undo`) so a pull can rebase them. The queue, the rebase,
 * the requests, the reading of the server's answers and when to sync are the
 * Rust core's (`sync…` commands and `syncStepView`); this is the shell that
 * does what it says: the network, the poke socket and the timers.
 */
export class SyncClient {
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
    // Before the transaction: SQLite ignores this PRAGMA inside one.
    await this.exec('PRAGMA foreign_keys = ON');
    // The schema's migration, then the queue's tables, the triggers and the record of changed tables, on the Rust
    // core, in one transaction: a refused database is left as it was, and the ~190 statements that remake the
    // triggers on every open are one write to the file, not one each (one each took seconds on OPFS under load).
    const id = this.opts.clientId ?? randomId(); // not crypto.randomUUID: missing over plain http on the LAN
    await this.exec('BEGIN');
    try {
      await this.opts.core.run('migrateOrgSchema', {}, undefined, this.rows);
      const opened = (await this.core('syncOpen', { clientId: id })) as { clientId: string };
      await this.exec('COMMIT');
      this.clientId = String(opened.clientId);
    } catch (e) {
      await this.exec('ROLLBACK');
      throw e;
    }
    const init = { hooks: !!this.opts.beforePush, ...(this.opts.protocol === undefined ? {} : { protocol: this.opts.protocol }) };
    this.state = (await this.opts.core.view<{ state: DriverState }>('syncStepView', { init }, this.rows)).state;
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
    return this.lock.run(() => this.opts.core.view<T>(name, args, this.rows));
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

  /** The queue as committed: read under the lock, so a change in a transaction that may roll back is not in it. */
  pending(): Promise<PendingMutation[]> {
    return this.lock.run(async () => (await this.core('syncPending', {})) as PendingMutation[]);
  }

  /** Sends the pending queue, or the front of it that `beforePush` allows. Rejects with a failed request's error. */
  push(): Promise<void> {
    return this.send({ type: 'sync', push: true, pull: false }, { asked: true, wait: 'run' });
  }

  /** Fetches every page of changes, then rebases the pending queue onto them in one transaction. */
  pull(): Promise<void> {
    return this.send({ type: 'sync', push: false, pull: true }, { asked: true, wait: 'run' });
  }

  sync(): Promise<void> {
    return this.send({ type: 'sync' }, { asked: true, wait: 'run' });
  }

  /** A sync, coalesced with the one running: resolves when the device is idle again; never rejects (offline: the next poke or poll tries again). */
  requestSync(): Promise<void> {
    return this.send({ type: 'sync' }, { asked: true, wait: 'idle' });
  }

  /** Keeps the poke socket open and syncs on every poke, on every (re)connection and on the backstop poll (SYNC-R43). */
  start(poke: PokeSocket): Promise<void> {
    this.poke = poke;
    return this.send({ type: 'start' });
  }

  /** Whether the poke socket is open. */
  get connected(): boolean {
    return this.state.connected;
  }

  /** Set when the server answered "update required": the client stops syncing and keeps its queue. */
  get updateRequired(): boolean {
    return this.state.stopped === 'update-required';
  }

  /**
   * Set when the server refused the credentials (signed out elsewhere,
   * removed, or the device unpaired): the client stops syncing and keeps its
   * queue, as with a revoked token (ADR 0006, SYNC-A15). Signing in again
   * opens a new client on the same database.
   */
  get authError(): (typeof AUTH_ERRORS)[number] | null {
    return AUTH_ERRORS.find((e) => e === this.state.stopped) ?? null;
  }

  /** A sync run is under way or asked for, the ones queued behind it included. */
  get busy(): boolean {
    return this.state.busy || this.asked > 0;
  }

  /** Calls `fn` when `busy`, `connected` or the stop changes. Returns an unsubscribe. */
  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
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

  async close() {
    await this.send({ type: 'close' }, { wait: 'idle' });
    await this.sqlite.close();
  }

  // ------------------------------------------------------------ the core's sync driver

  private state: DriverState = { connected: false, busy: false, stopped: null };
  private events = new SerialQueue();
  /** Sync events sent and not yet worked out: `busy` from the moment one is asked for. */
  private asked = 0;
  private statusListeners = new Set<() => void>();
  private pages: unknown[] = [];
  private runWaiters = new Map<number, { resolve: () => void; reject: (e: unknown) => void }[]>();
  /** The error a request or an upload threw, by run, so the caller gets it as it was. */
  private runErrors = new Map<number, unknown>();
  private idleWaiters: (() => void)[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private poke: PokeSocket | undefined;
  private socket: WebSocket | undefined;
  private run = 0;

  private status() {
    return `${this.busy} ${this.state.connected} ${this.state.stopped}`;
  }

  private statusChanged(before: string) {
    if (this.status() !== before) for (const fn of this.statusListeners) fn();
  }

  /**
   * Gives the core an event with the state it last gave, and does what it answers, in order; one event at a time.
   * `page` is the body of the answer the event carries, kept when the core says so.
   */
  private send(event: object, o: { page?: unknown; asked?: boolean; wait?: Wait } = {}): Promise<void> {
    const asking = this.status();
    if (o.asked) this.asked++;
    this.statusChanged(asking);
    return new Promise<void>((resolve, reject) => {
      void this.events.run(async () => {
        const before = this.status();
        let step: { state: DriverState & { run: number }; effects: Effect[] };
        try {
          // Under the lock: a push is built from what is committed, never from a change a transaction may roll back.
          step = await this.lock.run(() => this.opts.core.view<typeof step>('syncStepView', { state: this.state, event }, this.rows));
        } catch (e) {
          // The core could not take the event: the state stays, the ask is no longer pending, and only a caller
          // waiting for its run's outcome hears of it (requestSync never rejects).
          if (o.asked) this.asked--;
          this.statusChanged(before);
          if (o.wait === 'run') reject(e);
          else resolve();
          return;
        }
        this.state = step.state;
        this.run = step.state.run;
        if (o.asked) this.asked--;
        if (o.wait === 'run') {
          const run = step.effects.find((e) => e.type === 'queued')?.run ?? this.run;
          this.runWaiters.set(run, [...(this.runWaiters.get(run) ?? []), { resolve, reject }]);
        } else if (o.wait === 'idle' && this.state.busy) this.idleWaiters.push(resolve);
        else resolve();
        for (const e of step.effects) this.perform(e, o.page);
        this.statusChanged(before);
      });
    });
  }

  /** A request or an upload of the current run failed: the core hears of it, the caller gets the error. */
  private failed(run: number, e: unknown) {
    this.runErrors.set(run, e);
    void this.send({ type: 'failed', error: e instanceof Error ? e.message : String(e) });
  }

  private perform(e: Effect, page: unknown) {
    const run = this.run;
    switch (e.type) {
      case 'beforePush':
        void (async () => {
          // As many as the uploads saw and let go, never more: a change queued meanwhile waits for the next push, as
          // what it names was not uploaded (its add would be refused, media-missing). Of committed changes (pending()
          // reads under the lock): one a transaction rolls back gives its id to the next.
          const pending = this.opts.beforePush ? await this.pending() : [];
          const limit = pending.length ? ((await this.opts.beforePush!(pending, this)) ?? pending.length) : 0;
          await this.send({ type: 'pushLimit', limit });
        })().catch((err: unknown) => this.failed(run, err));
        return;
      case 'post':
        void (async () => {
          const res = await this.opts.transport.post<unknown>(e.path, JSON.parse(e.body));
          await this.send({ type: 'answer', status: res.status, body: answerHead(res.body) }, { page: res.body });
        })().catch((err: unknown) => this.failed(run, err));
        return;
      case 'keepPage':
        this.pages.push(page);
        return;
      case 'rebase': {
        const pages = this.pages as PullResponse[];
        this.pages = [];
        void this.rebase(pages)
          .then(() => this.send({ type: 'rebased' }))
          .catch((err: unknown) => this.failed(run, err));
        return;
      }
      case 'ended': {
        this.pages = [];
        const error = this.runErrors.get(e.run) ?? (e.error === null ? undefined : new Error(e.error));
        this.runErrors.delete(e.run);
        for (const w of this.runWaiters.get(e.run) ?? []) {
          if (error === undefined) w.resolve();
          else w.reject(error);
        }
        this.runWaiters.delete(e.run);
        return;
      }
      case 'idle':
        for (const w of this.idleWaiters.splice(0)) w();
        return;
      case 'media':
        this.opts.onMedia?.();
        return;
      case 'openSocket':
        return this.openSocket();
      case 'closeSocket': {
        const ws = this.socket;
        this.socket = undefined;
        ws?.close();
        return;
      }
      case 'timer':
        clearTimeout(this.timers.get(e.name));
        this.timers.set(
          e.name,
          setTimeout(() => {
            this.timers.delete(e.name);
            void this.send({ type: 'timer', name: e.name });
          }, e.ms),
        );
        return;
      case 'cancelTimers':
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
        return;
      case 'queued':
        return;
    }
  }

  /** The poke socket: its opening, each poke and its closing (a refused one too) told to the core. */
  private openSocket() {
    if (!this.poke) return;
    let ws: WebSocket;
    try {
      const url = new URL(this.poke.url);
      url.searchParams.set('clientId', this.clientId);
      ws = new WebSocket(url, this.poke.protocols);
    } catch {
      void this.send({ type: 'socketClosed' });
      return;
    }
    this.socket = ws;
    const mine = () => this.socket === ws;
    ws.addEventListener('open', () => {
      if (mine()) void this.send({ type: 'socketOpened' });
    });
    ws.addEventListener('message', () => {
      if (mine()) void this.send({ type: 'poke' });
    });
    ws.addEventListener('close', () => {
      if (!mine()) return;
      this.socket = undefined;
      void this.send({ type: 'socketClosed' });
    });
  }
}
