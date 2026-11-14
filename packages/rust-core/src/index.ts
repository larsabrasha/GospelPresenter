// The Rust core (crates/gp-core) under the app: its WASM run for the mutators it has, on the client and on the
// server alike, so a mutator is never the Rust core's on one end and the TS core's on the other (docs/rust-core.md,
// "Switch"). The core never opens a database: it asks for each SQL statement and waits for the rows (bridge.rs).
import { getMutator, MutationError, runMutator, SerialQueue, type MutatorCtx, type Tx } from '@gp/core';

/** The mutators the app runs through the Rust core: those proved against the TS core, which stays their reference. */
export const RUST_MUTATORS: ReadonlySet<string> = new Set([
  'createPresentation',
  'addSongToPresentation',
  'addHeaderToPresentation',
  'moveItem',
  'reorderItems',
  'removeItem',
  'updatePresentation',
  'renameItem',
  'setItemNote',
  'setItemArrangement',
  'trashPresentation',
  'restorePresentation',
  'purgePresentation',
]);

/** A statement's rows as arrays, in column order. */
export type Rows = unknown[][];
/** Runs one statement in the caller's transaction: synchronous on the server's drivers, async on wa-sqlite. */
export type RunSql = (sql: string, params: unknown[]) => Rows | Promise<Rows>;

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
   * Runs the mutator `name` to its end in the caller's transaction, every statement through `sql`. Done, or a
   * refusal thrown as MutationError with the core's code, as runMutator throws one (invalid arguments included).
   */
  mutate(name: string, args: unknown, ctx: MutatorCtx, sql: RunSql): Promise<void> {
    return this.queue.run(async () => {
      try {
        let status = this.core.gp_start(...this.pass(json({ name, args, ctx: { role: ctx.role, now: ctx.now } })));
        while (status === WANTS_SQL) {
          const ask = JSON.parse(this.said()) as { sql: string; params: unknown[] };
          const rows = await sql(ask.sql, ask.params);
          status = this.core.gp_resume(...this.pass(json(rows)));
        }
        if (status !== DONE) throw new MutationError(this.said());
      } catch (e) {
        // A trap (a panic in the core) leaves the instance unusable: the next call gets a fresh one.
        if (e instanceof WebAssembly.RuntimeError) this.instance = undefined;
        throw e;
      }
    });
  }
}

/** Where a mutator runs: Drizzle for the TS core, statements for the Rust core, both in one transaction. */
export interface MutationDb {
  db: Tx;
  core: RustCore;
  rows: RunSql;
}

/**
 * Runs a mutator as runMutator does, the Rust core's for those in RUST_MUTATORS and the TS core's for the rest:
 * done, or a MutationError with the refusal's code. A name neither core knows is refused as `unknown-mutator`.
 */
export function runMutation(on: MutationDb, name: string, args: unknown, ctx: MutatorCtx): Promise<void> {
  if (RUST_MUTATORS.has(name)) return on.core.mutate(name, args, ctx, on.rows);
  const mutator = getMutator(name);
  if (!mutator) return Promise.reject(new MutationError('unknown-mutator', name));
  return runMutator(mutator, on.db, args, ctx);
}
