// The Rust core (crates/gp-core) under the app: its WASM runs every mutator and the organisation schema's migration, on
// the client and on the server alike, so a mutator is never the Rust core's on one end and the TS core's on the other
// (docs/rust-core.md, 2.5). The core never opens a database: it asks for each SQL statement and waits for the rows
// (bridge.rs). The TS core it replaced is the reference its checks compare with, at 238d481b (docs/rust-core.md).
import { MutationError, SerialQueue, type MutatorCtx } from '@gp/core';
import { runCommand, runCommandSync, runPureView, runView, tsHasPureView, tsHasView, tsRuns, tsRunsSync } from '@gp/core/commands';

/**
 * The way back to TypeScript (ADR 0008, docs/core-back-to-typescript.md): a command the TS core has been ported to
 * runs there, the rest here, until nothing is left here. `GP_CORE=rust` (or `rustOnly(true)`) runs everything here
 * again, for a comparison or as a way back while the port is new.
 */
let everythingInRust = typeof process !== 'undefined' && process.env?.GP_CORE === 'rust';
const tracing = typeof process !== 'undefined' && process.env?.GP_CORE_TRACE === '1';
const traced = new Set<string>();
export function rustOnly(on: boolean): void {
  everythingInRust = on;
}

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

  /** `onlyRust`: this instance runs every command here, whatever the TS core has (the port's checks, ADR 0008). */
  constructor(
    private module: WebAssembly.Module,
    private onlyRust = false,
  ) {}

  /** Another instance of the same core, for a view that must not wait on this one's call under way. */
  spare(): RustCore {
    return new RustCore(this.module, this.onlyRust);
  }

  /** Whether the TS core runs `name` here. */
  private inTs(name: string): boolean {
    return !everythingInRust && !this.onlyRust && tsRuns(name);
  }

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
    // What still reaches the WASM, named once each (`GP_CORE_TRACE=1`): the port's way to see what is left (ADR 0008).
    if (tracing && !this.onlyRust && !traced.has(name)) {
      traced.add(name);
      console.warn(`gp-core: ${name} ran in the Rust core`);
    }
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
    if (this.inTs(name)) return this.queue.run(() => runCommand(name, args, ctx, sql));
    const said = await this.drive(name, args, ctx, sql);
    return said ? (JSON.parse(said) as unknown) : undefined;
  }

  /**
   * What the view `name` shows (docs/rust-core.md, 2.5 step 3), every statement through `sql`: one state of the
   * database when the caller holds its lock. A refusal is thrown as MutationError with the core's code.
   */
  async view<T>(name: string, args: unknown, sql: RunSql): Promise<T> {
    if (!everythingInRust && !this.onlyRust && tsHasView(name)) return this.queue.run(() => runView(name, args, sql)) as Promise<T>;
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
    if (!everythingInRust && !this.onlyRust && tsHasPureView(name)) return runPureView(name, args) as T;
    if (this.busy) throw new Error(`the Rust core is in the middle of another call: ${name} must wait`);
    const step = this.call(name, args, undefined).next();
    if (!step.done) throw new Error(`${name} reads the database: call view() instead`);
    return JSON.parse(step.value || 'null') as T;
  }

  /** The same, all at once, for statements answered synchronously: where the server opens a database. */
  runSync(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSqlSync): void {
    if (!everythingInRust && !this.onlyRust && tsRunsSync(name)) return runCommandSync(name, sql);
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

/** Where a mutator runs: the core, and the caller's transaction it reads and writes through. */
export interface MutationDb {
  core: RustCore;
  rows: RunSql;
}

/**
 * Runs a mutator on the Rust core: done, or a MutationError with the refusal's code (invalid arguments are
 * `invalid-args`, a name the core does not know `unknown-mutator`).
 */
export function runMutation(on: MutationDb, name: string, args: unknown, ctx: MutatorCtx): Promise<void> {
  return on.core.run(name, args, ctx, on.rows).then(() => undefined);
}

export { legacyBlobs, legacyOverlayPage, legacyRowsProblem, upgradeLegacyRows } from './legacy.ts';

/** A file's bytes as base64, a slice at a time, as JSON carries them to a view that reads a file (crates/gp-core/src/files.rs). */
export function base64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
