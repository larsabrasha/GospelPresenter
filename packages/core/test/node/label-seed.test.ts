import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, labelId, labelSeedSql } from '@gp/core';

// The default labels the server writes when it opens an organisation's database (SONG-R47).

const require = createRequire(import.meta.url);

function db() {
  const { DatabaseSync: Db } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  const d = new Db(':memory:');
  d.exec('CREATE TABLE labels (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL)');
  const seed = () => labelSeedSql.forEach((s) => d.exec(s));
  const texts = () => (d.prepare('SELECT text FROM labels ORDER BY sort, text').all() as { text: string }[]).map((r) => r.text);
  return { d, seed, texts };
}

describe('the default labels', () => {
  it('are written in order when the database has none', () => {
    const { seed, texts } = db();

    seed();

    expect(texts()).toEqual(DEFAULT_LABELS.map((l) => l.text));
  });

  it('do not come back once deleted, when the server opens the database again', () => {
    const { d, seed, texts } = db();
    seed();
    d.prepare('DELETE FROM labels WHERE id = ?').run(labelId('Vamp'));

    seed();

    expect(texts()).not.toContain('Vamp');
  });

  it('leave alone a label that already has the text, in another case', () => {
    const { d, seed } = db();
    d.prepare('INSERT INTO labels (id, text, color, sort) VALUES (?, ?, ?, ?)').run('own', 'chorus', '#123456', 0);

    seed();

    expect(d.prepare(`SELECT id, color FROM labels WHERE lower(text) = 'chorus'`).all()).toEqual([{ id: 'own', color: '#123456' }]);
  });
});
