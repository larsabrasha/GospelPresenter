// The core as the shells call it (ADR 0008): a command (a mutator, the schema's `migrateOrgSchema` and `seedLabels`,
// sync's `sync…`) or a view by name, every statement through the shell's `sql` in the shell's transaction. The shape
// is the one the Rust core had (at the tag native-experiment-end), so the shells did not change when the
// core came back to TypeScript.
import type { CustomPage, Picture } from './custom-slides.ts';
import type { LegacyRows } from './legacy.ts';
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

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A file's bytes as standard base64, as JSON carries them to a view that reads a file. */
export function base64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let at = 0; at < bytes.length; at += 3) {
    const [a, b, c] = [bytes[at]!, bytes[at + 1], bytes[at + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out.push(B64[n >> 18]!, B64[(n >> 12) & 63]!, b === undefined ? '=' : B64[(n >> 6) & 63]!, c === undefined ? '=' : B64[n & 63]!);
  }
  return out.join('');
}

export type { Rows, RunSql, RunSqlSync } from './commands.ts';
export type { DriverEffect } from './sync-driver.ts';

// The export zip's rows (docs/import-from-1x.md), for the web, the server and 1.x's export alike: the rows go to the
// views as JSON text and the rewritten ones come back as JSON text, so an object's keys keep JavaScript's order.

/** A zip's rows of `format` as this format has them (`legacyUpgradeView`). */
export function upgradeLegacyRows(format: number, rows: unknown): LegacyRows {
  return JSON.parse(runPureView('legacyUpgradeView', { format, rows: JSON.stringify(rows) }) as string) as LegacyRows;
}

/** The first row the server would refuse, named by its table and id, or null (`legacyRowsProblemView`). */
export function legacyRowsProblem(rows: LegacyRows): string | null {
  return runPureView('legacyRowsProblemView', { rows: JSON.stringify(rows) }) as string | null;
}

/** The blobs the rows name, each with the row that names it ("images {id}"), and which of them are videos (`legacyBlobsView`). */
export function legacyBlobs(rows: LegacyRows): { named: [hash: string, row: string][]; videos: Set<string> } {
  const { named, videos } = runPureView('legacyBlobsView', { rows: JSON.stringify(rows) }) as { named: [string, string][]; videos: string[] };
  return { named, videos: new Set(videos) };
}

/** A 1.x overlay as a page, drawn as 1.x drew it: its picture over the stage, its text at the top left (`legacyOverlayPageView`). */
export function legacyOverlayPage(content: string | null, picture: Picture | null): CustomPage {
  return JSON.parse(runPureView('legacyOverlayPageView', { content, picture }) as string) as CustomPage;
}
