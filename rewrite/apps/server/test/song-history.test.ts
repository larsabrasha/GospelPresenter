// Song history (spec 02 SONG-R20–R24 as decided in D9 and on 2026-10-31): the mutators run on a
// server database with a clock the test sets, as the sync engine runs them (`ctx.now`).
import { describe, expect, it } from 'vitest';
import { getMutator, parseSongSnapshot, SONG_VERSION_LIMIT, SONG_VERSION_WINDOW_MS, type MutatorName, type Tx } from '@gp/core';
import { nodeOrgStore, openSqlite } from '../src/node.ts';

const MIN = 60 * 1000;

function org() {
  const store = nodeOrgStore(openSqlite(':memory:', 'node:sqlite'));
  const clock = { now: 1_000_000_000 };
  /** Runs a mutator as `user` would through the sync, at the clock's time; `client` runs it as a device does (no clock). */
  const run = (name: MutatorName, args: unknown, user = 'alice', client = false) =>
    store.transaction(() => getMutator(name)!.run(store.db as Tx, getMutator(name)!.args.parse(args), { userId: user, role: 'admin', ...(client ? {} : { now: clock.now }) }));
  const versions = (song = 'S') =>
    store.query('SELECT id, user_id, created_at, name, data FROM song_versions WHERE song_id = ? ORDER BY created_at, id', [song]) as {
      id: string;
      user_id: string;
      created_at: number;
      name: string;
      data: string;
    }[];
  const parts = (song = 'S') => store.query('SELECT id, content, label_id FROM song_parts WHERE song_id = ? ORDER BY sort', [song]);
  const song = (id = 'S') => store.query('SELECT name, author, publisher, year, ccli FROM songs WHERE id = ?', [id])[0];
  return { store, clock, run, versions, parts, song };
}

/** A song "Ett" with two parts and an arrangement of them, made at the clock's time. */
async function withSong() {
  const o = org();
  await o.run('createSong', { id: 'S', name: 'Ett', author: 'A' });
  await o.run('addSongPart', { id: 'P1', songId: 'S', labelText: 'Verse', content: 'Första' });
  await o.run('addSongPart', { id: 'P2', songId: 'S', labelText: 'Chorus', content: 'Andra' });
  await o.run('createArrangement', { id: 'A1', songId: 'S', name: 'Kort', partIds: ['P1', 'P2', 'P1'] });
  return o;
}

describe('keeping versions of a song', () => {
  it('SONG-R20: keeps the song as it was before a change', async () => {
    const o = await withSong();
    const before = o.versions().length;
    o.clock.now += 31 * MIN;

    await o.run('updateSongPart', { id: 'P1', content: 'Ändrad' });

    const newest = parseSongSnapshot(o.versions().at(-1)!.data);
    expect(o.versions().length).toBe(before + 1);
    expect(newest.parts.map((p) => p.content)).toEqual(['Första', 'Andra']);
  });

  it('SONG-R20: keeps no new version for changes by the same person within 30 minutes', async () => {
    const o = await withSong();
    o.clock.now += 31 * MIN;
    await o.run('updateSongPart', { id: 'P1', content: 'Ett' });
    const count = o.versions().length;

    o.clock.now += SONG_VERSION_WINDOW_MS - 1;
    await o.run('updateSongPart', { id: 'P1', content: 'Två' });

    expect(o.versions().length).toBe(count);
  });

  it('keeps a new version when someone else changes the song within 30 minutes', async () => {
    const o = await withSong();
    o.clock.now += 31 * MIN;
    await o.run('updateSongPart', { id: 'P1', content: 'Alices text' });

    o.clock.now += MIN;
    await o.run('updateSongPart', { id: 'P1', content: 'Bobs text' }, 'bob');

    expect(parseSongSnapshot(o.versions().at(-1)!.data).parts[0]!.content).toBe('Alices text');
  });

  it('keeps no version of a new song before it has parts', async () => {
    const o = org();
    await o.run('createSong', { id: 'S', name: 'Ny' });

    await o.run('addSongPart', { id: 'P1', songId: 'S', labelText: null, content: 'Första' });

    expect(o.versions()).toEqual([]);
  });

  it('keeps no version on a device: versions come with the sync', async () => {
    const o = await withSong();
    const count = o.versions().length;
    o.clock.now += 31 * MIN;

    await o.run('updateSongPart', { id: 'P1', content: 'Ändrad' }, 'alice', true);

    expect(o.versions().length).toBe(count);
  });

  it('keeps no version when the song is as the newest version has it', async () => {
    const o = await withSong();
    o.clock.now += 31 * MIN;
    await o.run('updateSong', { id: 'S', author: 'B' });
    await o.run('updateSong', { id: 'S', author: 'A' }); // back as the newest version has it
    const count = o.versions().length;

    o.clock.now += 1;
    await o.run('updateSong', { id: 'S', author: 'C' }, 'bob');

    expect(o.versions().length).toBe(count);
  });

  it('D9: keeps the whole song: its fields, parts with their labels, and arrangements', async () => {
    const o = await withSong();
    await o.run('updateSong', { id: 'S', publisher: 'F', year: 1999, ccli: '123' });
    o.clock.now += 31 * MIN;

    await o.run('updateSong', { id: 'S', name: 'Nytt namn' });

    expect(parseSongSnapshot(o.versions().at(-1)!.data)).toEqual({
      name: 'Ett',
      author: 'A',
      publisher: 'F',
      year: 1999,
      ccli: '123',
      parts: [
        { id: 'P1', labelId: 'label:verse', labelText: 'Verse', labelColor: expect.any(String), content: 'Första' },
        { id: 'P2', labelId: 'label:chorus', labelText: 'Chorus', labelColor: expect.any(String), content: 'Andra' },
      ],
      arrangements: [{ id: 'A1', name: 'Kort', partIds: ['P1', 'P2', 'P1'] }],
    });
  });

  it.each([
    ['moveSongPart', { id: 'P2', toIndex: 0 }],
    ['removeSongPart', { id: 'P2' }],
    ['updateArrangement', { id: 'A1', name: 'Lång' }],
    ['appendArrangementPart', { id: 'A1', partId: 'P2' }],
    ['removeArrangementPart', { id: 'A1', index: 0, partId: 'P1' }],
    ['moveArrangementPart', { id: 'A1', index: 0, partId: 'P1', by: 1 }],
    ['removeArrangement', { id: 'A1' }],
  ] as const)('SONG-R20: %s keeps a version first', async (name, args) => {
    const o = await withSong();
    const count = o.versions().length;
    o.clock.now += 31 * MIN;

    await o.run(name, args);

    expect(o.versions().length).toBe(count + 1);
  });

  it('SONG-R21: keeps at most 50 versions, dropping the oldest', async () => {
    const o = await withSong();
    for (let i = 0; i < SONG_VERSION_LIMIT + 5; i++) {
      o.clock.now += 31 * MIN;
      await o.run('updateSongPart', { id: 'P1', content: `Text ${i}` });
    }

    const kept = o.versions();
    expect(kept.length).toBe(SONG_VERSION_LIMIT);
    expect(parseSongSnapshot(kept.at(-1)!.data).parts[0]!.content).toBe(`Text ${SONG_VERSION_LIMIT + 3}`);
  });

  it('D9: an import that replaces a song keeps a version of it first', async () => {
    const o = await withSong();
    o.clock.now += 1;

    await o.run('importSongs', {
      songs: [{ id: 'NEW', name: 'Ett', author: null, publisher: null, ccli: null, parts: [{ id: 'Q1', labelText: null, content: 'Från filen' }], arrangements: [], replaces: 'S' }],
    });

    expect(parseSongSnapshot(o.versions().at(-1)!.data).parts.map((p) => p.content)).toEqual(['Första', 'Andra']);
  });

  it('deletes the versions with the song when it is purged', async () => {
    const o = await withSong();
    o.clock.now += 31 * MIN;
    await o.run('updateSongPart', { id: 'P1', content: 'Ändrad' });
    await o.run('trashSong', { id: 'S', at: o.clock.now });

    await o.run('purgeSong', { id: 'S' });

    expect(o.versions()).toEqual([]);
  });
});

