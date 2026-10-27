import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { MediaStorage } from './media.ts';

/**
 * A folder as media storage (D31): the default when self-hosted and in the
 * desktop app. A key is a path under `root`, `org/{org}/media/{hash}`, so
 * backing up is copying the folder. Keys come from `mediaKey`, which allows
 * no `.` or `/` in an organisation id; this refuses any key that would leave
 * the folder all the same.
 */
export function diskStorage(root: string): MediaStorage {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep) || key.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new Error('media key outside the folder');
    return path;
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
    delete: (key) => rm(pathOf(key), { force: true }),
  };
}
