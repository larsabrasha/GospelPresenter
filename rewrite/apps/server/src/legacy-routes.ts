import { Hono, type Context } from 'hono';
import {
  can,
  DISPLAY_CODE,
  displayCode,
  LEGACY_TABLES,
  legacyRowProblem,
  legacyRowsSchema,
  parseBibleContent,
  parseSlidesContent,
  tableByName,
  upsertSql,
  type LegacyImportRefusal,
  type LegacyRow,
  type LegacyRows,
} from '@gp/core';
import { currentSeq, type OrgStore } from '@gp/sync/server';
import type { Caller } from './auth/index.ts';
import type { Org } from './app.ts';
import type { WatchRegistry } from './watch.ts';

// The import from 1.x (docs/import-from-1x.md): an admin sends an empty organisation the rows of an export
// zip, after its blobs and Bible texts went up through `PUT /api/media/:hash` and `PUT /api/bibles/:hash`.
// The rows are written in one transaction, so the change log has them and every device pulls them as usual.

/** Tables that say an organisation is in use: an import never mixes with what is there. */
const IN_USE = ['songs', 'presentations', 'bibles', 'images', 'audios', 'videos', 'overlays', 'displays', 'ccli_entries'];

/** A Durable Object binds at most 100 values a statement. */
const MAX_PARAMS = 100;

const inUse = (store: OrgStore) => IN_USE.some((t) => store.query(`SELECT 1 FROM ${t} LIMIT 1`).length);

function refusal(store: OrgStore, rows: LegacyRows): LegacyImportRefusal | null {
  if (inUse(store)) return 'not-empty';
  for (const t of LEGACY_TABLES) if (rows[t].some((r) => legacyRowProblem(t, r))) return 'invalid-rows';
  if (rows.displays.some((d) => !DISPLAY_CODE.test(String(d.code)) || (d.kind !== 'public' && d.kind !== 'screen'))) return 'invalid-rows';

  const hashes = new Set<string>();
  for (const i of rows.images) hashes.add(String(i.full_hash)).add(String(i.thumb_hash));
  for (const a of rows.audios) hashes.add(String(a.hash));
  for (const item of rows.presentation_items) {
    const content = typeof item.content === 'string' ? item.content : null;
    if (item.type === 'slides') {
      const deck = parseSlidesContent(content);
      if (!deck) return 'invalid-rows';
      for (const p of deck.pages) hashes.add(p.full).add(p.thumb);
    } else if (item.type === 'bible' && !parseBibleContent(content)) return 'invalid-rows';
  }
  const known = new Set(store.query('SELECT hash FROM media_blobs').map((r) => String(r.hash)));
  if ([...hashes].some((h) => !known.has(h))) return 'missing-media';
  const texts = new Set(store.query('SELECT hash FROM bible_blobs').map((r) => String(r.hash)));
  if (rows.bibles.some((b) => !texts.has(String(b.content_hash)))) return 'missing-bible';
  return null;
}

/**
 * Writes the rows, parents first: an upsert, so the labels and settings the organisation was given when it
 * was made take the old ones' colours and values. A song version's `user_id` is the importing admin's.
 */
function importLegacyRows(store: OrgStore, rows: LegacyRows, userId: string): LegacyImportRefusal | null {
  const refused = refusal(store, rows);
  if (refused) return refused;
  for (const t of LEGACY_TABLES) {
    const info = tableByName.get(t)!;
    const all: LegacyRow[] = t === 'song_versions' ? rows[t].map((r) => ({ ...r, user_id: userId })) : rows[t];
    const per = Math.max(1, Math.floor(MAX_PARAMS / info.columns.length));
    for (let at = 0; at < all.length; at += per) {
      const chunk = all.slice(at, at + per);
      store.query(
        upsertSql(info, chunk.length),
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

  // Whether an import would be taken, asked before the files go up: a device may not have pulled everything yet.
  app.get('/api/import/legacy', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    if (!can(r.caller.ctx.role, 'ManageOrganizationSettings')) return c.json({ error: 'forbidden' }, 403);
    return c.json({ empty: !(await r.org.queue.run(async () => inUse(r.org.store))) });
  });

  app.post('/api/import/legacy', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const { org, caller } = r;
    if (!can(caller.ctx.role, 'ManageOrganizationSettings')) return c.json({ error: 'forbidden' }, 403);
    const parsed = legacyRowsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-rows' }, 400);
    const rows = watch ? await freeCodes(parsed.data, caller.orgId, watch) : parsed.data;
    const refused = await org.queue.run(async () => {
      const before = currentSeq(org.store);
      const result = await org.store.transaction(async () => importLegacyRows(org.store, rows, caller.ctx.userId));
      const after = currentSeq(org.store);
      if (after > before) org.poke.changed('', after);
      return result;
    });
    if (refused) return c.json({ error: refused }, refused === 'not-empty' ? 409 : 400);
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