describe('restoring a version', () => {
  /** The song changed after a version of it was kept: a part's text, a part removed, one added, the arrangement and the name. */
  async function changed() {
    const o = await withSong();
    o.clock.now += 31 * MIN;
    await o.run('updateSong', { id: 'S', name: 'Två', author: 'B' });
    const version = o.versions().at(-1)!.id;
    await o.run('updateSongPart', { id: 'P1', content: 'Ny text' });
    await o.run('removeSongPart', { id: 'P2' });
    await o.run('addSongPart', { id: 'P3', songId: 'S', labelText: 'Bridge', content: 'Tredje' });
    await o.run('createArrangement', { id: 'A2', songId: 'S', partIds: ['P3'] });
    return { ...o, version };
  }

  it('D9: gives the song back its fields, its parts with their ids, and its arrangements', async () => {
    const o = await changed();

    await o.run('restoreSongVersion', { songId: 'S', versionId: o.version });

    expect(o.song()).toMatchObject({ name: 'Ett', author: 'A' });
    expect(o.parts().map((p) => [p.id, p.content])).toEqual([
      ['P1', 'Första'],
      ['P2', 'Andra'],
    ]);
    expect(o.store.query('SELECT id, part_ids FROM song_arrangements WHERE song_id = ?', ['S'])).toEqual([{ id: 'A1', part_ids: '["P1","P2","P1"]' }]);
  });

  it('SONG-R22: keeps the song as it is before restoring, even within 30 minutes', async () => {
    const o = await changed();

    await o.run('restoreSongVersion', { songId: 'S', versionId: o.version });

    expect(parseSongSnapshot(o.versions().at(-1)!.data).parts.map((p) => p.content)).toEqual(['Ny text', 'Tredje']);
  });

  it("gives a part its label again, by its text if the label was deleted", async () => {
    const o = await changed();
    await o.run('deleteLabel', { id: 'label:chorus' });

    await o.run('restoreSongVersion', { songId: 'S', versionId: o.version });

    const chorus = o.store.query(`SELECT id FROM labels WHERE text = 'Chorus'`)[0] as { id: string };
    expect(o.parts().find((p) => p.id === 'P2')?.label_id).toBe(chorus.id);
  });

  it('runs the same on a device, without keeping a version there', async () => {
    const o = await changed();
    const count = o.versions().length;

    await o.run('restoreSongVersion', { songId: 'S', versionId: o.version }, 'alice', true);

    expect(o.parts().map((p) => p.content)).toEqual(['Första', 'Andra']);
    expect(o.versions().length).toBe(count);
  });

  it("refuses a version that is not the song's", async () => {
    const o = await changed();
    await o.run('createSong', { id: 'OTHER', name: 'Annan' });

    await expect(o.run('restoreSongVersion', { songId: 'OTHER', versionId: o.version })).rejects.toThrow('version not found');
  });
});
