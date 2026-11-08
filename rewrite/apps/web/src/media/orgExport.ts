import {
  LEGACY_ENTRIES,
  LEGACY_FORMAT,
  LEGACY_TABLES,
  legacyBlobs,
  legacyRowsProblem,
  tableByName,
  utf8Encode,
  type LegacyManifest,
  type LegacyRows,
  type LegacyUser,
  type UserRow,
} from '@gp/core';
import { api, authHeaders } from '../auth/api.ts';
import type { ReadDb } from '../db/share.ts';
import { serverUrl } from '../server.ts';
import { zipBlob } from './zipBlob.ts';

// The organisation exported as a zip (Inställningar → Organisationen → Exportera; Lars, 2026-11-08), in the format the
// import reads (LEGACY_ENTRIES), so an organisation moves from one server to another: gp-test to apptest, a desktop
// host to the cloud. Its rows come from this device's database, which has all of them; its users, Bible texts and
// files from the server, a video too, whole. Nothing is changed anywhere.

export type OrgExportReason = 'download' | 'rows' | 'too-large';

export class OrgExportError extends Error {
  constructor(
    readonly reason: OrgExportReason,
    readonly detail = '',
  ) {
    super(reason);
  }
}

export interface OrgExportProgress {
  step: 'files' | 'zip';
  done: number;
  total: number;
}

/** At most this many downloads at a time. */
const PARALLEL = 4;

/** A file of the server's, as a Blob: a video is held by the browser, on disk where it is large, never in a buffer here. */
async function download(path: string, row: string): Promise<Blob> {
  const res = await fetch(serverUrl(path), { headers: authHeaders() }).catch(() => null);
  if (!res?.ok) throw new OrgExportError('download', `${row}: ${res ? `http-${res.status}` : 'offline'}`);
  return res.blob();
}

/** Every row of the tables the import writes, with exactly their columns. */
async function readRows(db: ReadDb): Promise<LegacyRows> {
  const entries = await Promise.all(
    LEGACY_TABLES.map(async (t) => [t, await db.query<LegacyRows[typeof t][number]>(`SELECT ${tableByName.get(t)!.columns.join(', ')} FROM ${t} ORDER BY id`)] as const),
  );
  return Object.fromEntries(entries) as LegacyRows;
}

/** The members with an address, as the import invites them; the Google subjects are the server's, never sent. */
async function readUsers(): Promise<LegacyUser[]> {
  const r = await api<UserRow[]>('GET', '/api/users');
  if (r.error) throw new OrgExportError('download', `users: ${r.error}`);
  return r.body.flatMap((u) => (u.email ? [{ name: u.name, email: u.email, role: u.role, google: [] }] : []));
}

/** `name` made fit for a file's name. */
const fileSafe = (name: string) => name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'organisation';

/** The zip's name: the organisation and the day. */
export function exportName(orgName: string, now = new Date()): string {
  return `gospel-presenter-${fileSafe(orgName)}-${now.toISOString().slice(0, 10)}.zip`;
}

/** The organisation as an export zip. */
export async function exportOrg(db: ReadDb, orgName: string, progress: (p: OrgExportProgress) => void): Promise<Blob> {
  const rows = await readRows(db);
  const problem = legacyRowsProblem(rows);
  if (problem) throw new OrgExportError('rows', problem);
  const users = await readUsers();

  const blobs = new Map(legacyBlobs(rows).named.map(([hash, row]) => [hash, row]));
  const texts = new Map(rows.bibles.map((b) => [String(b.content_hash), `bibles ${String(b.id)}`]));
  const wanted = [
    ...[...blobs].map(([hash, row]) => ({ name: LEGACY_ENTRIES.blob(hash), path: `/api/media/${hash}`, row })),
    ...[...texts].map(([hash, row]) => ({ name: LEGACY_ENTRIES.bible(hash), path: `/api/bibles/${hash}`, row })),
  ];
  const files: { name: string; data: Blob }[] = [];
  let done = 0;
  progress({ step: 'files', done, total: wanted.length });
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        files.push({ name: w.name, data: await download(w.path, w.row) });
        progress({ step: 'files', done: ++done, total: wanted.length });
      }
    }),
  );

  const counts: Record<string, number> = Object.fromEntries(LEGACY_TABLES.map((t) => [t, rows[t].length]));
  const manifest: LegacyManifest = { format: LEGACY_FORMAT, orgName, exportedAt: Date.now(), counts: { ...counts, users: users.length, blobs: blobs.size, bibleTexts: texts.size } };
  const json = (v: unknown) => new Blob([utf8Encode(JSON.stringify(v)) as BlobPart]);
  const entries = [
    { name: LEGACY_ENTRIES.manifest, data: json(manifest) },
    { name: LEGACY_ENTRIES.users, data: json(users) },
    ...LEGACY_TABLES.map((t) => ({ name: LEGACY_ENTRIES.rows(t), data: json(rows[t]) })),
    ...files.toSorted((a, b) => a.name.localeCompare(b.name)),
  ];
  progress({ step: 'zip', done: 0, total: entries.length });
  try {
    return await zipBlob(entries, (n) => progress({ step: 'zip', done: n, total: entries.length }));
  } catch (e) {
    throw e instanceof OrgExportError ? e : new OrgExportError('too-large');
  }
}
