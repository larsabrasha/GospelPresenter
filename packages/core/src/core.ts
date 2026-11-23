// The core as the shells call it (ADR 0008): a command (a mutator, the schema's `migrateOrgSchema` and `seedLabels`,
// sync's `sync…`) or a view by name, every statement through the shell's `sql` in the shell's transaction. The shape
// is the one the Rust core had (at the tag native-experiment-end), so the shells did not change when the
// core came back to TypeScript.
import type { MutatorCtx } from './mutation.ts';
import { runCommand, runCommandSync, runPureView, runView, type RunSql, type RunSqlSync } from './commands.ts';
import { SerialQueue } from './serial-queue.ts';

/**
 * The core, one per connection: its commands and views run one at a time, so a view never reads between a command's
 * statements on the same connection.
 */
export class Core {
  private queue = new SerialQueue();

  /**
   * Runs the command `name` to its end in the caller's transaction: its answer (sync's commands have one), or a
   * refusal thrown as MutationError with its code. A statement `sql` throws for is thrown as it was, or, replaying a
   * sync queue, rolls that change back and goes on.
   */
  run(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql): Promise<unknown> {
    return this.queue.run(() => runCommand(name, args, ctx, sql));
  }

  /** What the view `name` shows, read from one state of the database when the caller holds its lock. */
  view<T>(name: string, args: unknown, sql: RunSql): Promise<T> {
    return this.queue.run(() => runView(name, args, sql)) as Promise<T>;
  }

  /** A view that reads no database, at once: a page calls it on its own thread, so a key needs no round trip. */
  pure<T>(name: string, args: unknown): T {
    return runPureView(name, args) as T;
  }

  /** The schema's commands, all at once, for statements answered synchronously: where the server opens a database. */
  runSync(name: string, sql: RunSqlSync): void {
    runCommandSync(name, sql);
  }
}

/** Where a mutator runs: the core, and the caller's transaction it reads and writes through. */
export interface MutationDb {
  core: Core;
  rows: RunSql;
}

/** Runs a mutator: done, or a MutationError with the refusal's code (`invalid-args`, `unknown-mutator`, the mutator's). */
export function runMutation(on: MutationDb, name: string, args: unknown, ctx: MutatorCtx): Promise<void> {
  return on.core.run(name, args, ctx, on.rows).then(() => undefined);
}

export type { Rows, RunSql, RunSqlSync } from './commands.ts';
export type { DriverEffect } from './sync-driver.ts';
export * from './pure.ts';
export { legacyBlobs, legacyOverlayPage, legacyRowsProblem, upgradeLegacyRows } from './views/files-legacy.ts';
