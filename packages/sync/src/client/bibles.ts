// Bible texts on a client (docs/bibles-and-themes.md, "Bibles"): a translation's verses are an
// immutable text named by its hash, kept in tables that do not sync. Only the
// `bibles` row syncs; this fetches the text of each translation the device
// keeps once and keeps it, and drops texts it no longer keeps. Which texts, and whether one fetched is what its hash
// names, the core says (crates/gp-core/src/bible_texts.rs: `bibleTextPlanView`, `bibleTextStoreView`,
// `bibleTextJsonView`, `bibleUploadsView`); this moves the texts.
import { bibleTextHash, LOAD_BIBLE_TEXT_SQL, serializeBibleText, storeBibleTextSql, type BibleBookText } from '@gp/core';
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
  /** Named by a kept translation, but the server did not have it or the download failed. */
  missing: string[];
  removed: number;
}

/**
 * Which texts a device keeps: 'all' on a desktop host, which serves the LAN
 * and must have every text; 'chosen' elsewhere, only those of the translations
 * in `kept_bibles` ("Tillgänglig offline"). The others are fetched when a page
 * needs them (`fetchBibleText`) and not stored.
 */
export type BibleKeeping = 'all' | 'chosen';

/** The statements that keep a text: a row a book, then the marker that it is whole (`storeBibleTextSql`). */
export type BibleTextStore = { sql: string; params: unknown[] }[];

/**
 * Removes the texts no kept translation names (keeping any a queued `importBible` names), then downloads every
 * text a kept translation names that this device lacks, as the core's `bibleTextPlanView` says. `download` returns
 * the text's JSON, or null if the server has none. Callers serialise this with their own imports.
 */
export async function syncBibleTexts(
  client: SyncClient,
  download: (hash: string) => Promise<string | null>,
  keeping: BibleKeeping = 'all',
): Promise<BibleTextSync> {
  const result: BibleTextSync = { downloaded: [], missing: [], removed: 0 };
  const plan = await client.view<{ fetch: string[]; drop: string[] }>('bibleTextPlanView', { keeping });
  if (plan.drop.length) {
    await client.localWrite(
      plan.drop.flatMap((h) => [
        { sql: 'DELETE FROM bible_texts WHERE hash = ?', params: [h] },
        { sql: 'DELETE FROM bible_blobs WHERE hash = ?', params: [h] },
      ]),
    );
  }
  for (const hash of plan.fetch) {
    const store = await fetchBibleText(client, download, hash);
    if (!store) {
      result.missing.push(hash);
      continue;
    }
    await client.localWrite(store);
    result.downloaded.push(hash);
  }
  result.removed = plan.drop.length;
  return result;
}

/** Keeps a translation's text on this device, or stops doing so ("Tillgänglig offline"). Run `syncBibleTexts` after. */
export async function setBibleKept(client: SyncClient, bibleId: string, on: boolean, now = Date.now()): Promise<void> {
  await client.localWrite([
    on
      ? { sql: 'INSERT INTO kept_bibles (id, kept_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING', params: [bibleId, now] }
      : { sql: 'DELETE FROM kept_bibles WHERE id = ?', params: [bibleId] },
  ]);
}

/**
 * "Gör tillgänglig offline": keeps the translation and downloads its text
 * now. If the text cannot be had (offline, or the server lacks it), the
 * choice is taken back and this returns false, as the current app's download.
 */
export async function keepBible(client: SyncClient, bibleId: string, download: (hash: string) => Promise<string | null>): Promise<boolean> {
  await setBibleKept(client, bibleId, true);
  await syncBibleTexts(client, download, 'chosen');
  const stored = await client.query('SELECT 1 FROM bibles b JOIN bible_blobs t ON t.hash = b.content_hash WHERE b.id = ?', [bibleId]);
  if (stored.length) return true;
  await setBibleKept(client, bibleId, false);
  return false;
}

/**
 * Removes the device's copy of a translation's text ("Ta bort den nedladdade
 * kopian"). A text a queued import still names stays until it is uploaded.
 */
export async function dropBible(client: SyncClient, bibleId: string, download: (hash: string) => Promise<string | null>): Promise<void> {
  await setBibleKept(client, bibleId, false);
  await syncBibleTexts(client, download, 'chosen');
}

/**
 * A text fetched with `download` and checked by the core against its hash (`bibleTextStoreView`), as the statements
 * that keep it; not run here: what a page uses for a translation this device does not keep. Null if it cannot be had.
 */
export async function fetchBibleText(client: SyncClient, download: (hash: string) => Promise<string | null>, hash: string): Promise<BibleTextStore | null> {
  let json: string | null = null;
  try {
    json = await download(hash);
  } catch {
    json = null;
  }
  return json === null ? null : (await client.view<{ store: BibleTextStore | null }>('bibleTextStoreView', { hash, json })).store;
}

/**
 * Sends a text to the server (`PUT /bibles/{hash}`) and returns the HTTP
 * status. Throws when the server cannot be reached.
 */
export type BibleTextUpload = (hash: string, json: string) => Promise<number>;

/**
 * Uploads the text of every queued `importBible` before the mutation is
 * pushed, so a translation imported offline reaches the server with its text
 * (docs/bibles-and-themes.md, "Bibles"). Give `beforePush` to the SyncClient.
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
    // Each queued import, in order, with its place in the queue (`bibleUploadsView`); only those of the changes this
    // push was given: one queued since is not in `pending`, and its place is beyond it.
    type Upload = { index: number; id: number; args: unknown; hash: string; uploaded: boolean };
    const { uploads } = await client.view<{ uploads: Upload[] }>('bibleUploadsView', { uploaded: [...this.uploaded] });
    for (const u of uploads.filter((x) => x.index < pending.length)) {
      this.imports.set(u.id, u.args);
      if (u.uploaded || this.uploaded.has(u.hash)) continue;
      const { json } = await client.view<{ json: string | null }>('bibleTextJsonView', { hash: u.hash });
      if (json === null) continue; // nothing to send: the server refuses the import
      let status: number;
      try {
        status = await this.upload(u.hash, json);
      } catch {
        return u.index; // unreachable: this import and what follows wait
      }
      if (status >= 500) return u.index;
      if (status < 300) this.uploaded.add(u.hash);
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
