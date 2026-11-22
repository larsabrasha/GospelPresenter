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

describe('presentationMaterialsView', () => {
  /** A presentation with `songs` (song ids) in its running order, and materials on s1 and s2. */
  function withMaterials(songs: string[]) {
    const db = new DatabaseSync(':memory:');
    const all = (sql: string, params: unknown[]) => {
      const st = db.prepare(sql);
      st.setReturnArrays(true);
      return st.all(...(params as never[])) as unknown as Rows;
    };
    nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
    db.exec(`INSERT INTO songs (id, name) VALUES ('s1', 'Ett'), ('s2', 'Två'), ('s3', 'Tre')`);
    db.exec(`INSERT INTO presentations (id, name) VALUES ('p1', 'Söndag')`);
    songs.forEach((s, i) => db.exec(`INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort) VALUES ('i${i}', 'p1', 'song', 'Sång ${s}', '${s}', ${i})`));
    db.exec(`INSERT INTO song_materials (id, song_id, sort, kind, title, url, created_at) VALUES ('m1', 's1', 0, 'link', 'Spotify', 'https://x', 1), ('m2', 's2', 0, 'link', 'Noter', 'https://y', 1)`);
    return async (sql: string, params: unknown[]) => all(sql, params);
  }
  type Answer = { songs: { songId: string; title: string; materials: { id: string }[] }[]; empty: string | null };

  it("lists the songs' materials in the running order", async () => {
    const out = await nodeRustCore().view<Answer>('presentationMaterialsView', { presentationId: 'p1' }, withMaterials(['s2', 's1']));

    expect(out.songs.map((s) => s.songId)).toEqual(['s2', 's1']);
  });

  it('lists a song twice in the order once, where it first comes', async () => {
    const out = await nodeRustCore().view<Answer>('presentationMaterialsView', { presentationId: 'p1' }, withMaterials(['s1', 's2', 's1']));

    expect(out.songs.map((s) => s.title)).toEqual(['Sång s1', 'Sång s2']);
  });

  it('leaves out a song without materials', async () => {
    const out = await nodeRustCore().view<Answer>('presentationMaterialsView', { presentationId: 'p1' }, withMaterials(['s3', 's1']));

    expect(out.songs.map((s) => s.songId)).toEqual(['s1']);
  });

  it('says so when no song has any', async () => {
    const out = await nodeRustCore().view<Answer>('presentationMaterialsView', { presentationId: 'p1' }, withMaterials(['s3']));

    expect(out).toEqual({ songs: [], empty: 'material.presentationEmpty' });
  });
});

describe('templatesView', () => {
  /** Twelve templates, t0 to t11, used at their number's time except t5 and t6, never used. */
  function templates() {
    const db = new DatabaseSync(':memory:');
    const all = (sql: string, params: unknown[]) => {
      const st = db.prepare(sql);
      st.setReturnArrays(true);
      return st.all(...(params as never[])) as unknown as Rows;
    };
    nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
    for (let i = 0; i < 12; i++) {
      const used = i === 5 || i === 6 ? 'NULL' : String(i * 1000);
      db.exec(`INSERT INTO presentations (id, name, is_template, last_used_at, updated_at) VALUES ('t${i}', 'Mall ${i}', 1, ${used}, ${i})`);
    }
    return async (sql: string, params: unknown[]) => all(sql, params);
  }

  it('offers the picker the ten last used, never-used ones last', async () => {
    const out = await nodeRustCore().view<{ id: string }[]>('templatesView', { locale: 'sv', recent: true }, templates());

    expect(out.map((t) => t.id)).toEqual(['t11', 't10', 't9', 't8', 't7', 't4', 't3', 't2', 't1', 't0']);
  });

  it('lists every template, last changed first, without recent', async () => {
    const out = await nodeRustCore().view<{ id: string }[]>('templatesView', { locale: 'sv' }, templates());

    expect(out).toHaveLength(12);
    expect(out[0]!.id).toBe('t11');
  });
});

describe('paletteView', () => {
  /** Presentations around 2026-11-22: two coming, two past, one undated. */
  function presentations() {
    const db = new DatabaseSync(':memory:');
    const all = (sql: string, params: unknown[]) => {
      const st = db.prepare(sql);
      st.setReturnArrays(true);
      return st.all(...(params as never[])) as unknown as Rows;
    };
    nodeRustCore().runSync('migrateOrgSchema', {}, undefined, all);
    db.exec(`INSERT INTO presentations (id, name, event_date, location) VALUES
      ('past', 'Gudstjänst', '2026-11-15', NULL), ('older', 'Gudstjänst', '2026-11-01', NULL),
      ('soon', 'Gudstjänst', '2026-11-22', 'Kyrkan'), ('later', 'Kvällsmöte', '2026-11-29', NULL), ('none', 'Utkast', NULL, NULL)`);
    return async (sql: string, params: unknown[]) => all(sql, params);
  }
  type Found = { presentations: { id: string }[] };

  it('finds the coming first, soonest first, then the past, latest first', async () => {
    const out = await nodeRustCore().view<Found>('paletteView', { query: 'gudstjänst', today: '2026-11-22' }, presentations());

    expect(out.presentations.map((p) => p.id)).toEqual(['soon', 'past', 'older']);
  });

  it('finds a presentation by its place', async () => {
    const out = await nodeRustCore().view<Found>('paletteView', { query: 'kyrk', today: '2026-11-22' }, presentations());

    expect(out.presentations.map((p) => p.id)).toEqual(['soon']);
  });

  it('finds a presentation by its date as the shell writes it', async () => {
    const out = await nodeRustCore().view<Found>('paletteView', { query: '29 nov', today: '2026-11-22', labels: { later: 'sön 29 november' } }, presentations());

    expect(out.presentations.map((p) => p.id)).toEqual(['later']);
  });

  it('offers three with nothing typed, the coming first', async () => {
    const out = await nodeRustCore().view<Found>('paletteView', { query: '', today: '2026-11-22' }, presentations());

    expect(out.presentations.map((p) => p.id)).toEqual(['soon', 'later', 'past']);
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
