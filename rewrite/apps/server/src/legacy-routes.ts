import { Hono, type Context } from 'hono';
import {
  can,
  DISPLAY_CODE,
  displayCode,
  LEGACY_TABLES,
  legacyRowsProblem,
  legacyRowsSchema,
  parseSlideDeckPages,
  tableByName,
  type LegacyImportRefusal,
  type LegacyRow,
  type LegacyRows,
  type TableInfo,
} from '@gp/core';
import { currentSeq, type OrgStore } from '@gp/sync/server';
import type { Caller } from './auth/index.ts';
import type { Org } from './app.ts';
import type { WatchRegistry } from './watch.ts';

// The import from 1.x (docs/import-from-1x.md): an admin sends an organisation the rows of an export zip, after
// its blobs and Bible texts went up through `PUT /api/media/:hash` and `PUT /api/bibles/:hash`. The rows are
// written in one transaction, so the change log has them and every device pulls them as usual. What the
// organisation has already is kept: a row whose id is there is left out, so a second run adds only what is new.

/** A Durable Object binds at most 100 values a statement. */
const MAX_PARAMS = 100;

interface Refused {
  error: LegacyImportRefusal;
  /** The row and why, for the admin who sees the import fail. */
  detail: string;
}

const newRowsSql = (t: TableInfo, rows: number) =>
  `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES ${Array.from({ length: rows }, () => `(${t.columns.map(() => '?').join(', ')})`).join(', ')}
    ON CONFLICT (id) DO NOTHING`;

function refusal(store: OrgStore, rows: LegacyRows): Refused | null {
  const problem = legacyRowsProblem(rows);
  if (problem) return { error: 'invalid-rows', detail: problem };

  const hashes: [string, string][] = [];
  for (const i of rows.images) hashes.push([String(i.full_hash), `images ${String(i.id)}`], [String(i.thumb_hash), `images ${String(i.id)}`]);
  for (const a of rows.audios) hashes.push([String(a.hash), `audios ${String(a.id)}`]);
  for (const d of rows.slide_decks) for (const p of parseSlideDeckPages(d.pages as string)) hashes.push([p.full, `slide_decks ${String(d.id)}`], [p.thumb, `slide_decks ${String(d.id)}`]);
  const known = new Set(store.query('SELECT hash FROM media_blobs').map((r) => String(r.hash)));
  const missing = hashes.find(([h]) => !known.has(h));
  if (missing) return { error: 'missing-media', detail: `${missing[1]}: no file ${missing[0]}` };
  const texts = new Set(store.query('SELECT hash FROM bible_blobs').map((r) => String(r.hash)));
  const bible = rows.bibles.find((b) => !texts.has(String(b.content_hash)));
  if (bible) return { error: 'missing-bible', detail: `bibles ${String(bible.id)}: no text ${String(bible.content_hash)}` };
  return null;
}

/**
 * Writes the rows whose ids are new, parents first. A song version's `user_id` is the importing admin's; an
 * output gets a new code when another output here has its code, or when it is not a code 2.0 uses (1.x let one be
 * typed, "scene"): 2.0's addresses take only its own.
 */
function importLegacyRows(store: OrgStore, rows: LegacyRows, userId: string): Refused | null {
  const refused = refusal(store, rows);
  if (refused) return refused;
  const codes = new Map(store.query('SELECT id, code FROM displays').map((r) => [String(r.code), String(r.id)]));
  const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  for (const t of LEGACY_TABLES) {
    const info = tableByName.get(t)!;
    let all: LegacyRow[] = rows[t];
    if (t === 'song_versions') all = all.map((r) => ({ ...r, user_id: userId }));
    if (t === 'displays') {
      all = all.map((d) => {
        const code = String(d.code);
        return !DISPLAY_CODE.test(code) || (codes.has(code) && codes.get(code) !== d.id) ? { ...d, code: displayCode(random) } : d;
      });
    }
    const per = Math.max(1, Math.floor(MAX_PARAMS / info.columns.length));
    for (let at = 0; at < all.length; at += per) {
      const chunk = all.slice(at, at + per);
      store.query(
        newRowsSql(info, chunk.length),
        chunk.flatMap((r) => info.columns.map((c) => r[c])),
      );
    }
  }
  return null;
}

/**
 * Gives an output whose code another organisation on this server holds a new one, so it is not left out of the
 * index without a word (`WatchRegistry.sync` never takes a code over): its link changes, the rest of it is kept.
 */
async function freeCodes(rows: LegacyRows, orgId: string, watch: WatchRegistry): Promise<LegacyRows> {
  const displays = await Promise.all(
    rows.displays.map(async (d) => {
      const held = await watch.lookup(String(d.code));
      return held && held.orgId !== orgId ? { ...d, code: displayCode((n) => crypto.getRandomValues(new Uint8Array(n))) } : d;
    }),
  );
  return { ...rows, displays };
}

export function legacyRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, watch: WatchRegistry | null) {
  const app = new Hono();

  app.post('/api/import/legacy', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const { org, caller } = r;
    if (!can(caller.ctx.role, 'ManageOrganizationSettings')) return c.json({ error: 'forbidden' }, 403);
    const parsed = legacyRowsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-rows', detail: parsed.error.issues[0]?.path.join(' ') ?? '' }, 400);
    const rows = watch ? await freeCodes(parsed.data, caller.orgId, watch) : parsed.data;
    const refused = await org.queue.run(async () => {
      const before = currentSeq(org.store);
      // A row the database refuses (a constraint, a limit) undoes the whole import and is named, not a 500.
      const result = await org.store
        .transaction(async () => importLegacyRows(org.store, rows, caller.ctx.userId))
        .catch((e: unknown): Refused => ({ error: 'write-failed', detail: e instanceof Error ? e.message : String(e) }));
      const after = currentSeq(org.store);
      if (after > before) org.poke.changed('', after);
      return result;
    });
    if (refused) return c.json(refused, 400);
    // After the rows are in, not as part of them: a failure here leaves the import done, and the codes are
    // registered again by the next change to an output.
    if (watch) {
      const codes = await org.queue.run(async () => org.store.query('SELECT id, code FROM displays') as { id: string; code: string }[]);
      await watch.sync(caller.orgId, codes).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  return app;
}
