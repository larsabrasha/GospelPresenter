// What of the client's sync decides what the device's database holds (ADR 0008; ported back from
// crates/gp-core/src/sync.rs): a change run at once and queued (`_mutation`), the queue to send, and the rebase of the
// queue onto the server's pages. The network, the socket, when to sync, retries, sign-in and the server's refusals
// stay in the shell (packages/sync's SyncClient). The shell runs `syncOpen` in the transaction of `migrateOrgSchema`,
// after it, and each of the others in one transaction of its own, rolled back when the command is refused.
import { MutationError, type MutatorCtx } from './mutation.ts';
import { isObj } from './views/serde.ts';
import type { RunSql } from './views/sql.ts';
import { CHANGED_TABLES, changeTrackingDdl, clientSyncDdl, clientUndoRestore, clientUndoTriggers, tableByName, tableInfo, upsertSql } from './sync-sql.ts';

/** Runs a mutator by name in the shell's transaction, or throws its refusal. */
type RunMutator = (name: string, args: unknown, ctx: MutatorCtx, sql: RunSql) => Promise<unknown>;

/** Every mutator's version (`m()` in registry.ts gives each v 1). */
const MUTATOR_VERSION = 1;
/** Most values bound in one statement of a pull. */
const MAX_PARAMS = 5000;

/** One page of a pull, as the server sends it. */
interface PullPage {
  clear?: boolean;
  patch?: { op?: string; tbl?: string; pk?: unknown; row?: Record<string, unknown> }[];
  results?: unknown[];
  lastMutationId?: unknown;
  cookie?: unknown;
}

type Args = Record<string, unknown>;

/** The tables the open transaction wrote, forgotten before it commits. */
async function changedTables(sql: RunSql): Promise<unknown[]> {
  const tables = (await sql(`SELECT tbl FROM ${CHANGED_TABLES}`, [])).map((r) => r[0]);
  if (tables.length) await sql(`DELETE FROM ${CHANGED_TABLES}`, []);
  return tables;
}

/** A mutator by name, its arguments as the text queued for them. */
async function runQueued(run: RunMutator, name: string, argsText: string, ctx: MutatorCtx, sql: RunSql) {
  let args: unknown;
  try {
    args = JSON.parse(argsText);
  } catch {
    throw new MutationError('invalid-args', 'the arguments are not JSON');
  }
  if (!isObj(args)) throw new MutationError('invalid-args', 'the arguments are not an object');
  await run(name, args, ctx, sql);
}

/** The client's sync tables, its triggers and its record of changed tables; this device's id, kept from the first open. */
async function open(a: Args, sql: RunSql) {
  if (typeof a.clientId !== 'string') throw new MutationError('invalid-args', 'clientId');
  for (const s of [...clientSyncDdl, ...clientUndoTriggers(), ...changeTrackingDdl()]) await sql(s, []);
  await sql('INSERT OR IGNORE INTO _sync_meta (one, client_id) VALUES (1, ?)', [a.clientId]);
  const [row] = await sql('SELECT client_id FROM _sync_meta', []);
  return { clientId: row ? row[0] : null };
}

/**
 * `mutate`: the change run at once and queued for the server, in one transaction; refused, nothing is written (the
 * shell rolls back). `args` is the arguments' JSON as the shell wrote it, kept as it is in the queue.
 */
async function queue(a: Args, ctx: MutatorCtx, sql: RunSql, run: RunMutator) {
  if (typeof a.mutator !== 'string' || typeof a.args !== 'string') throw new MutationError('invalid-args', 'mutator and args');
  const [meta] = await sql('SELECT next_mutation_id FROM _sync_meta', []);
  if (!meta) throw new MutationError('not-open', 'the sync tables are not open');
  const id = Number(meta[0]);
  await sql('UPDATE _sync_meta SET next_mutation_id = ?', [id + 1]);
  await sql('INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, ?, ?)', [id, a.mutator, MUTATOR_VERSION, a.args]);
  await runQueued(run, a.mutator, a.args, ctx, sql);
  return { tables: await changedTables(sql) };
}

