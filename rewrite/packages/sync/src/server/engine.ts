import {
  getMutator,
  runMutator,
  SerialQueue,
  MutationError,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  tableByName,
  tableInfo,
  type MutationResult,
  type MutatorCtx,
  type PatchOp,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type Tx,
  type UpdateRequired,
} from '@gp/core';

export { SerialQueue };

/** Oldest wire protocol this server still serves. */
export const MIN_PROTOCOL = 1;
/** Changes per pull page. A fresh device's first pull of a library is tens of thousands; pages of 500 made it 40 round trips. */
export const PULL_PAGE = 5000;

/** Ids named in one read of a page's rows: a Durable Object binds at most 100 values a statement. */
const READ_CHUNK = 100;

type Row = Record<string, unknown>;

/**
 * One organisation's database, as each runtime provides it. Both server
 * drivers (better-sqlite3, DO SQLite) are synchronous, so `query` is too.
 */
export interface OrgStore {
  db: Tx;
  query(sql: string, params?: unknown[]): Row[];
  /**
   * Runs `fn` atomically: all of its writes commit, or none do if it throws.
   * `fn` is async (a mutator) but awaits only this store's queries.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export type SyncResult<T> = { status: 200; body: T } | { status: 400 | 403 | 426; body: object };

function updateRequired(detail: string): SyncResult<never> {
  const body: UpdateRequired = { error: 'update-required', minimumProtocol: MIN_PROTOCOL, detail };
  return { status: 426, body };
}

function checkVersion(protocol: unknown, schemaVersion: unknown): SyncResult<never> | null {
  if (typeof protocol !== 'number' || protocol < MIN_PROTOCOL) return updateRequired(`protocol ${protocol}`);
  if (protocol > PROTOCOL_VERSION) return { status: 400, body: { error: 'server-too-old' } };
  if (schemaVersion !== SCHEMA_VERSION) return updateRequired(`schema ${schemaVersion}`);
  return null;
}

export function currentSeq(store: OrgStore): number {
  return Number(store.query('SELECT coalesce(max(seq), 0) AS s FROM sync_change')[0]!.s);
}

function clientRow(store: OrgStore, clientId: string) {
  return store.query('SELECT user_id, last_mutation_id FROM sync_client WHERE client_id = ?', [clientId])[0] as { user_id: string; last_mutation_id: number } | undefined;
}

/**
 * Applies a push. Each mutation runs in its own transaction together with the
 * client's new last mutation id (Replicache's atomicity rule). A mutation that
 * throws is rolled back, recorded, and still consumed (SYNC-R28).
 * The caller serialises pushes per organisation.
 */
export async function handlePush(store: OrgStore, ctx: MutatorCtx, req: PushRequest): Promise<SyncResult<PushResponse>> {
  const bad = checkVersion(req.protocol, req.schemaVersion);
  if (bad) return bad;
  for (const m of req.mutations) {
    const mut = getMutator(m.name);
    if (mut && m.v < mut.minV) return updateRequired(`${m.name} v${m.v}`);
  }

  const existing = clientRow(store, req.clientId);
  if (existing && existing.user_id !== ctx.userId) return { status: 403, body: { error: 'client-belongs-to-another-user' } };
  if (!existing) {
    store.query('INSERT INTO sync_client (client_id, user_id, last_mutation_id, last_seen) VALUES (?, ?, 0, ?)', [req.clientId, ctx.userId, Date.now()]);
  }
  let last = existing?.last_mutation_id ?? 0;
  const results: MutationResult[] = [];
  const setLast = (id: number) => store.query('UPDATE sync_client SET last_mutation_id = ?, last_seen = ? WHERE client_id = ?', [id, Date.now(), req.clientId]);

  for (const m of req.mutations) {
    if (m.id <= last) continue; // already applied: a retry after a lost response
    if (m.id > last + 1) return { status: 400, body: { error: 'mutation-gap', expected: last + 1, got: m.id } };
    const mut = getMutator(m.name);
    try {
      if (!mut) throw new MutationError('unknown-mutator', m.name);
      if (m.v > mut.v) throw new MutationError('unknown-version', `${m.name} v${m.v}`);
      await store.transaction(async () => {
        await runMutator(mut, store.db, m.args, { ...ctx, now: Date.now() }); // the server's clock (see MutatorCtx)
        setLast(m.id);
      });
    } catch (e) {
      const error = e instanceof MutationError ? e.code : `error: ${(e as Error).message}`;
      await store.transaction(async () => {
        store.query('INSERT OR REPLACE INTO sync_mutation_result (client_id, mutation_id, error) VALUES (?, ?, ?)', [req.clientId, m.id, error]);
        setLast(m.id);
      });
      results.push({ id: m.id, error });
    }
    last = m.id;
  }
  return { status: 200, body: { lastMutationId: last, results } };
}

function scopeOf(ctx: MutatorCtx): string {
  // A change of role or schema invalidates the client's copy: the next pull is a reset.
  return `s${SCHEMA_VERSION}.${ctx.role}`;
}

/** Reads one page of changes after the cookie. Synchronous, so it sees one consistent state. */
export function handlePull(store: OrgStore, ctx: MutatorCtx, req: PullRequest): SyncResult<PullResponse> {
  const bad = checkVersion(req.protocol, req.schemaVersion);
  if (bad) return bad;
  const scope = scopeOf(ctx);
  const [seqText, cookieScope] = (req.cookie ?? '').split(':');
  const clear = cookieScope !== scope;
  const since = clear ? 0 : Number(seqText);

  const changes = store.query('SELECT seq, tbl, pk, op FROM sync_change WHERE seq > ? ORDER BY seq LIMIT ?', [since, PULL_PAGE + 1]) as {
    seq: number;
    tbl: string;
    pk: string;
    op: 'put' | 'del';
  }[];
  const more = changes.length > PULL_PAGE;
  const page = changes.slice(0, PULL_PAGE);

  // Each put sends the row as it is now (none if deleted since): read with one query per table and chunk, not one per row.
  const wanted = new Map<string, Set<string>>();
  for (const c of page) if (c.op === 'put' && tableByName.has(c.tbl)) (wanted.get(c.tbl) ?? wanted.set(c.tbl, new Set()).get(c.tbl)!).add(c.pk);
  const rows = new Map<string, Map<string, Row>>();
  for (const [tbl, ids] of wanted) {
    const byId = new Map<string, Row>();
    const all = [...ids];
    for (let at = 0; at < all.length; at += READ_CHUNK) {
      const chunk = all.slice(at, at + READ_CHUNK);
      for (const row of store.query(`SELECT * FROM ${tbl} WHERE id IN (${chunk.map(() => '?').join(', ')})`, chunk)) byId.set(String(row.id), row);
    }
    rows.set(tbl, byId);
  }

  const patch: PatchOp[] = [];
  for (const c of page) {
    if (!tableByName.has(c.tbl)) continue;
    if (c.op === 'del') {
      // A client that is starting from empty does not need delete markers.
      if (!clear) patch.push({ op: 'del', tbl: c.tbl, pk: c.pk });
      continue;
    }
    const row = rows.get(c.tbl)?.get(c.pk);
    if (row) patch.push({ op: 'put', tbl: c.tbl, row });
  }

  const lastMutationId = clientRow(store, req.clientId)?.last_mutation_id ?? 0;
  const results = store.query('SELECT mutation_id AS id, error FROM sync_mutation_result WHERE client_id = ? AND mutation_id > ? ORDER BY mutation_id', [
    req.clientId,
    req.lastMutationId ?? 0,
  ]) as unknown as MutationResult[];
  const endSeq = page.length ? page[page.length - 1]!.seq : since;
  return { status: 200, body: { cookie: `${endSeq}:${scope}`, lastMutationId, clear, patch, more, results } };
}

/** Debug: every synced table, sorted, plus the change log. Used to compare databases. */
export function dump(store: OrgStore) {
  const tables: Record<string, Row[]> = {};
  for (const t of tableInfo) tables[t.name] = store.query(`SELECT * FROM ${t.name} ORDER BY id`);
  const changes = store.query('SELECT seq, tbl, pk, op FROM sync_change ORDER BY seq');
  return { tables, changes };
}

/**
 * Coalesces pokes to one per window, trailing edge (SYNC-R38). The writer that
 * caused the change is not poked, unless another writer changed the same
 * organisation in the same window (SYNC-R39).
 */
export class PokeCoalescer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private origins = new Set<string>();
  private seq = 0;
  constructor(
    private send: (exclude: string | null, seq: number) => void,
    private windowMs = 500,
  ) {}
  changed(origin: string, seq: number) {
    this.origins.add(origin);
    this.seq = Math.max(this.seq, seq);
    this.timer ??= setTimeout(() => this.flush(), this.windowMs);
  }
  private flush() {
    const exclude = this.origins.size === 1 ? [...this.origins][0]! : null;
    this.origins.clear();
    this.timer = undefined;
    this.send(exclude, this.seq);
  }
}
