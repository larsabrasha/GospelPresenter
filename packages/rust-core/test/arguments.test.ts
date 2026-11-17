// The mutators' argument checks, now the Rust core's: what packages/core's tests asked of the TS mutators' zod schemas,
// asked of the core through runMutation (an argument it refuses is `invalid-args`; one it takes goes on to the rows).
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MutatorCtx } from '@gp/core';
import { runMutation, type Rows } from '../src/index.ts';
import { nodeRustCore } from '../src/node.ts';

const admin: MutatorCtx = { userId: 'u', role: 'admin', now: 1000 };

/** An organisation's database in memory, migrated by the core, and what a mutator says to `args`: ok or its refusal's code. */
function org() {
  const db = new DatabaseSync(':memory:');
  const rows = (sql: string, params: unknown[]) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = nodeRustCore();
  core.runSync('migrateOrgSchema', {}, undefined, rows);
  const say = (name: string, args: unknown) => runMutation({ core, rows }, name, args, admin).then(() => 'ok', (e: { code?: string }) => e.code);
  return { db, say };
}

/** Whether the core takes the arguments (anything but `invalid-args`, the rows may still refuse them). */
const takes = async (name: string, args: unknown) => (await org().say(name, args)) !== 'invalid-args';

describe('mutator arguments', () => {
  it('trims names and stores blank optional text as null', async () => {
    const { db, say } = org();

    await say('createSong', { id: 'S', name: '  Hi  ', author: '  ' });

    expect(db.prepare('SELECT name, author FROM songs').all()).toEqual([{ name: 'Hi', author: null }]);
  });

  it('refuses a blank name, a year past 9999, a long CCLI number and a long part', async () => {
    expect([
      await takes('createSong', { id: 'S', name: '   ' }),
      await takes('updateSong', { id: 'S', year: 10000 }),
      await takes('updateSong', { id: 'S', ccli: 'x'.repeat(21) }),
      await takes('addSongPart', { id: 'P', songId: 'S', labelText: null, content: 'x'.repeat(5001) }),
    ]).toEqual([false, false, false, false]);
  });

  it('trims an arrangement name, takes blank as no name, and refuses one past 100 (SONG-R16, R9)', async () => {
    const { db, say } = org();
    await say('createSong', { id: 'S', name: 'Psalm' });

    await say('createArrangement', { id: 'A', songId: 'S', name: '  Kort ', partIds: [] });
    await say('createArrangement', { id: 'B', songId: 'S', name: '  ', partIds: [] });

    expect([db.prepare('SELECT id, name FROM song_arrangements ORDER BY id').all(), await takes('updateArrangement', { id: 'A', name: 'x'.repeat(101) })]).toEqual([
      [{ id: 'A', name: 'Kort' }, { id: 'B', name: null }],
      false,
    ]);
  });

  it('refuses a blank item title, and takes an ISO date or none but not another date', async () => {
    expect([
      await takes('renameItem', { itemId: 'I', title: '  ' }),
      await takes('updatePresentation', { id: 'P', eventDate: '2026-11-01' }),
      await takes('updatePresentation', { id: 'P', eventDate: null }),
      await takes('updatePresentation', { id: 'P', eventDate: '1 nov' }),
    ]).toEqual([false, true, true, false]);
  });

  it('takes a passage of 1 to 500 verses with valid book codes', async () => {
    const verse = { b: 'JHN', c: 3, v: 16, t: 'x' };
    const base = { itemId: 'I', presentationId: 'P', bibleId: 'bible:web', translation: 'WEB' };

    expect([
      await takes('addBibleToPresentation', { ...base, verses: [verse] }),
      await takes('addBibleToPresentation', { ...base, verses: [] }),
      await takes('addBibleToPresentation', { ...base, verses: Array.from({ length: 501 }, () => verse) }),
      await takes('addBibleToPresentation', { ...base, verses: [{ ...verse, b: 'jhn' }] }),
    ]).toEqual([true, false, false, false]);
  });

  it('takes a Bible import that names a SHA-256 and an abbreviation of at most 50 (BIBLE-R4)', async () => {
    const ok = { name: ' Svenska Folkbibeln ', abbreviation: 'SFB', language: null, contentHash: 'a'.repeat(64) };

    expect([await takes('importBible', { ...ok, contentHash: 'abc' }), await takes('importBible', { ...ok, abbreviation: 'x'.repeat(51) })]).toEqual([false, false]);
  });

  it('takes an add of 1 to 100 pages (PRES-R11)', async () => {
    const page = { full: 'a'.repeat(64), thumb: 'b'.repeat(64) };
    const args = (n: number) => ({ itemId: 'I', presentationId: 'P', fileName: 'x.pdf', pages: Array.from({ length: n }, () => page) });

    expect([await takes('addSlides', args(100)), await takes('addSlides', args(101)), await takes('addSlides', args(0))]).toEqual([true, false, false]);
  });

  it('takes only the three remote control choices', async () => {
    expect([await takes('setRemoteControl', { policy: 'sometimes' }), await takes('setRemoteControl', { policy: 'always' })]).toEqual([false, true]);
  });
});
