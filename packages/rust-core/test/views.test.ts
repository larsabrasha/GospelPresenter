import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

/** An organisation's database in memory, migrated by the core, with a song of two parts, and its statements as the core asks for them. */
function org() {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[]) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
  db.exec(`INSERT INTO songs (id, name) VALUES ('s1', 'Härlig är jorden')`);
  db.exec(`INSERT INTO song_parts (id, song_id, sort, content) VALUES ('p1', 's1', 0, 'Första'), ('p2', 's1', 1, 'Andra')`);
  return { rows: async (sql: string, params: unknown[]) => all(sql, params) };
}

const songItem = { id: 'i1', type: 'song', title: 'Härlig är jorden', sourceId: 's1', arrangementId: null, content: null };

describe('RustCore.view', () => {
  it("answers a running order's slides by item id, read through the caller's statements", async () => {
    const { rows } = org();

    const slides = await nodeRustCore().view<Record<string, { slides: { text: string }[]; problem: string | null }>>('itemSlidesView', { items: [songItem] }, rows);

    expect(slides.i1!.slides.map((s) => s.text)).toEqual(['Första', 'Andra']);
  });

  it("says why an item has no slides when its song is gone", async () => {
    const { rows } = org();

    const slides = await nodeRustCore().view<Record<string, { problem: string }>>('itemSlidesView', { items: [{ ...songItem, sourceId: 'gone' }] }, rows);

    expect(slides.i1!.problem).toBe('song-missing');
  });

  it('throws the refusal of a view given what it cannot read', async () => {
    const { rows } = org();

    await expect(nodeRustCore().view('itemSlidesView', { items: 'none' }, rows)).rejects.toThrow('invalid-args');
  });
});

describe('RustCore.pure', () => {
  const order = [['i1', 2]];

  it("works out a key's effect at once, with no database", () => {
    const state = { presenting: true, shown: { itemId: 'i1', partIndex: 0, black: false }, picked: null };

    const next = nodeRustCore().pure<{ shown: unknown }>('presentingKeyView', { order, state, key: { type: 'step', delta: 1 } });

    expect(next.shown).toEqual({ itemId: 'i1', partIndex: 1, black: false });
  });

  it('marks the slide shown and the one shown next', () => {
    const marks = nodeRustCore().pure('slideMarksView', { order, shown: { itemId: 'i1', partIndex: 0, black: false } });

    expect(marks).toEqual({ shown: { itemId: 'i1', partIndex: 0 }, next: { itemId: 'i1', partIndex: 1 } });
  });

  it('refuses a view that reads the database', () => {
    expect(() => nodeRustCore().pure('itemSlidesView', { items: [songItem] })).toThrow('reads the database');
  });
});
