// Videos kept whole on this device, for the presentations kept offline here (TODO.md "Video, and which
// files a device fetches"). A video can be 2 GB, more than a database row holds, so the file goes in the
// browser's private storage (OPFS), `videos/{hash}`, written as `{hash}.part` and renamed once its hash
// is checked; `video_files` records each one and how much of it is here, for the pages' progress. Run in
// the database worker, the one place with OPFS's synchronous file handles.
import { Sha256 } from '@gp/core';
import { videosToDrop, wantedVideos, type KeptVideo, type MediaPolicy, type SyncClient } from '@gp/sync/client';

const DIR = 'videos';
/** How often the progress is written while a video comes: every 8 MiB. */
const NOTE_EVERY = 8 * 1024 * 1024;

/** OPFS's synchronous file handle, as far as this needs it (in workers only). */
interface SyncHandle {
  read(buffer: Uint8Array, opts: { at: number }): number;
  write(buffer: Uint8Array, opts: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}
type FileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle>; move?(dir: FileSystemDirectoryHandle, name: string): Promise<void> };

async function folder(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
}

async function remove(dir: FileSystemDirectoryHandle, name: string) {
  await dir.removeEntry(name).catch(() => undefined);
}

export interface VideoKeeping {
  /** Videos made whole this time. */
  kept: string[];
  /** Video files dropped: no longer kept, and over the budget, or no longer anyone's. */
  dropped: string[];
}

/**
 * Fetches, a range at a time, the videos of the presentations kept offline that this device does not have
 * whole yet, going on from what an earlier try left; then drops the files nothing keeps, as cache within
 * `room` (what the blobs' cache left of the budget). `get` fetches the video from `offset` (HTTP Range).
 * `changed` is told after every step, for the progress the pages show.
 */
export async function keepVideos(
  client: SyncClient,
  policy: MediaPolicy,
  room: number,
  get: (hash: string, offset: number) => Promise<Response>,
  changed: () => void,
  now = Date.now,
  fetchMissing = true,
): Promise<VideoKeeping> {
  const result: VideoKeeping = { kept: [], dropped: [] };
  const wanted = await wantedVideos(client, policy);
  const dir = await folder();
  for (const v of fetchMissing ? wanted : []) {
    const [row] = (await client.query('SELECT received FROM video_files WHERE hash = ?', [v.hash])) as { received: number }[];
    if (row && Number(row.received) >= v.size) {
      await client.localWrite([{ sql: 'UPDATE video_files SET used_at = ? WHERE hash = ?', params: [now(), v.hash] }]);
      continue;
    }
    if (await fetchVideo(client, dir, v, get, changed, now)) result.kept.push(v.hash);
  }
  const files = ((await client.query('SELECT hash, size, received, used_at FROM video_files')) as { hash: string; size: number; received: number; used_at: number }[]).map(
    (r): KeptVideo => ({ hash: r.hash, size: Number(r.size), received: Number(r.received), usedAt: Number(r.used_at) }),
  );
  // A video nobody has any more (purged) goes whatever the budget.
  const known = new Set(((await client.query('SELECT hash FROM videos')) as { hash: string }[]).map((r) => r.hash));
  const drop = new Set([...files.filter((f) => !known.has(f.hash)).map((f) => f.hash), ...videosToDrop(files, new Set(wanted.map((v) => v.hash)), room)]);
  for (const hash of drop) {
    await remove(dir, hash);
    await remove(dir, `${hash}.part`);
    await client.localWrite([{ sql: 'DELETE FROM video_files WHERE hash = ?', params: [hash] }]);
    result.dropped.push(hash);
  }
  // Files no row names (a row lost to a reset): nothing can find them, so they go.
  const rows = new Set(files.map((f) => f.hash).filter((h) => !drop.has(h)));
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (!rows.has(name.replace(/\.part$/, ''))) await remove(dir, name);
  }
  if (drop.size) changed();
  return result;
}

/** Fetches one video into `{hash}.part`, from where it was, checks its hash and renames it. True when it is whole. */
async function fetchVideo(
  client: SyncClient,
  dir: FileSystemDirectoryHandle,
  v: { hash: string; size: number },
  get: (hash: string, offset: number) => Promise<Response>,
  changed: () => void,
  now: () => number,
): Promise<boolean> {
  const partName = `${v.hash}.part`;
  const handle = (await dir.getFileHandle(partName, { create: true })) as FileHandle;
  let file: SyncHandle;
  try {
    file = await handle.createSyncAccessHandle();
  } catch {
    return false; // another window of this device is fetching it
  }
  const note = async (received: number) => {
    // Never the whole size before the hash is checked: whole means checked.
    await client.localWrite([
      {
        sql: `INSERT INTO video_files (hash, size, received, used_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (hash) DO UPDATE SET size = excluded.size, received = excluded.received, used_at = excluded.used_at`,
        params: [v.hash, v.size, received, now()],
      },
    ]);
    changed();
  };
  let whole = false;
  try {
    // What an earlier try left is hashed again, so the hash covers the whole file.
    let hash = new Sha256();
    let at = Math.min(file.getSize(), v.size);
    file.truncate(at);
    const buffer = new Uint8Array(NOTE_EVERY);
    for (let read = 0; read < at; ) {
      const n = file.read(buffer.subarray(0, Math.min(buffer.length, at - read)), { at: read });
      if (n <= 0) break;
      hash.update(buffer.subarray(0, n));
      read += n;
    }
    await note(Math.min(at, v.size - 1));
    if (at < v.size) {
      const res = await get(v.hash, at);
      // A 200 for a range asked for means the server sent it all: start over.
      if (res.status === 200 && at > 0) {
        file.truncate(0);
        at = 0;
        hash = new Sha256();
      } else if (!res.ok) return false;
      const reader = res.body!.getReader();
      let noted = at;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        file.write(value, { at });
        hash.update(value);
        at += value.length;
        if (at - noted >= NOTE_EVERY) {
          await note(Math.min(at, v.size - 1));
          noted = at;
        }
      }
    }
    file.flush();
    if (at !== v.size || hash.hex() !== v.hash) {
      // Not this video: it goes, and is fetched again from the start next time.
      file.truncate(0);
      await note(0);
      return false;
    }
    whole = true;
  } catch {
    return false; // the network went: the next try goes on from here
  } finally {
    file.close();
  }
  if (!whole) return false;
  if (handle.move) await handle.move(dir, v.hash);
  else {
    // No rename here: copy it over, a part at a time (an older browser).
    const target = (await (await dir.getFileHandle(v.hash, { create: true })).createWritable()) as FileSystemWritableFileStream;
    await (await handle.getFile()).stream().pipeTo(target);
    await remove(dir, partName);
  }
  await note(v.size);
  return true;
}
