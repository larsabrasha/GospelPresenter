// A translation's text this device does not keep, fetched from the server for this window only (docs/bibles-and-themes.md,
// "Bibles"): held in a database of its own in memory, so the core's bibleView reads it as it reads a kept one, a book
// or a chapter at a time. Only the last few are held, as each is megabytes.
import { storeBibleTextSql, type BibleBookText } from '@gp/core';
import type { RunSql } from '@gp/rust-core';
import type { ClientSqlite } from '@gp/sync/client';

const HELD = 3;
const held = new Map<string, Promise<{ db: ClientSqlite; rows: RunSql } | null>>();

/**
 * The statements of a database holding the text `hash`, fetched with `fetch` into one `open` makes; null when the
 * server has none or cannot be reached, which is asked again next time rather than remembered.
 */
export async function fetchedBibleText(
  hash: string,
  fetch: (hash: string) => Promise<BibleBookText[] | null>,
  open: () => Promise<ClientSqlite>,
): Promise<RunSql | null> {
  let p = held.get(hash);
  if (p) held.delete(hash); // the last used goes last
  p ??= (async () => {
    const books = await fetch(hash);
    if (!books) return null;
    const db = await open();
    await db.query('CREATE TABLE bible_texts (hash TEXT NOT NULL, book TEXT NOT NULL, sort INTEGER NOT NULL, chunk TEXT NOT NULL)');
    await db.query('CREATE TABLE bible_blobs (hash TEXT PRIMARY KEY NOT NULL, verse_count INTEGER NOT NULL)');
    for (const s of storeBibleTextSql(hash, books)) await db.query(s.sql, s.params);
    return { db, rows: async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows };
  })();
  held.set(hash, p);
  for (const [old, text] of held) {
    if (held.size <= HELD) break;
    held.delete(old);
    void text.then((t) => t?.db.close());
  }
  const text = await p.catch(() => null);
  if (!text && held.get(hash) === p) held.delete(hash);
  return text?.rows ?? null;
}
