// The core's commands and views by name (ADR 0008, docs/core-back-to-typescript.md): a mutator, the schema's
// `migrateOrgSchema` and `seedLabels`, sync's `sync…`, every statement through the shell's `sql` in the shell's
// transaction. The shells reach them through core.ts's `Core`.
import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { labelSeedSql } from './labels.ts';
import { MutationError, type MutatorCtx } from './mutation.ts';
import { getMutator, runMutator } from './mutators/registry.ts';
import type { Tx } from './mutators/base.ts';
import { orgSchemaPlan, schemaMetaDdl, schemaStateSql } from './org-schema.ts';
import * as schema from './schema.ts';
import { runSyncCommand, SYNC_COMMANDS } from './sync-commands.ts';
import { syncStepView } from './sync-driver.ts';

import { syncStatusView } from './sync-status.ts';

import type { Rows, RunSql } from './views/sql.ts';
import { pureViews as groupPureViews, views as groupViews } from './views/index.ts';

export type { Rows, RunSql } from './views/sql.ts';
/** The same, synchronous: the server opening a database (a Durable Object's `transactionSync`, node's drivers). */
export type RunSqlSync = (sql: string, params: unknown[]) => Rows;

/** Drizzle over the shell's statements: sqlite-proxy, which takes rows as arrays in column order. */
function drizzleOver(sql: RunSql): Tx {
  return drizzle(
    async (query, params, method) => {
      const rows = await sql(query, params);
      return { rows: method === 'get' ? (rows[0] as unknown[]) : rows };
    },
    { schema },
  ) as unknown as Tx;
}

/** The schema's plan from its two reads, through either kind of `sql`. */
const planOf = (version: Rows, tables: Rows) => orgSchemaPlan(version[0] ? Number(version[0][0]) : null, Number(tables[0]?.[0] ?? 0) > 0);

/** The commands that read and write no rows but SQL's own, run synchronously where the server opens a database. */
const syncCommands: Record<string, (sql: RunSqlSync) => void> = {
  migrateOrgSchema(sql) {
    sql(schemaMetaDdl, []);
    for (const s of planOf(sql(schemaStateSql.version, []), sql(schemaStateSql.hasTables, []))) sql(s, []);
  },
  seedLabels(sql) {
    for (const s of labelSeedSql) sql(s, []);
  },
};

const SYNC = new Set<string>(SYNC_COMMANDS);

/**
 * Runs the command `name` in the caller's transaction: its answer (sync's commands have one), or a refusal thrown
 * as MutationError with its code (`invalid-args`, `unknown-mutator`, or the mutator's). A statement `sql` throws for is
 * thrown as it was.
 */
export async function runCommand(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql): Promise<unknown> {
  if (Object.hasOwn(syncCommands, name)) {
    // The same steps as the synchronous run, each awaited (wa-sqlite answers asynchronously).
    if (name === 'migrateOrgSchema') {
      await sql(schemaMetaDdl, []);
      for (const s of planOf(await sql(schemaStateSql.version, []), await sql(schemaStateSql.hasTables, []))) await sql(s, []);
    } else for (const s of labelSeedSql) await sql(s, []);
    return undefined;
  }
  if (SYNC.has(name)) return runSyncCommand(name, args, ctx, sql, runMutatorCommand);
  return runMutatorCommand(name, args, ctx, sql);
}

/** A mutator by name, its arguments checked, through Drizzle over the shell's statements. */
async function runMutatorCommand(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql): Promise<undefined> {
  const mutator = getMutator(name);
  if (!mutator) throw new MutationError('unknown-mutator', `no mutator ${name}`);
  if (!ctx) throw new MutationError('forbidden', `${name} needs a caller`);
  try {
    await runMutator(mutator, drizzleOver(sql), args, ctx);
  } catch (e) {
    // A statement the shell's SQLite refused, as the shell threw it, not wrapped by Drizzle.
    throw e instanceof DrizzleQueryError && e.cause !== undefined ? e.cause : e;
  }
  return undefined;
}

/** The same, all at once, for statements answered synchronously: only the schema's commands. */
export function runCommandSync(name: string, sql: RunSqlSync): void {
  const run = syncCommands[name];
  if (!run) throw new Error(`${name} cannot run synchronously`);
  run(sql);
}

// ------------------------------------------------------------------ views

/** The views that read the database, through the shell's statements under its lock. */
const views: Record<string, (args: unknown, sql: RunSql) => Promise<unknown>> = {
  syncStepView,
  ...groupViews,
};

/** The views that read nothing but their arguments: a page calls them on its own thread, at once. */
const pureViews: Record<string, (args: unknown) => unknown> = {
  syncStatusView,
  ...groupPureViews,
};

/** What the view `name` shows; a refusal is thrown as MutationError with its code. */
export async function runView(name: string, args: unknown, sql: RunSql): Promise<unknown> {
  if (Object.hasOwn(pureViews, name)) return pureViews[name]!(args);
  const view = views[name];
  if (!view) throw new MutationError('unknown-view', name);
  return view(args, sql);
}

/** A view that reads no database, at once. */
export function runPureView(name: string, args: unknown): unknown {
  const view = pureViews[name];
  if (view) return view(args);
  if (Object.hasOwn(views, name)) throw new Error(`${name} reads the database: call view() instead`);
  throw new MutationError('unknown-view', name);
}
