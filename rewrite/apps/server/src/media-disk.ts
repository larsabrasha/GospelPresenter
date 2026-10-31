import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { MediaStorage } from './media.ts';

/**
 * A folder as media storage (D31): the default when self-hosted and in the
 * desktop app. A key is a path under `root`, `org/{org}/media/{hash}`, so
 * backing up is copying the folder. Keys come from `mediaKey`, which allows
 * no `.` or `/` in an organisation id; this refuses any key that would leave
 * the folder all the same. An upload in parts is a file beside the key,
 * written part by part at its offset, and renamed onto the key when finished.
 */
export function diskStorage(root: string): MediaStorage {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep) || key.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new Error('media key outside the folder');
    return path;
  };
  // The upload id is made here, so it is safe in a file name; it is checked all the same.
  const uploadPath = (key: string, uploadId: string) => {
    if (!/^[0-9a-z]{1,40}$/.test(uploadId)) throw new Error('not an upload id');
    return join(dirname(pathOf(key)), `.${uploadId}.upload`);
  };
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Written beside it and renamed, so a reader never sees half a file.
      const temp = join(dirname(path), `.${Math.random().toString(36).slice(2)}.tmp`);
      try {
        await writeFile(temp, bytes);
        await rename(temp, path);
      } catch (e) {
        await rm(temp, { force: true });
        throw e;
      }
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async read(key, range) {
      const path = pathOf(key);
      // Opened first, so a missing file is a null rather than an error inside the stream.
      const file = await open(path).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (!file) return null;
      if (range && range.length <= 0) {
        await file.close();
        return new Blob([]).stream();
      }
      // The handle's own stream closes the handle when it ends or fails.
      const stream = file.createReadStream(range ? { start: range.offset, end: range.offset + range.length - 1 } : {});
      return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    },
    delete: (key) => rm(pathOf(key), { force: true }),
    async startUpload(key) {
      const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const path = uploadPath(key, uploadId);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array());
      return uploadId;
    },
    async putPart(key, uploadId, _part, offset, bytes) {
      const file = await open(uploadPath(key, uploadId), 'r+');
      try {
        await file.write(bytes, 0, bytes.length, offset);
      } finally {
        await file.close();
      }
      return '';
    },
    finishUpload: (key, uploadId) => rename(uploadPath(key, uploadId), pathOf(key)),
    abortUpload: (key, uploadId) => rm(uploadPath(key, uploadId), { force: true }),
  };
}