/** The queue, oldest first: what a push sends, each mutation's arguments as their JSON text. */
async function pending(sql: RunSql) {
  return (await sql('SELECT id, name, v, args FROM _mutation ORDER BY id', [])).map((r) => ({ id: r[0], name: r[1], v: r[2], args: r[3] }));
}

/**
 * Every optimistic write undone, the server's pages applied, what the server has consumed dropped, and the rest of
 * the queue replayed on top, each in a savepoint: one that no longer applies here stays queued, the server decides.
 */
async function rebase(a: Args, ctx: MutatorCtx, sql: RunSql, run: RunMutator) {
  const pages = a.pages;
  if (!Array.isArray(pages) || !pages.length) throw new MutationError('invalid-args', 'pages');
  await sql('PRAGMA defer_foreign_keys = ON', []);
  await sql('UPDATE _sync_meta SET capture = 0', []);
  for (const s of clientUndoRestore()) await sql(s, []);
  await sql('DELETE FROM _undo', []);

  if ((pages[0] as PullPage).clear === true) for (const { name } of tableInfo.toReversed()) await sql(`DELETE FROM ${name}`, []);
  // Puts in a row to one table, gathered into one statement.
  let batch: { table: string; columns: string[]; params: unknown[]; rows: number } | undefined;
  const flush = async () => {
    if (!batch) return;
    const b = batch;
    batch = undefined;
    await sql(upsertSql({ name: b.table, columns: b.columns }, b.rows), b.params);
  };
  const results: unknown[] = [];
  for (const page of pages as PullPage[]) {
    for (const op of Array.isArray(page.patch) ? page.patch : []) {
      const t = typeof op.tbl === 'string' ? tableByName.get(op.tbl) : undefined;
      if (!t) continue;
      if (op.op === 'del') {
        await flush();
        await sql(`DELETE FROM ${t.name} WHERE id = ?`, [op.pk ?? null]);
        continue;
      }
      if (batch && (batch.table !== t.name || (batch.rows + 1) * t.columns.length > MAX_PARAMS)) await flush();
      batch ??= { table: t.name, columns: t.columns, params: [], rows: 0 };
      const row = isObj(op.row) ? op.row : {};
      batch.params.push(...t.columns.map((c) => row[c] ?? null));
      batch.rows++;
    }
    if (Array.isArray(page.results)) results.push(...page.results);
  }
  await flush();

  const last = pages.at(-1) as PullPage;
  await sql('DELETE FROM _mutation WHERE id <= ?', [last.lastMutationId ?? null]);
  await sql('UPDATE _sync_meta SET cookie = ?, last_mutation_id = ?, capture = 1', [last.cookie ?? null, last.lastMutationId ?? null]);

  let refused = 0;
  for (const m of await sql('SELECT id, name, v, args FROM _mutation ORDER BY id', [])) {
    await sql('SAVEPOINT replay', []);
    try {
      await runQueued(run, String(m[1]), String(m[3]), ctx, sql);
    } catch {
      // A refusal, or a statement the shell could not run: the replay's writes go, the change stays queued.
      await sql('ROLLBACK TO replay', []);
      refused++;
    }
    await sql('RELEASE replay', []);
  }
  const changed = (pages as PullPage[]).some((p) => p.clear === true || (Array.isArray(p.patch) && p.patch.length > 0) || (Array.isArray(p.results) && p.results.length > 0));
  return { tables: await changedTables(sql), results, changed, replaysRefused: refused };
}

/** The sync commands' names. */
export const SYNC_COMMANDS = ['syncOpen', 'syncMutate', 'syncPending', 'syncRebase'] as const;

/** Runs the sync command `name` in the shell's transaction: its answer, or a refusal thrown as MutationError. */
export async function runSyncCommand(name: string, args: unknown, ctx: MutatorCtx | undefined, sql: RunSql, run: RunMutator): Promise<unknown> {
  const a = isObj(args) ? args : {};
  if (name === 'syncOpen') return open(a, sql);
  if (name === 'syncPending') return pending(sql);
  if (!ctx) throw new MutationError('forbidden', `${name} needs a caller`);
  if (name === 'syncMutate') return queue(a, ctx, sql, run);
  if (name === 'syncRebase') return rebase(a, ctx, sql, run);
  throw new MutationError('unknown-command', name);
}
