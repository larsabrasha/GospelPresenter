// The nightly backup of a server on its own (the Docker image, docs/self-hosting.md "Backups"), made while it runs
// (Lars, 2026-11-25: no stopping the container). Each night is a folder `{backups}/{YYYY-MM-DD}`: every database copied
// with SQLite's VACUUM INTO, which reads one consistent state beside the server's own connection (WAL), and the files as
// hard links. A file is named by its hash and never written again, so a link is the file without its space, and it
// stays when the app later removes the original. Then the nights backup-retention.ts no longer keeps are removed.
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDay, keptBackups } from './backup-retention.ts';

/** The server's databases in its data folder (node.ts): the global one and one per organisation. */
const DATABASE = /^(global|org-.+)\.sqlite$/;
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

export interface NodeBackup {
  /** The night's folder's name. */
  day: string;
  /** Whether this call made it: false when the night had one already. */
  made: boolean;
  /** The nights removed by the thinning. */
  removed: string[];
}

/** Tonight's backup of `dataDir` into `backupDir`, unless there is one, then the thinning. */
export function backupDataDir(dataDir: string, backupDir: string, now = new Date()): NodeBackup {
  const day = backupDay(now);
  const night = join(backupDir, day);
  const made = !existsSync(night);
  if (made) {
    // Made under another name and renamed when whole, so a night that is there is a whole one.
    const partial = `${night}.partial`;
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    for (const name of readdirSync(dataDir)) if (DATABASE.test(name)) copyDatabase(join(dataDir, name), join(partial, name));
    linkTree(join(dataDir, 'media'), join(partial, 'media'));
    renameSync(partial, night);
  }
  const nights = readdirSync(backupDir).filter((n) => NIGHT.test(n));
  const kept = keptBackups(nights, day);
  const removed = nights.filter((n) => !kept.has(n));
  for (const n of removed) rmSync(join(backupDir, n), { recursive: true, force: true });
  return { day, made, removed };
}

/** One consistent copy of a database the server has open: a reader, which waits for no writer. */
function copyDatabase(from: string, to: string) {
  const db = new DatabaseSync(from, { readOnly: true, timeout: 10_000 });
  try {
    db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}

/** Every file under `from` as a hard link under `to`; a copy where a link cannot be made (another file system). */
function linkTree(from: string, to: string) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const [source, target] = [join(from, entry.name), join(to, entry.name)];
    if (entry.isDirectory()) linkTree(source, target);
    else if (entry.isFile()) {
      try {
        linkSync(source, target);
      } catch {
        copyFileSync(source, target);
      }
    }
  }
}
