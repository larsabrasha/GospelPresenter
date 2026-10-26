// Bible texts on a client (README, "Bibles"): a translation's verses are an
// immutable text named by its hash, kept in tables that do not sync. Only the
// `bibles` row syncs; this fetches each text it names once and keeps it, and
// drops texts no translation names any more.
import {
  bibleTextHash,
  bibleTextSchema,
  LOAD_BIBLE_TEXT_SQL,
  serializeBibleText,
  storeBibleTextSql,
  type BibleBookText,
} from '@gp/core';
import type { SyncClient } from './client.ts';

/**
 * Stores a text locally and returns its hash and canonical JSON, ready to
 * upload (`PUT /bibles/{hash}`) before `importBible` names it.
 */
export async function storeBibleText(client: SyncClient, books: BibleBookText[]): Promise<{ hash: string; json: string }> {
  const json = serializeBibleText(books);
  const hash = await bibleTextHash(json);
  await client.localWrite(storeBibleTextSql(hash, books));
  return { hash, json };
}

export async function hasBibleText(client: SyncClient, hash: string): Promise<boolean> {
  return (await client.query('SELECT 1 FROM bible_blobs WHERE hash = ?', [hash])).length > 0;
}

/** A stored text's books in order, or null if this device does not have it yet. */
export async function loadBibleText(client: SyncClient, hash: string): Promise<BibleBookText[] | null> {
  if (!(await hasBibleText(client, hash))) return null;
  const rows = (await client.query(LOAD_BIBLE_TEXT_SQL, [hash])) as { code: string; chunk: string }[];
  return rows.map((r) => ({ code: r.code, verses: JSON.parse(r.chunk) as BibleBookText['verses'] }));
}

export interface BibleTextSync {
  downloaded: string[];
  /** Named by a translation, but the server did not have it or the download failed. */
  missing: string[];
  removed: number;
}

/**
 * Downloads every text a translation names that this device lacks, then
 * removes texts nothing names (keeping any a queued `importBible` names).
 * `download` returns the text's JSON, or null if the server has none.
 * Callers serialise this with their own imports.
 */
export async function syncBibleTexts(client: SyncClient, download: (hash: string) => Promise<string | null>): Promise<BibleTextSync> {
  const result: BibleTextSync = { downloaded: [], missing: [], removed: 0 };
  const wanted = (await client.query(
    'SELECT DISTINCT content_hash AS hash FROM bibles WHERE content_hash NOT IN (SELECT hash FROM bible_blobs)',
  )) as { hash: string }[];
  for (const { hash } of wanted) {
    let json: string | null = null;
    try {
      json = await download(hash);
    } catch {
      json = null;
    }
    const books = json === null ? null : await verified(json, hash);
    if (!books) {
      result.missing.push(hash);
      continue;
    }
    await client.localWrite(storeBibleTextSql(hash, books));
    result.downloaded.push(hash);
  }

  const queued = (await client.pending()).filter((m) => m.name === 'importBible').map((m) => String(JSON.parse(m.args).contentHash));
  const unused = (await client.query('SELECT hash FROM bible_blobs WHERE hash NOT IN (SELECT content_hash FROM bibles)')) as { hash: string }[];
  const drop = unused.map((u) => u.hash).filter((h) => !queued.includes(h));
  if (drop.length) {
    await client.localWrite(
      drop.flatMap((h) => [
        { sql: 'DELETE FROM bible_texts WHERE hash = ?', params: [h] },
        { sql: 'DELETE FROM bible_blobs WHERE hash = ?', params: [h] },
      ]),
    );
  }
  result.removed = drop.length;
  return result;
}

/** The text, if it parses and is what `hash` names. */
async function verified(json: string, hash: string): Promise<BibleBookText[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const text = bibleTextSchema.safeParse(parsed);
  if (!text.success) return null;
  return (await bibleTextHash(serializeBibleText(text.data.books))) === hash ? text.data.books : null;
}
