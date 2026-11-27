// The views' reads of stored rows that had two rules and have one now (step 5, round 6,
// docs/core-back-to-typescript.md): a slideshow's pages checked wherever they are read, a video's type and codec as
// Video lists them, an own theme read alike by every view, the blobs a queued change names and the running order.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CLASSIC, type Theme } from '@gp/core';
import { Core, type Rows } from '../../src/core.ts';

/** An organisation's database in memory, migrated by the core, with the sync client's queue, and its statements. */
function org() {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[]) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  new Core().runSync('migrateOrgSchema', all);
  db.exec('CREATE TABLE _mutation (id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)');
  return { db, rows: async (sql: string, params: unknown[]) => all(sql, params) };
}

const [full, thumb] = ['a'.repeat(64), 'b'.repeat(64)];
/** A page with a picture behind it and a text whose size is under the least (10): a page that does not check. */
// Broken as a page, not by an element: an element that does not read is left out and its page kept (custom-slides.ts).
const brokenPage = { background: 'red', backgroundPicture: { full, thumb }, backgroundPage: null, elements: [] };
const item = (type: string, sourceId: string) => ({ id: 'i1', type, title: 'Punkt', sourceId, arrangementId: null, content: null });
type Shown = Record<string, { slides: Record<string, unknown>[]; video?: Record<string, unknown> }>;

describe("a slideshow item's slides", () => {
  it('shows pages that do not check as one blank page, as Bildspel lists them', async () => {
    const { db, rows } = org();
    db.prepare("INSERT INTO custom_slides (id, name, pages, created_at, updated_at) VALUES ('c1', 'Predikan', ?, 0, 0)").run(JSON.stringify([brokenPage, brokenPage]));

    const shown = await new Core().view<Shown>('itemSlidesView', { items: [item('custom', 'c1')] }, rows);

    expect(shown.i1!.slides.map((s) => s.custom)).toEqual([{ background: null, backgroundPicture: null, backgroundPage: null, elements: [] }]);
  });
});

describe("a video item's slide", () => {
  it("reads a type and a codec it does not know as Video lists them, mp4 and h264", async () => {
    const { db, rows } = org();
    db.exec(`INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at)
             VALUES ('v1', 'a.webm', 'video/webm', 'vp9', '${full}', 1, 1, 1, 1, '${full}', '${thumb}', 0)`);

    const shown = await new Core().view<Shown>('itemSlidesView', { items: [item('video', 'v1')] }, rows);

    expect([shown.i1!.slides[0]!.video, shown.i1!.video?.contentType]).toEqual([{ hash: full, type: 'video/mp4', codec: 'h264' }, 'video/mp4']);
  });
});

describe('an own theme', () => {
  /** The theme `own-1` of `definition` and `sort`, as the view `name` reads it. */
  const ownTheme = async (name: 'themeView' | 'ownThemeView', definition: string, sort: number) => {
    const { db, rows } = org();
    db.prepare("INSERT INTO themes (id, name, definition, sort, updated_at) VALUES ('own-1', 'Egen', ?, ?, 0)").run(definition, sort);
    const read = await new Core().view<Theme | { theme: Theme }>(name, { id: 'own-1' }, rows);
    return 'theme' in read ? read.theme : read;
  };

  it('reads a definition with half a surrogate pair in a key as Classic in Teman, as presenting does', async () => {
    const definition = JSON.stringify({ ...CLASSIC.definition, media: { ...CLASSIC.definition.media, scrim: 40 } }).replace('{', '{"\\ud800":1,');

    const theme = await ownTheme('ownThemeView', definition, 1);

    expect(theme.definition).toEqual(CLASSIC.definition);
  });

  it("reads a whole sort past an i64's range as its end when presenting, as Teman does", async () => {
    const theme = await ownTheme('themeView', JSON.stringify(CLASSIC.definition), 1e19);

    expect(theme.sort).toBe(2 ** 63);
  });
});

describe('the blobs a queued change names', () => {
  const uploads = async (name: string, args: object) => {
    const { db, rows } = org();
    db.prepare('INSERT INTO _mutation (id, name, v, args) VALUES (1, ?, 1, ?)').run(name, JSON.stringify(args));
    db.exec(`INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES ('${full}', 'image/webp', 1, x'00', 0), ('${thumb}', 'image/webp', 1, x'00', 0)`);
    return (await new Core().view<{ uploads: { hash: string }[] }>('mediaUploadsView', { uploaded: {}, now: 0 }, rows)).uploads;
  };

  it("names none of a slideshow's pages that do not check", async () => {
    const named = await uploads('createCustomSlide', { id: 'c1', name: 'Predikan', pages: [brokenPage] });

    expect(named).toEqual([]);
  });

  it('names none of a theme whose definition does not check', async () => {
    const tooSmall = { ...CLASSIC.definition.song, main: { ...CLASSIC.definition.song.main, fontSize: 5 } };
    const definition = { ...CLASSIC.definition, media: { ...CLASSIC.definition.media, image: { kind: 'picture', full, thumb } }, song: tooSmall };

    const named = await uploads('createTheme', { id: 't1', name: 'Egen', definition });

    expect(named).toEqual([]);
  });
});

describe('the running order presenting reads', () => {
  const state = { presenting: true, shown: { itemId: 'b', partIndex: 0, black: false }, picked: null };

  it('steps over a row that does not read instead of refusing the key', () => {
    const next = new Core().pure<{ shown: unknown }>('presentingKeyView', { order: [['a', 'two'], ['b', 2]], state, key: { type: 'step', delta: 1 } });

    expect(next.shown).toEqual({ itemId: 'b', partIndex: 1, black: false });
  });

  it("reads an item of fewer than no slides as not in the page's order", () => {
    const live = { presentationId: null, itemId: null, partIndex: 0, black: false };
    const context = { presentationId: 'p', isTemplate: false, presenting: false, live };

    const answer = new Core().pure<{ state: { selectedId: string | null } }>('pageEventView', {
      state: { presenting: false, selectedId: 'x' },
      context,
      order: [['x', -1], ['a', 3]],
      event: { type: 'changed', itemIds: ['x', 'a'] },
    });

    expect(answer.state.selectedId).toBe('a');
  });
});
