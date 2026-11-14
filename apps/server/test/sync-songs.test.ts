// Songs through sync (spec 02): labels, arrangements, a presentation's items, the trash and imports, on every
// server adapter (`sync-fixture.ts`).
import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, labelId } from '@gp/core';
import { type Device } from './harness.ts';
import { adapters, syncFixture } from './sync-fixture.ts';

describe.each(adapters)('%s adapter: songs and items', (adapterName) => {
  const fx = syncFixture(adapterName);

  const labelRows = async (d: Device) =>
    (await d.client.dump()).labels.toSorted((a, b) => Number(a.sort) - Number(b.sort)).map((l) => [l.text, l.color]);

  it('SONG-A27: a new organisation has the 25 default labels, in order, on every device', async () => {
    await fx.syncAll(fx.alice, fx.bob);

    expect(await labelRows(fx.bob)).toEqual(DEFAULT_LABELS.map((l) => [l.text, l.color]));
  });

  it('SONG-R45: a label made on the labels page is appended to the order', async () => {
    await fx.alice.client.mutate('createLabel', { text: 'Coda', color: '#ABCDEF' });
    await fx.syncAll(fx.alice, fx.bob);

    expect((await labelRows(fx.bob)).at(-1)).toEqual(['Coda', '#abcdef']);
  });

  it('SONG-A29: a label is refused when another has its text, whatever its case or spacing', async () => {
    await fx.syncAll(fx.alice);

    await expect(fx.alice.client.mutate('createLabel', { text: ' chorus ', color: '#000000' })).rejects.toThrow();
  });

  it("a renamed label keeps its parts, and a part given the new text gets that label, the old text a new one", async () => {
    await fx.seed();
    await fx.alice.client.mutate('addSongPart', { id: 'PA', songId: 'S1', labelText: 'Verse', content: 'a' });
    await fx.alice.client.mutate('updateLabel', { id: labelId('Verse'), text: 'Vers', color: '#111111' });

    await fx.alice.client.mutate('addSongPart', { id: 'PB', songId: 'S1', labelText: 'vers', content: 'b' });
    await fx.alice.client.mutate('addSongPart', { id: 'PC', songId: 'S1', labelText: 'Verse', content: 'c' });
    await fx.syncAll(fx.alice, fx.bob);

    const d = await fx.bob.client.dump();
    const labelOf = (part: string) => d.labels.find((l) => l.id === d.song_parts.find((p) => p.id === part)?.label_id);
    expect([labelOf('PA')?.text, labelOf('PB')?.text, labelOf('PC')?.text]).toEqual(['Vers', 'Vers', 'Verse']);
    expect(labelOf('PC')?.id).toBe(`${labelId('Verse')}:2`);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SONG-R46, A30: a deleted label leaves its parts unlabelled, and the rest are numbered again', async () => {
    await fx.seed();
    await fx.alice.client.mutate('addSongPart', { id: 'PA', songId: 'S1', labelText: 'Bridge', content: 'a' });

    await fx.alice.client.mutate('deleteLabel', { id: labelId('Bridge') });
    await fx.syncAll(fx.alice, fx.bob);

    const d = await fx.bob.client.dump();
    expect(d.song_parts.find((p) => p.id === 'PA')?.label_id).toBeNull();
    expect(d.labels.map((l) => Number(l.sort)).toSorted((a, b) => a - b)).toEqual([...Array(DEFAULT_LABELS.length - 1).keys()]);
  });

  it('SONG-A31: a label moved up is before the one it passed on every device', async () => {
    await fx.syncAll(fx.alice);

    await fx.alice.client.mutate('moveLabel', { id: labelId('Verse 1'), toIndex: 0 });
    await fx.syncAll(fx.alice, fx.bob);

    expect((await labelRows(fx.bob)).slice(0, 2).map(([text]) => text)).toEqual(['Verse 1', 'Verse']);
  });

  // ------------------------------------------------------------ milestone 2: arrangements, items, trash

  const arrangements = async (d: Device, song = 'S1') =>
    (await d.client.dump()).song_arrangements
      .filter((r) => r.song_id === song)
      .toSorted((a, b) => Number(a.sort) - Number(b.sort))
      .map((r) => ({ id: r.id, name: r.name, parts: JSON.parse(String(r.part_ids)) as string[] }));

  async function seedParts(song = 'S1', n = 3) {
    for (let i = 0; i < n; i++) await fx.alice.client.mutate('addSongPart', { id: `${song}-P${i}`, songId: song, labelText: 'Verse', content: `v${i}` });
  }

  it('arrangements: created after the others, foreign part ids dropped (SONG-R15), names trimmed (SONG-R16)', async () => {
    await fx.seed();
    await seedParts('S1');
    await seedParts('S2', 1);
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0', 'S1-P1', 'S1-P2'] });
    await fx.alice.client.mutate('createArrangement', { id: 'A2', songId: 'S1', name: '  Kort ', partIds: ['S1-P2', 'S2-P0', 'NOPE', 'S1-P2'] });
    await fx.syncAll(fx.alice, fx.bob);
    expect(await arrangements(fx.bob)).toEqual([
      { id: 'A1', name: null, parts: ['S1-P0', 'S1-P1', 'S1-P2'] },
      { id: 'A2', name: 'Kort', parts: ['S1-P2', 'S1-P2'] },
    ]);
    await fx.bob.client.mutate('updateArrangement', { id: 'A2', name: '   ' });
    await fx.bob.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P1', 'S1-P1', 'S2-P0'] });
    await fx.syncAll(fx.alice, fx.bob);
    expect(await arrangements(fx.alice)).toEqual([
      { id: 'A1', name: null, parts: ['S1-P1', 'S1-P1'] },
      { id: 'A2', name: null, parts: ['S1-P2', 'S1-P2'] },
    ]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SONG-R9: the eleventh arrangement is refused; SONG-R8: so is the 51st part', async () => {
    await fx.seed();
    for (let i = 0; i < 10; i++) await fx.alice.client.mutate('createArrangement', { id: `A${i}`, songId: 'S1', partIds: [] });
    await expect(fx.alice.client.mutate('createArrangement', { id: 'A10', songId: 'S1', partIds: [] })).rejects.toThrow(/maximum number of arrangements/);
    await seedParts('S2', 50);
    await expect(fx.alice.client.mutate('addSongPart', { id: 'S2-P50', songId: 'S2', labelText: null, content: '' })).rejects.toThrow(/maximum number of parts/);
    // The server says the same to a client that did not know (here: Bob, offline, before Alice's parts arrive).
    fx.bob.net.online = false;
    await fx.bob.client.mutate('addSongPart', { id: 'B51', songId: 'S2', labelText: null, content: 'one too many' });
    await fx.alice.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob);
    expect(fx.bob.client.rejected.map((r) => r.error)).toEqual(['limit']);
    expect((await fx.server()).tables.song_parts.filter((r) => r.song_id === 'S2')).toHaveLength(50);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SONG-R14: removing a part takes every occurrence out of every arrangement, also one edited concurrently', async () => {
    await fx.seed();
    await seedParts('S1');
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0', 'S1-P1', 'S1-P0'] });
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('removeSongPart', { id: 'S1-P0' });
    expect(await arrangements(fx.bob)).toEqual([{ id: 'A1', name: null, parts: ['S1-P1'] }]);
    // Carol, online, puts P0 in again first; Bob's removal lands after it.
    await fx.carol.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P0', 'S1-P2', 'S1-P0'] });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect(await arrangements(fx.alice)).toEqual([{ id: 'A1', name: null, parts: ['S1-P2'] }]);
    // And the other order: an arrangement edit made offline names a part the server already removed.
    fx.bob.net.online = false;
    await fx.bob.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P1', 'S1-P2'] });
    await fx.carol.client.mutate('removeSongPart', { id: 'S1-P1' });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect(await arrangements(fx.bob)).toEqual([{ id: 'A1', name: null, parts: ['S1-P2'] }]);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('an arrangement edited offline after another client removed it stays removed, without an error', async () => {
    await fx.seed();
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: [] });
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('updateArrangement', { id: 'A1', name: 'Bob' });
    await fx.carol.client.mutate('removeArrangement', { id: 'A1' });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect(fx.bob.client.rejected).toEqual([]);
    expect(await arrangements(fx.bob)).toEqual([]);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('chip edits apply to the list as it is: quick edits in a row compose, and two devices both land', async () => {
    await fx.seed();
    await seedParts('S1');
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0', 'S1-P1', 'S1-P2'] });
    // Three edits made from one rendered list [P0, P1, P2], without waiting for a re-render.
    await fx.alice.client.mutate('removeArrangementPart', { id: 'A1', index: 2, partId: 'S1-P2' });
    await fx.alice.client.mutate('appendArrangementPart', { id: 'A1', partId: 'S1-P1' });
    await fx.alice.client.mutate('moveArrangementPart', { id: 'A1', index: 1, partId: 'S1-P1', by: -1 });
    expect((await arrangements(fx.alice))[0]!.parts).toEqual(['S1-P1', 'S1-P0', 'S1-P1']);
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    // Offline on two devices: Bob appends, Carol removes the first chip and moves past the end.
    fx.bob.net.online = false;
    await fx.bob.client.mutate('appendArrangementPart', { id: 'A1', partId: 'S1-P2' });
    await fx.bob.client.mutate('appendArrangementPart', { id: 'A1', partId: 'S2-NOT-OURS' });
    await fx.carol.client.mutate('removeArrangementPart', { id: 'A1', index: 0, partId: 'S1-P1' });
    await fx.carol.client.mutate('moveArrangementPart', { id: 'A1', index: 0, partId: 'S1-P0', by: 9 });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect((await arrangements(fx.bob))[0]!.parts).toEqual(['S1-P1', 'S1-P0', 'S1-P2']);
    // A stale index still finds its part: the nearest occurrence.
    await fx.alice.client.mutate('removeArrangementPart', { id: 'A1', index: 0, partId: 'S1-P2' });
    expect((await arrangements(fx.alice))[0]!.parts).toEqual(['S1-P1', 'S1-P0']);
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('moveItem moves by places in the order where it runs; two quick moves up are two places', async () => {
    await fx.seed();
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S3' });
    await fx.alice.client.mutate('moveItem', { itemId: 'I3', by: -1 });
    await fx.alice.client.mutate('moveItem', { itemId: 'I3', by: -1 });
    await fx.alice.client.mutate('moveItem', { itemId: 'I1', by: 5 });
    await fx.syncAll(fx.alice, fx.bob);
    expect((await fx.items(fx.bob)).map((r) => [r.id, r.sort])).toEqual([
      ['I3', 0],
      ['I2', 1],
      ['I1', 2],
    ]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('items: insert after the selected item, rename, and choose an arrangement (spec 03 2d, 03 Q13)', async () => {
    await fx.seed();
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S3', partIds: [] });
    await fx.alice.client.mutate('createArrangement', { id: 'B1', songId: 'S4', partIds: [] });
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'N', presentationId: 'P', songId: 'S3', arrangementId: 'A1', afterItemId: 'I1' });
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'W', presentationId: 'P', songId: 'S3', arrangementId: 'B1', afterItemId: 'GONE' });
    await fx.alice.client.mutate('renameItem', { itemId: 'N', title: '  Inledning ' });
    await fx.syncAll(fx.alice, fx.bob);
    expect((await fx.items(fx.bob)).map((r) => [r.id, r.sort, r.title, r.arrangement_id])).toEqual([
      ['I1', 0, 'Song 1', null],
      ['N', 1, 'Inledning', 'A1'],
      ['I2', 2, 'Song 2', null],
      ['W', 3, 'Song 3', null], // after an item that is gone: appended; an arrangement of another song: dropped
    ]);
    await fx.bob.client.mutate('setItemArrangement', { itemId: 'N', arrangementId: null });
    await expect(fx.bob.client.mutate('setItemArrangement', { itemId: 'N', arrangementId: 'B1' })).rejects.toMatchObject({ code: 'not-found' });
    await fx.syncAll(fx.alice, fx.bob);
    expect((await fx.items(fx.alice)).find((r) => r.id === 'N')!.arrangement_id).toBeNull();
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('two offline inserts after the same item both land, in push order, with contiguous sorts', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    fx.bob.net.online = false;
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'XA', presentationId: 'P', songId: 'S3', afterItemId: 'I1' });
    await fx.bob.client.mutate('addSongToPresentation', { itemId: 'XB', presentationId: 'P', songId: 'S4', afterItemId: 'I1' });
    fx.alice.net.online = true;
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect((await fx.items(fx.carol)).map((r) => [r.id, r.sort])).toEqual([
      ['I1', 0],
      ['XB', 1],
      ['XA', 2],
      ['I2', 3],
    ]);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('the event date is set, changed and cleared on its own; a concurrent rename keeps both', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('updatePresentation', { id: 'P', eventDate: '2026-11-01' });
    await fx.carol.client.mutate('updatePresentation', { id: 'P', name: 'Allhelgona' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    expect(await fx.presentation(fx.alice)).toMatchObject({ name: 'Allhelgona', event_date: '2026-11-01' });
    await fx.carol.client.mutate('updatePresentation', { id: 'P', eventDate: null });
    await fx.syncAll(fx.alice, fx.carol);
    expect(await fx.presentation(fx.alice)).toMatchObject({ name: 'Allhelgona', event_date: null });
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('SONG-R27: a song is purged only from the trash, with its parts and arrangements; fx.items that used it stay', async () => {
    await fx.seed();
    await seedParts('S1');
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0'] });
    await expect(fx.alice.client.mutate('purgeSong', { id: 'S1' })).rejects.toThrow('not in the trash');
    await fx.alice.client.mutate('trashSong', { id: 'S1', at: Date.now() });
    await fx.syncAll(fx.alice, fx.bob);
    await fx.bob.client.mutate('restoreSong', { id: 'S1' });
    await fx.syncAll(fx.alice, fx.bob);
    await fx.alice.client.mutate('trashSong', { id: 'S1', at: Date.now() });
    await fx.alice.client.mutate('purgeSong', { id: 'S1' });
    await fx.syncAll(fx.alice, fx.bob);
    const d = await fx.bob.client.dump();
    expect(d.songs.map((r) => r.id)).toEqual(['S2', 'S3', 'S4']);
    expect(d.song_parts).toEqual([]);
    expect(d.song_arrangements).toEqual([]);
    expect((await fx.items(fx.bob)).map((r) => r.id)).toEqual(['I1', 'I2']);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  /** A song as the ProPresenter import sends it: two parts, and an arrangement of them in reverse. */
  const imported = (id: string, name: string, content = 'Ett', replaces: string | null = null) => ({
    id,
    name,
    author: 'Författare',
    publisher: null,
    ccli: '123',
    parts: [
      { id: `${id}-P0`, labelText: 'Verse 1', content },
      { id: `${id}-P1`, labelText: 'Refräng', content: 'Två' },
    ],
    arrangements: [{ id: `${id}-A0`, name: 'Baklänges', partIds: [`${id}-P1`, `${id}-P0`] }],
    replaces,
  });

  it('SONG-R38, R39: imported songs land with their parts, labels and arrangements on every device', async () => {
    await fx.alice.client.mutate('importSongs', { songs: [imported('N1', 'Ny sång')] });

    await fx.syncAll(fx.alice, fx.bob);

    const d = await fx.bob.client.dump();
    expect(d.songs.map((r) => [r.name, r.author, r.ccli])).toEqual([['Ny sång', 'Författare', '123']]);
    expect(d.song_parts.toSorted((a, b) => Number(a.sort) - Number(b.sort)).map((r) => [r.content, r.label_id])).toEqual([
      ['Ett', 'label:verse 1'],
      ['Två', 'label:refräng'],
    ]);
    expect(d.song_arrangements.map((r) => r.part_ids)).toEqual([JSON.stringify(['N1-P1', 'N1-P0'])]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SONG-R42: a song that replaces none is added beside one of the same name ("Behåll båda")', async () => {
    await fx.alice.client.mutate('createSong', { id: 'S1', name: 'Äran och makten' });

    await fx.alice.client.mutate('importSongs', { songs: [imported('N1', 'Äran och makten')] });

    expect((await fx.alice.client.dump()).songs.map((r) => r.id).toSorted()).toEqual(['N1', 'S1']);
  });

  it('SONG-R42: replacing keeps the song id and name, and takes the file author, CCLI, no year, parts and arrangements', async () => {
    await fx.seed();
    await seedParts('S1');
    await fx.alice.client.mutate('updateSong', { id: 'S1', year: 1990 });

    await fx.alice.client.mutate('importSongs', { songs: [imported('N1', 'song 1', 'Nytt', 'S1')] });
    await fx.syncAll(fx.alice, fx.bob);

    const d = await fx.bob.client.dump();
    expect(d.songs.find((r) => r.id === 'S1')).toMatchObject({ name: 'Song 1', author: 'Författare', ccli: '123', year: null });
    expect(d.songs.some((r) => r.id === 'N1')).toBe(false);
    expect(d.song_parts.filter((r) => r.song_id === 'S1').map((r) => r.id).toSorted()).toEqual(['N1-P0', 'N1-P1']);
    expect(d.song_arrangements.filter((r) => r.song_id === 'S1').map((r) => r.id)).toEqual(['N1-A0']);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SONG-R42: a song to replace that another device trashed meanwhile is added instead, so its text is kept', async () => {
    await fx.seed();
    await fx.syncAll(fx.alice, fx.carol);
    fx.alice.net.online = false;
    await fx.alice.client.mutate('importSongs', { songs: [imported('N1', 'Song 1', 'Nytt', 'S1')] });
    await fx.carol.client.mutate('trashSong', { id: 'S1', at: Date.now() });

    fx.alice.net.online = true;
    await fx.syncAll(fx.carol, fx.alice);

    const d = await fx.alice.client.dump();
    expect(d.songs.find((r) => r.id === 'N1')).toMatchObject({ name: 'Song 1', deleted_at: null });
    expect(d.songs.find((r) => r.id === 'S1')?.deleted_at).not.toBeNull();
    await fx.expectConverged(fx.alice, fx.carol);
  });

});
