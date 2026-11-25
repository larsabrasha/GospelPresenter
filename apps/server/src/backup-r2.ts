// The nightly backup on Cloudflare (docs/cloudflare.md, "Backups"; Lars, 2026-11-25): each organisation's rows, its
// users and Bible texts, and its files, in a bucket of their own (BACKUPS), thinned as backup-retention.ts keeps them.
// A night is one JSON file shaped as the export zip (orgExport.ts), small; each file is kept once, by its hash, for as
// long as a kept night names it, so a year of nights costs about one copy of the files. `scripts/backup-zip.mjs` turns a
// night back into a zip that Importera reads.
//
// Under `orgs/{org}/`: `nights/{YYYY-MM-DD}.json`, `files/{hash}`, `bibles/{hash}.json`, and `index.json`, which names
// the nights and what each needs, so a run reads one object to know them all. Copying a file costs a read and a write,
// and a Worker may make only so many of those a run (50 on the free plan): a run copies at most `budget` files and the
// next run, an hour later, goes on.
import { joinBibleText, LEGACY_FORMAT, LOAD_BIBLE_TEXT_SQL, mediaKey, type LegacyRows, type LegacyUser } from '@gp/core';
import { legacyBlobs } from '@gp/core/core';
import type { OrgStore } from '@gp/sync/server';
import { backupDay, keptBackups } from './backup-retention.ts';

/** What of R2's binding the backup uses. */
export interface BackupBucket {
  get(key: string): Promise<{ body: ReadableStream; text(): Promise<string>; httpMetadata?: unknown } | null>;
  put(key: string, value: string | ReadableStream, options?: { httpMetadata?: unknown }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/** A night as the index names it: what it needs kept. */
interface NightNeeds {
  blobs: string[];
  bibles: string[];
}
/** The nights, and the files found gone from the organisation, never tried again. */
type BackupIndex = { nights: Record<string, NightNeeds>; gone?: string[] };

/** One night: the export zip's manifest, users and rows, in one file. */
export interface BackupNight {
  format: number;
  orgName: string;
  exportedAt: number;
  users: LegacyUser[];
  rows: LegacyRows;
  blobs: string[];
  bibles: string[];
}

export interface OrgBackupReport {
  day: string;
  /** Whether this run wrote tonight's night. */
  made: boolean;
  /** The nights the thinning removed. */
  removed: string[];
  copied: number;
  /** Files still to copy, by the next runs. */
  waiting: number;
  /** Files a night names that the organisation no longer had, found this run: never tried again. */
  gone: string[];
}

/** An organisation's rows and Bible texts, read in its own queue. */
export function orgContent(store: OrgStore): Promise<{ rows: LegacyRows; bibleText: (hash: string) => string }> {
  return store.core.view<string>('exportRowsView', {}, (sql, params) => store.rows(sql, params)).then((json) => ({
    rows: JSON.parse(json) as LegacyRows,
    bibleText: (hash) => joinBibleText(store.query(LOAD_BIBLE_TEXT_SQL, [hash]) as { code: string; chunk: string }[]),
  }));
}

/** Every key under `prefix`, page by page. */
async function keys(bucket: BackupBucket, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    out.push(...page.objects.map((o) => o.key.slice(prefix.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Removes keys, a thousand a call, as R2 takes them. */
async function remove(bucket: BackupBucket, all: string[]) {
  for (let at = 0; at < all.length; at += 1000) await bucket.delete(all.slice(at, at + 1000));
}

/** Tonight's backup of one organisation, unless it has one, then the thinning and as many files as the budget allows. */
export async function backupOrg(a: {
  orgId: string;
  orgName: string;
  users: LegacyUser[];
  read: () => Promise<{ rows: LegacyRows; bibleText: (hash: string) => string }>;
  media: BackupBucket;
  backups: BackupBucket;
  now?: Date;
  budget: number;
}): Promise<OrgBackupReport> {
  const day = backupDay(a.now ?? new Date());
  const at = `orgs/${a.orgId}/`;
  const stored = await a.backups.get(`${at}index.json`);
  const index: BackupIndex = stored ? (JSON.parse(await stored.text()) as BackupIndex) : { nights: {} };
  const was = stored ? JSON.stringify(index) : '';
  const made = !index.nights[day];
  if (made) {
    const content = await a.read();
    const blobs = [...new Set(legacyBlobs(content.rows).named.map(([hash]) => hash))];
    const bibles = [...new Set(content.rows.bibles.map((b) => String(b.content_hash)))];
    const have = new Set(await keys(a.backups, `${at}bibles/`));
    for (const hash of bibles) if (!have.has(`${hash}.json`)) await a.backups.put(`${at}bibles/${hash}.json`, content.bibleText(hash));
    const night: BackupNight = { format: LEGACY_FORMAT, orgName: a.orgName, exportedAt: Date.now(), users: a.users, rows: content.rows, blobs, bibles };
    await a.backups.put(`${at}nights/${day}.json`, JSON.stringify(night));
    index.nights[day] = { blobs, bibles };
  }
  const kept = keptBackups(Object.keys(index.nights), day);
  const removed = Object.keys(index.nights).filter((d) => !kept.has(d));
  for (const d of removed) delete index.nights[d];

  const needs = Object.values(index.nights);
  const blobs = new Set(needs.flatMap((n) => n.blobs));
  const bibles = new Set(needs.flatMap((n) => n.bibles.map((h) => `${h}.json`)));
  const known = new Set((index.gone ?? []).filter((h) => blobs.has(h)));
  const present = new Set(await keys(a.backups, `${at}files/`));
  const missing = [...blobs].filter((h) => !present.has(h) && !known.has(h));
  let copied = 0;
  const gone: string[] = [];
  for (const hash of missing.slice(0, a.budget)) {
    const file = await a.media.get(mediaKey(a.orgId, hash));
    if (!file) gone.push(hash);
    else {
      await a.backups.put(`${at}files/${hash}`, file.body, { httpMetadata: file.httpMetadata });
      copied++;
    }
  }
  index.gone = [...known, ...gone];
  // The index before the nights it no longer names go: a night is never named without being there.
  if (JSON.stringify(index) !== was) await a.backups.put(`${at}index.json`, JSON.stringify(index));
  await remove(a.backups, removed.map((d) => `${at}nights/${d}.json`));
  await remove(a.backups, [...present].filter((h) => !blobs.has(h)).map((h) => `${at}files/${h}`));
  await remove(a.backups, (await keys(a.backups, `${at}bibles/`)).filter((k) => !bibles.has(k)).map((k) => `${at}bibles/${k}`));
  return { day, made, removed, copied, waiting: missing.length - copied - gone.length, gone };
}
