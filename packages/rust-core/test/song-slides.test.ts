// A song item's slides, read through the core's itemSlidesView (crates/gp-core/src/slides.rs): one per arranged part,
// labels and credits (SONG-R18, R19). They were packages/core's TS tests of songSlides until the core took it over.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

type Slide = { key: string; text: string; label: { text: string } | null; credits: string | null };

/** A database with the song S, its parts V1, C and V2 in that order, another song, and `extra` statements. */
function song(extra: string[] = [], who = `'A. Author', 'Pub', 1999`) {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, rows);
  db.exec(`INSERT INTO songs (id, name, author, publisher, year) VALUES ('S', 'Song', ${who}), ('other', 'Another', NULL, NULL, NULL)`);
  db.exec(`INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES ('V1', 'S', 0, NULL, 'V1'), ('C', 'S', 1, NULL, 'C'), ('V2', 'S', 2, NULL, 'V2')`);
  for (const s of extra) db.exec(s);
  return async (arrangementId: string | null = null) => {
    const item = { id: 'i', type: 'song', title: 'Song', sourceId: 'S', arrangementId, content: null };
    return (await core.view<Record<string, { slides: Slide[] }>>('itemSlidesView', { items: [item] }, async (sql, params) => rows(sql, params))).i!.slides;
  };
}
const arrangement = (id: string, sort: number, ids: string[], songId = 'S') => `INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES ('${id}', '${songId}', NULL, '${JSON.stringify(ids)}', ${sort})`;

describe('song slides', () => {
  it('credits drop missing pieces and are null when there are none', async () => {
    const credits = async (who: string) => (await song([], who)())[0]!.credits;

    expect([await credits(`'A. Author', 'Pub', 1999`), await credits(`NULL, 'Pub', NULL`), await credits(`' ', NULL, 0`)]).toEqual(['A. Author · © Pub · 1999', '© Pub', null]);
  });

  it('one slide per part, in part order, with the label', async () => {
    const slides = await song([`INSERT INTO labels (id, text, color, sort) VALUES ('label:verse', 'Verse', '#3478c7', 0)`, `UPDATE song_parts SET label_id = 'label:verse' WHERE id = 'V1'`])();

    expect(slides.map((s) => [s.key, s.label?.text ?? null])).toEqual([['V1', 'Verse'], ['C', null], ['V2', null]]);
  });
});

describe('arrangements (SONG-R18, R19)', () => {
  const keys = async (extra: string[], item: string | null = null) => (await song(extra)(item)).map((s) => s.key);

  it('no arrangement: all parts in part order', async () => {
    expect(await keys([])).toEqual(['V1', 'C', 'V2']);
  });

  it("the item's arrangement wins, else the song's first (by sort), with repeats kept and deleted parts skipped", async () => {
    const arrangements = [arrangement('B', 1, ['V2']), arrangement('A', 0, ['V1', 'C', 'V2', 'C', 'GONE']), arrangement('X', 0, ['V1'], 'other')];

    expect([await keys(arrangements), await keys(arrangements, 'B')]).toEqual([['V1', 'C', 'V2', 'C#1'], ['V2']]);
  });

  it("an arrangement id that is not one of the song's shows all parts", async () => {
    expect([await keys([arrangement('A', 0, ['C'])], 'DELETED'), await keys([arrangement('X', 0, ['V1'], 'other')], 'X')]).toEqual([['V1', 'C', 'V2'], ['V1', 'C', 'V2']]);
  });

  it('a repeated part gets a slide key of its own', async () => {
    expect(await keys([arrangement('A', 0, ['C', 'V1', 'C'])])).toEqual(['C', 'V1', 'C#1']);
  });
});
