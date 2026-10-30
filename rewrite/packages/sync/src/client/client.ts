import {
  CHANGED_TABLES,
  changeTrackingDdl,
  clientSyncDdl,
  clientUndoRestore,
  clientUndoTriggers,
  getMutator,
  runMutator,
  migrateOrgSchema,
  PROTOCOL_VERSION,
  randomId,
  SCHEMA_VERSION,
  SerialQueue,
  tableByName,
  tableInfo,
  upsertSql,
  type Dump,
  type MutationResult,
  type MutatorArgs,
  type MutatorCtx,
  type MutatorName,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type TableInfo,
  type Tx,
} from '@gp/core';
import { drizzleOver, queryObjects, type ClientSqlite } from './sqlite.ts';
import type { Transport } from './transport.ts';

export interface SyncClientOptions {
  transport: Transport;
  /** What this device believes about its user. The server re-checks with its own. */
  ctx: MutatorCtx;
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

/** Most values bound in one statement of a pull: well under SQLite's limit (32 766), and its parsing stays cheap. */
const MAX_PARAMS = 5000;

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
 * mutations touched (`_undo`) so a pull can rebase them.
 */
export class SyncClient {
  readonly db: Tx;
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

  private constructor(
    private sqlite: ClientSqlite,
    private opts: SyncClientOptions,
  ) {
    this.db = drizzleOver(sqlite);
  }

  static async open(sqlite: ClientSqlite, opts: SyncClientOptions): Promise<SyncClient> {
    const c = new SyncClient(sqlite, opts);
    await c.init();
    return c;
  }

  private exec = (sql: string, params: unknown[] = []) => this.sqlite.query(sql, params);

  private async init() {
    await this.exec('PRAGMA foreign_keys = ON');
    await migrateOrgSchema(
      (sql) => queryObjects(this.sqlite, sql),
      async (fn) => {
        await this.exec('BEGIN');
        try {
          await fn();
          await this.exec('COMMIT');
        } catch (e) {
          await this.exec('ROLLBACK');
          throw e;
        }
      },
    );
    for (const s of [...clientSyncDdl, ...clientUndoTriggers(), ...changeTrackingDdl()]) await this.exec(s);
    const id = this.opts.clientId ?? randomId(); // not crypto.randomUUID: missing over plain http on the LAN
    await this.exec('INSERT OR IGNORE INTO _sync_meta (one, client_id) VALUES (1, ?)', [id]);
    this.clientId = String((await this.exec('SELECT client_id FROM _sync_meta')).rows[0]![0]);
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
    });
  }

  /**
   * Runs `fn` in one SQLite transaction on the client connection, serialised
   * with every other write. Also gives the tables the transaction wrote
   * (`changeTrackingDdl`), read and forgotten before it commits.
   */
  private transaction<T>(fn: () => Promise<T>): Promise<{ result: T; tables: ReadonlySet<string> }> {
    return this.lock.run(async () => {
      await this.exec('BEGIN');
      try {
        const result = await fn();
        const tables = new Set((await this.exec(`SELECT tbl FROM ${CHANGED_TABLES}`)).rows.map((r) => String(r[0])));
        if (tables.size) await this.exec(`DELETE FROM ${CHANGED_TABLES}`);
        await this.exec('COMMIT');
        return { result, tables };
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
    const mut = getMutator(name)!;
    const { tables } = await this.transaction(async () => {
      const { next_mutation_id: id } = await this.meta();
      await this.exec('UPDATE _sync_meta SET next_mutation_id = ?', [id + 1]);
      await this.exec('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, ?, ?)', [id, name, mut.v, JSON.stringify(args)]);
      await runMutator(mut, this.db, args, this.opts.ctx);
    });
    this.changed(tables);
  }

  async pending(): Promise<PendingMutation[]> {
    return (await queryObjects(this.sqlite, 'SELECT id, name, v, args FROM _mutation ORDER BY id')) as never;
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
    const last = pages[pages.length - 1]!;
    const { tables } = await this.transaction(async () => {
      await this.exec('PRAGMA defer_foreign_keys = ON');
      await this.exec('UPDATE _sync_meta SET capture = 0');
      for (const s of clientUndoRestore()) await this.exec(s);
      await this.exec('DELETE FROM _undo');

      if (pages[0]!.clear) for (const t of tableInfo.toReversed()) await this.exec(`DELETE FROM ${t.name}`);
      // Puts in a row to one table go in one statement: a statement per row made a first pull of a library take a second.
      let run = null as { t: TableInfo; params: unknown[]; rows: number } | null;
      const flush = async () => {
        if (run) await this.exec(upsertSql(run.t, run.rows), run.params);
        run = null;
      };
      for (const page of pages) {
        for (const op of page.patch) {
          const t = tableByName.get(op.tbl);
          if (!t) continue; // a table this client does not know yet
          if (op.op === 'del') {
            await flush();
            await this.exec(`DELETE FROM ${t.name} WHERE id = ?`, [op.pk]);
            continue;
          }
          if (run?.t !== t || (run.rows + 1) * t.columns.length > MAX_PARAMS) await flush();
          run ??= { t, params: [], rows: 0 };
          for (const c of t.columns) run.params.push(op.row[c] ?? null);
          run.rows++;
        }
        this.rejected.push(...page.results);
      }
      await flush();

      await this.exec('DELETE FROM _mutation WHERE id <= ?', [last.lastMutationId]);
      await this.exec('UPDATE _sync_meta SET cookie = ?, last_mutation_id = ?, capture = 1', [last.cookie, last.lastMutationId]);

      for (const m of await this.pending()) {
        const mut = getMutator(m.name);
        await this.exec('SAVEPOINT replay');
        try {
          if (!mut) throw new Error(`unknown mutator ${m.name}`);
          await runMutator(mut, this.db, JSON.parse(m.args), this.opts.ctx);
          await this.exec('RELEASE replay');
        } catch {
          // It no longer applies locally; it stays queued and the server decides.
          await this.exec('ROLLBACK TO replay');
          await this.exec('RELEASE replay');
        }
      }
    });
    if (pages.some((p) => p.clear || p.patch.length || p.results.length)) this.changed(tables);
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
