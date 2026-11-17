// The Rust core (crates/gp-core) under the app: its WASM runs every mutator and the organisation schema's migration, on
// the client and on the server alike, so a mutator is never the Rust core's on one end and the TS core's on the other
// (docs/rust-core.md, 2.5). The core never opens a database: it asks for each SQL statement and waits for the rows
// (bridge.rs). The TS core's mutators stay in packages/core, the reference the core's checks compare with.
import { getMutator, MutationError, runMutator, SerialQueue, type MutatorCtx, type Tx } from '@gp/core';

/** The mutators that stay on the TS core: the test helper `probe`, which the Rust core does not have. */
const TS_MUTATORS: ReadonlySet<string> = new Set(['probeWriteThenThrow']);

/** A statement's rows as arrays, in column order. */
export type Rows = unknown[][];
/** Runs one statement in the caller's transaction: synchronous on the server's drivers, async on wa-sqlite. */
export type RunSql = (sql: string, params: unknown[]) => Rows | Promise<Rows>;
/** The same, synchronous: the server opening a database (a Durable Object's `transactionSync`, node's drivers). */
type RunSqlSync = (sql: string, params: unknown[]) => Rows;

/** What the core asks the shell to run. */
interface Ask {
  sql: string;
  params: unknown[];
}

interface CoreExports {
  memory: WebAssembly.Memory;
  gp_alloc(len: number): number;
  gp_start(ptr: number, len: number): number;
  gp_resume(ptr: number, len: number): number;
  gp_out_ptr(): number;
  gp_out_len(): number;
}

/** gp_start's and gp_resume's answers: done, refused (the code said), or a statement to run. */
const DONE = 0;
const WANTS_SQL = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// SQLite's integers past 2^53 come as bigint from some drivers; JSON has no bigint.
const json = (value: unknown) => JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? Number(v) : v));

/**
 * One instance of the core's WASM, made at its first call (a server's store that only pulls never needs one). Its
 * calls run one at a time: the core keeps one call's state while it waits for rows.
 */
export class RustCore {
  private instance: CoreExports | undefined;
  private queue = new SerialQueue();
  /** A call is under way, whose statements are being answered. */
  private busy = false;

  constructor(private module: WebAssembly.Module) {}

  private get core(): CoreExports {
    this.instance ??= new WebAssembly.Instance(this.module, { env: { now_ms: () => Date.now() } }).exports as unknown as CoreExports;
    return this.instance;
  }

  private pass(text: string): [number, number] {
    const bytes = encoder.encode(text);
    const at = this.core.gp_alloc(bytes.length);
    new Uint8Array(this.core.memory.buffer, at, bytes.length).set(bytes);
    return [at, bytes.length];
  }

  private said(): string {
    return decoder.decode(new Uint8Array(this.core.memory.buffer, this.core.gp_out_ptr(), this.core.gp_out_len()));
  }

  /**
   * One call of the core: yields each statement it asks for and takes its rows, or `{ error }` for one the shell's
   * SQLite refused; ends with the core's answer (JSON text, empty for none: a view's JSON, a sync command's answer),
   * or throws the refusal.
   */
  private *call(name: string, args: unknown, ctx: MutatorCtx | undefined): Generator<Ask, string, Rows | { error: string }> {
    try {
      const who = ctx && { userId: ctx.userId, role: ctx.role, now: ctx.now };
      let status = this.core.gp_start(...this.pass(json({ name, args, ctx: who ?? {} })));
      while (status === WANTS_SQL) {
        const rows = yield JSON.parse(this.said()) as Ask;
        status = this.core.gp_resume(...this.pass(json(rows)));
      }
      if (status !== DONE) throw new MutationError(this.said());
      return this.said();
    } catch (e) {
      // A trap (a panic in the core) leaves the instance unusable: the next call gets a fresh one.
      if (e instanceof WebAssembly.RuntimeError) this.instance = undefined;
      throw e;
    }
  }

  /**
   * Runs the command `name` (a mutator, the schema's `migrateOrgSchema` and `seedLabels`, sync's `sync…`) to its end
   * in the caller's transaction, every statement through `sql`. Its answer (sync's commands have one), or a refusal
   * thrown as MutationError with the core's code, as runMutator throws one (invalid arguments included). A statement
   * `sql` throws for is told to the core, which runs nothing more and is refused (the error is thrown as it was), or,
   * replaying a sync queue, rolls that change back and goes on.
   */
  async run(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql): Promise<unknown> {
    const said = await this.drive(name, args, ctx, sql);
    return said ? (JSON.parse(said) as unknown) : undefined;
  }

  /**
   * What the view `name` shows (docs/rust-core.md, 2.5 step 3), every statement through `sql`: one state of the
   * database when the caller holds its lock. A refusal is thrown as MutationError with the core's code.
   */
  async view<T>(name: string, args: unknown, sql: RunSql): Promise<T> {
    return JSON.parse((await this.drive(name, args, undefined, sql)) || 'null') as T;
  }

  /** A call to its end, its statements answered by `sql` as they come, one call at a time: what it said. */
  private drive(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql): Promise<string> {
    return this.queue.run(async () => {
      this.busy = true;
      let failed: unknown;
      try {
        const steps = this.call(name, args, ctx);
        let step = steps.next();
        while (!step.done) {
          let rows: Rows | { error: string };
          try {
            rows = await sql(step.value.sql, step.value.params);
          } catch (e) {
            failed ??= e;
            rows = { error: e instanceof Error ? e.message : String(e) };
          }
          step = steps.next(rows);
        }
        return step.value;
      } catch (e) {
        throw failed !== undefined && e instanceof MutationError && e.code.startsWith('sql-error') ? failed : e;
      } finally {
        this.busy = false;
      }
    });
  }

  /**
   * A view that reads no database (presenting's keys and marks), at once: a page calls it on its own thread, so a key
   * reaches the outputs without a round trip to the worker. Throws if the view asks for SQL, or refuses; and while
   * another call is under way, whose state it would overwrite.
   */
  pure<T>(name: string, args: unknown): T {
    if (this.busy) throw new Error(`the Rust core is in the middle of another call: ${name} must wait`);
    const step = this.call(name, args, undefined).next();
    if (!step.done) throw new Error(`${name} reads the database: call view() instead`);
    return JSON.parse(step.value || 'null') as T;
  }

  /** The same, all at once, for statements answered synchronously: where the server opens a database. */
  runSync(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSqlSync): void {
    if (this.busy) throw new Error(`the Rust core is in the middle of another call: ${name} must wait`);
    this.busy = true;
    try {
      const steps = this.call(name, args, ctx);
      for (let step = steps.next(); !step.done; ) step = steps.next(sql(step.value.sql, step.value.params));
    } finally {
      this.busy = false;
    }
  }
}

/** Where a mutator runs: Drizzle for the TS core, statements for the Rust core, both in one transaction. */
export interface MutationDb {
  db: Tx;
  core: RustCore;
  rows: RunSql;
}

/**
 * Runs a mutator as runMutator does, on the Rust core (the TS core's only for TS_MUTATORS): done, or a MutationError
 * with the refusal's code. A name neither core knows is refused as `unknown-mutator`.
 */
export function runMutation(on: MutationDb, name: string, args: unknown, ctx: MutatorCtx): Promise<void> {
  if (!TS_MUTATORS.has(name)) return on.core.run(name, args, ctx, on.rows).then(() => undefined);
  return runMutator(getMutator(name)!, on.db, args, ctx);
}
