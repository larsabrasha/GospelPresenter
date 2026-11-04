import {
  inflateRaw,
  LEGACY_ENTRIES,
  LEGACY_FORMAT,
  LEGACY_FORMATS_READ,
  LEGACY_TABLES,
  legacyManifestSchema,
  legacyUsersSchema,
  upgradeLegacyRows,
  utf8Decode,
  type LegacyManifest,
  type LegacyRows,
} from '@gp/core';
import { api, authHeaders } from '../auth/api.ts';
import { serverUrl } from '../server.ts';

// The import from 1.x in the web app (docs/import-from-1x.md): the export zip read a slice at a time, so an
// organisation's files never have to fit in memory; its blobs and Bible texts uploaded as an import uploads
// them, then its rows and its users sent to the server. Devices, this one too, pull the rows when poked.

interface Entry {
  name: string;
  read(): Promise<Uint8Array>;
}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);
const view = async (file: Blob, from: number, to: number) => new DataView(await file.slice(from, to).arrayBuffer());

/** The entries of a zip in `file`, from its central directory; stored and DEFLATE entries can be read. */
async function readZipFile(file: Blob): Promise<Map<string, Entry>> {
  const tailStart = Math.max(0, file.size - 22 - 65_535);
  const tail = await view(file, tailStart, file.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new LegacyImportError('not-zip');
  const count = u16(tail, end + 10);
  const dirStart = u32(tail, end + 16);
  const dir = await view(file, dirStart, dirStart + u32(tail, end + 12));
  const entries = new Map<string, Entry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (u32(dir, p) !== 0x02014b50) throw new LegacyImportError('not-zip');
    const method = u16(dir, p + 10);
    const compressed = u32(dir, p + 20);
    const nameLength = u16(dir, p + 28);
    const local = u32(dir, p + 42);
    const name = utf8Decode(new Uint8Array(dir.buffer, p + 46, nameLength));
    p += 46 + nameLength + u16(dir, p + 30) + u16(dir, p + 32);
    entries.set(name, {
      name,
      async read() {
        const head = await view(file, local, local + 30);
        const start = local + 30 + u16(head, 26) + u16(head, 28);
        const raw = new Uint8Array(await file.slice(start, start + compressed).arrayBuffer());
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new LegacyImportError('not-zip');
      },
    });
  }
  return entries;
}

export type LegacyImportReason = 'not-zip' | 'not-export' | 'format' | 'upload' | 'refused';

export class LegacyImportError extends Error {
  /** What the server said, when it said why: the admin can read which row or file stopped the import. */
  constructor(
    readonly reason: LegacyImportReason,
    readonly detail = '',
  ) {
    super(reason);
  }
}

/** The server's answer as a detail: its error and, when it names one, the row. */
const said = (r: { error: string | null; body: unknown }) => {
  const detail = (r.body as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && detail ? `${r.error}: ${detail}` : (r.error ?? '');
};

export interface LegacyProgress {
  step: 'files' | 'rows' | 'users';
  done: number;
  total: number;
}

export interface LegacyImportResult {
  manifest: LegacyManifest;
  /** What became of the users (`/api/import/users`). */
  users: { created: number; member: number; kept: number; limit: number };
}

const json = async (e: Entry | undefined) => {
  if (!e) throw new LegacyImportError('not-export');
  return JSON.parse(utf8Decode(await e.read())) as unknown;
};

/** At most this many uploads at a time. */
const PARALLEL = 4;

async function put(path: string, body: Uint8Array, contentType: string) {
  const res = await fetch(serverUrl(path), { method: 'PUT', headers: { 'content-type': contentType, ...authHeaders() }, body: body as BodyInit });
  if (!res.ok) throw new LegacyImportError('upload', `${path}: http-${res.status}`);
}

/** The manifest of an export zip, or why it is not one this build imports. */
export async function readLegacyManifest(file: Blob): Promise<LegacyManifest> {
  const parsed = legacyManifestSchema.safeParse(await json((await readZipFile(file)).get(LEGACY_ENTRIES.manifest)));
  if (!parsed.success) throw new LegacyImportError('not-export');
  if (!LEGACY_FORMATS_READ.includes(parsed.data.format)) throw new LegacyImportError('format');
  return parsed.data;
}

/**
 * The import, in the order that lets a failed one be run again: the users go first, as a second run keeps them as
 * they are; the rows go last, in one transaction, so an import is either done or not begun. The organisation keeps
 * what it has: a second run adds only what is new.
 */
export async function importLegacy(file: Blob, progress: (p: LegacyProgress) => void): Promise<LegacyImportResult> {
  const entries = await readZipFile(file);
  const manifest = await readLegacyManifest(file);
  // A zip of an older format lacks the tables added since (`slide_decks` before 3); the upgrade makes them.
  const tables = LEGACY_TABLES.filter((t) => manifest.format >= LEGACY_FORMAT || t !== 'slide_decks');
  const read = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await json(entries.get(LEGACY_ENTRIES.rows(t)))]))) as Omit<LegacyRows, 'slide_decks'>;
  const rows = upgradeLegacyRows(manifest.format, read);
  const users = legacyUsersSchema.safeParse(await json(entries.get(LEGACY_ENTRIES.users)));
  if (!users.success) throw new LegacyImportError('not-export');

  progress({ step: 'users', done: 0, total: users.data.length });
  const added = await api<LegacyImportResult['users']>('POST', '/api/import/users', users.data);
  if (added.error) throw new LegacyImportError('refused', said(added));

  const files = [...entries.values()].filter((e) => e.name.startsWith('blobs/') || e.name.startsWith('bibles/'));
  let done = 0;
  let failed = false;
  progress({ step: 'files', done, total: files.length });
  const queue = [...files];
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      // One failed upload stops the others: the import is then run again from the start.
      for (let e = queue.shift(); e && !failed; e = queue.shift()) {
        try {
          const bytes = await e.read();
          if (e.name.startsWith('blobs/')) await put(`/api/media/${e.name.slice('blobs/'.length)}`, bytes, 'application/octet-stream');
          else await put(`/api/bibles/${e.name.slice('bibles/'.length, -'.json'.length)}`, bytes, 'application/json');
        } catch (err) {
          failed = true;
          throw err;
        }
        progress({ step: 'files', done: ++done, total: files.length });
      }
    }),
  );

  progress({ step: 'rows', done: 0, total: 1 });
  const imported = await api('POST', '/api/import/legacy', rows);
  if (imported.error) throw new LegacyImportError('refused', said(imported));
  return { manifest, users: added.body };
}
