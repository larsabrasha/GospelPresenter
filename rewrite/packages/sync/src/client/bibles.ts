// Bible texts on a client (README, "Bibles"): a translation's verses are an
// immutable text named by its hash, kept in tables that do not sync. Only the
// `bibles` row syncs; this fetches each text it names once and keeps it, and
// drops texts no translation names any more.
import {
  bibleTextHash,
  bibleTextSchema,
  joinBibleText,
  LOAD_BIBLE_TEXT_SQL,
  serializeBibleText,
  storeBibleTextSql,
  type BibleBookText,
} from '@gp/core';
import type { PendingMutation, SyncClient } from './client.ts';

/**
 * Stores a text locally and returns its hash and canonical JSON. The
 * `importBible` that names it can then be queued at once, online or not:
 * `BibleTextUploads` uploads the text before that mutation is pushed.
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

/**
 * Sends a text to the server (`PUT /bibles/{hash}`) and returns the HTTP
 * status. Throws when the server cannot be reached.
 */
export type BibleTextUpload = (hash: string, json: string) => Promise<number>;

/**
 * Uploads the text of every queued `importBible` before the mutation is
 * pushed, so a translation imported offline reaches the server with its text
 * (README, "Bibles"). Give `beforePush` to the SyncClient.
 *
 * An upload that cannot reach the server, or that fails on the server's side
 * (5xx), holds that import and every mutation after it back until the next
 * push; the ones before it go. One the server refuses (4xx) lets the import
 * go, to be refused with a reason the user sees. If the server still lacks
 * the text when the import arrives (`bible-text-missing`), `retryRefused`
 * queues the import once more, so its text is uploaded again.
 */
export class BibleTextUploads {
  /** Texts this session has uploaded. A restart uploads a queued one again; the server takes it twice. */
  private uploaded = new Set<string>();
  /** Queued imports this session has seen, by mutation id. */
  private imports = new Map<number, unknown>();
  /** Texts whose refused import has been queued again: once each. */
  private retried = new Set<string>();

  constructor(private upload: BibleTextUpload) {}

  beforePush = async (pending: PendingMutation[], client: SyncClient): Promise<number | undefined> => {
    for (const [i, m] of pending.entries()) {
      if (m.name !== 'importBible') continue;
      const args = JSON.parse(m.args) as { contentHash?: unknown };
      this.imports.set(m.id, args);
      const hash = String(args.contentHash);
      if (this.uploaded.has(hash)) continue;
      const json = await storedTextJson(client, hash);
      if (json === null) continue; // nothing to send: the server refuses the import
      let status: number;
      try {
        status = await this.upload(hash, json);
      } catch {
        return i; // unreachable: this import and what follows wait
      }
      if (status >= 500) return i;
      if (status < 300) this.uploaded.add(hash);
    }
    return undefined;
  };

  /**
   * Queues again, once, each import the server refused for lack of its text,
   * while this device still has it. Run before `syncBibleTexts`, which drops
   * texts no queued import names. Returns how many were queued.
   */
  async retryRefused(client: SyncClient): Promise<number> {
    let n = 0;
    for (const r of client.rejected) {
      const args = this.imports.get(r.id);
      if (r.error !== 'bible-text-missing' || args === undefined) continue;
      this.imports.delete(r.id);
      const hash = String((args as { contentHash?: unknown }).contentHash);
      if (this.retried.has(hash) || !(await hasBibleText(client, hash))) continue;
      this.retried.add(hash);
      this.uploaded.delete(hash);
      try {
        await client.mutate('importBible', args as never);
        n++;
      } catch {
        // No longer applies here (the limit, or no longer an admin): the refusal stands.
      }
    }
    return n;
  }
}

/** A stored text's canonical JSON, exactly as hashed, or null if this device lacks it. */
async function storedTextJson(client: SyncClient, hash: string): Promise<string | null> {
  if (!(await hasBibleText(client, hash))) return null;
  return joinBibleText((await client.query(LOAD_BIBLE_TEXT_SQL, [hash])) as { code: string; chunk: string }[]);
}
