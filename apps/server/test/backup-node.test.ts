// The nightly backup of a server on its own (backup-node.ts): made while the databases are open, files as links,
// once a night, thinned.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDataDir } from '../src/backup-node.ts';

const NOW = new Date('2026-11-25T03:00:00Z');

describe('the nightly backup of a data folder', () => {
  let root: string;
  let data: string;
  let backups: string;
  let open: DatabaseSync[];

  /** A database as the server keeps one: WAL, still open, with a row written after its last checkpoint. */
  function database(name: string, title: string) {
    const db = new DatabaseSync(join(data, name));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT)');
    db.prepare('INSERT INTO songs VALUES (?, ?)').run('s1', title);
    open.push(db);
  }

  const titleIn = (file: string) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT title FROM songs').get()?.title;
    } finally {
      db.close();
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gp-backup-'));
    data = join(root, 'data');
    backups = join(data, 'backups');
    mkdirSync(join(data, 'media', 'org', 'o1', 'media'), { recursive: true });
    open = [];
  });

  afterEach(() => {
    for (const db of open) db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('copies every database while the server has it open, with what it last wrote', () => {
    database('global.sqlite', 'global');
    database('org-o1.sqlite', 'Härlig är jorden');

    const r = backupDataDir(data, backups, NOW);

    expect(r).toEqual({ day: '2026-11-25', made: true, removed: [] });
    expect(titleIn(join(backups, '2026-11-25', 'global.sqlite'))).toBe('global');
    expect(titleIn(join(backups, '2026-11-25', 'org-o1.sqlite'))).toBe('Härlig är jorden');
  });

  it('keeps each file as a hard link, so it takes no space and outlives the original', () => {
    const file = join(data, 'media', 'org', 'o1', 'media', 'a'.repeat(64));
    writeFileSync(file, 'picture');

    backupDataDir(data, backups, NOW);
    rmSync(file);

    const kept = join(backups, '2026-11-25', 'media', 'org', 'o1', 'media', 'a'.repeat(64));
    expect(existsSync(kept)).toBe(true);
    expect(statSync(kept).nlink).toBe(1);
  });

  it('makes one backup a night', () => {
    database('global.sqlite', 'first');
    backupDataDir(data, backups, NOW);
    open[0]!.prepare('UPDATE songs SET title = ?').run('second');

    const r = backupDataDir(data, backups, new Date('2026-11-25T22:00:00Z'));

    expect(r.made).toBe(false);
    expect(titleIn(join(backups, '2026-11-25', 'global.sqlite'))).toBe('first');
  });

  it('removes the nights the thinning no longer keeps, and leaves what it did not make', () => {
    for (const night of ['2026-11-20', '2026-10-27', '2026-10-26', '2025-01-01', 'mine']) mkdirSync(join(backups, night), { recursive: true });

    const r = backupDataDir(data, backups, NOW);

    expect(r.removed.toSorted()).toEqual(['2025-01-01', '2026-10-26']);
    expect(readdirSync(backups).toSorted()).toEqual(['2026-10-27', '2026-11-20', '2026-11-25', 'mine']);
  });

  it('starts again over a night left half made', () => {
    mkdirSync(join(backups, '2026-11-25.partial', 'stale'), { recursive: true });
    database('global.sqlite', 'global');

    backupDataDir(data, backups, NOW);

    expect(existsSync(join(backups, '2026-11-25.partial'))).toBe(false);
    expect(readdirSync(join(backups, '2026-11-25')).toSorted()).toEqual(['global.sqlite', 'media']);
  });
});
