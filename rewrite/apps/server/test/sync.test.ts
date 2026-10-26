// One test file, run against both server adapters: Node (better-sqlite3, one
// file per organisation) and Workers (a SQLite Durable Object per
// organisation plus D1, in workerd through Miniflare). Clients run wa-sqlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { labelId, PROTOCOL_VERSION, SCHEMA_VERSION } from '@gp/core';
import {
  api,
  device,
  POKE_WINDOW_MS,
  pokeUrl,
  serverDump,
  setRole,
  startAdapter,
  waitFor,
  type AdapterName,
  type Device,
  type Harness,
} from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

/** Measured numbers, printed at the end for RESULTS.md. */
export const measured: Record<string, number[]> = {};

describe.each(adapters)('%s adapter', (adapterName) => {
  let h: Harness;
  let org: string;
  let alice: Device; // admin
  let bob: Device; // user
  let carol: Device; // user, plays "the server side" (an online editor)
  const devices: Device[] = [];

  beforeAll(async () => {
    h = await startAdapter(adapterName);
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    await setRole(h, 'bob', org, 'user');
    await setRole(h, 'carol', org, 'user');
    alice = await device(h, org, 'alice', 'admin');
    bob = await device(h, org, 'bob', 'user');
    carol = await device(h, org, 'carol', 'user');
    devices.push(alice, bob, carol);
  });

  const items = async (d: Device, p = 'P') =>
    (await d.client.dump()).presentation_items.filter((r) => r.presentation_id === p).toSorted((a, b) => Number(a.sort) - Number(b.sort));
  const presentation = async (d: Device, id = 'P') => (await d.client.dump()).presentations.find((r) => r.id === id);
  const server = () => serverDump(h, org, 'alice');

  /** Seeds songs S1–S4 and presentation P with items I1 (S1) and I2 (S2), synced to everyone. */
  async function seed() {
    for (const n of [1, 2, 3, 4]) await alice.client.mutate('createSong', { id: `S${n}`, name: `Song ${n}` });
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Sunday' });
    await alice.client.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'S1' });
    await alice.client.mutate('addSongToPresentation', { itemId: 'I2', presentationId: 'P', songId: 'S2' });
    await alice.client.sync();
    await bob.client.sync();
    await carol.client.sync();
  }

  async function syncAll(...ds: Device[]) {
    for (const d of ds) await d.client.sync();
    for (const d of ds) await d.client.pull();
  }

  /** Every device and the server hold the same rows, byte for byte (as canonical JSON). */
  async function expectConverged(...ds: Device[]) {
    const s = JSON.stringify((await server()).tables);
    for (const d of ds) {
      expect(await d.client.pending()).toEqual([]);
      expect(JSON.stringify(await d.client.dump())).toBe(s);
    }
  }

  // ------------------------------------------------------------ the riskiest assumption

  describe('async mutators run atomically (riskiest assumption)', () => {
    it('server: a mutator that writes, awaits and throws leaves nothing behind', async () => {
      await seed();
      const before = await server();
      const res = await api<{ lastMutationId: number; results: { id: number; error: string }[] }>(h, 'POST', '/sync/push', {
        user: 'alice',
        org,
        body: {
          protocol: PROTOCOL_VERSION,
          schemaVersion: SCHEMA_VERSION,
          clientId: 'raw-client',
          mutations: [
            { id: 1, name: 'probeWriteThenThrow', v: 1, args: { songId: 'GHOST' } },
            { id: 2, name: 'renamePresentation', v: 1, args: { id: 'P', name: 'After the failure' } },
          ],
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastMutationId: 2, results: [{ id: 1, error: 'probe-failure' }] });
      const after = await server();
      expect(after.tables.songs).toEqual(before.tables.songs); // no GHOST row
      expect(after.changes.filter((c) => c.pk === 'GHOST')).toEqual([]); // the trigger's write rolled back too
      expect(after.tables.presentations[0]!.name).toBe('After the failure');
    });

    it('client: a mutator that throws writes nothing and queues nothing', async () => {
      await expect(alice.client.mutate('probeWriteThenThrow', { songId: 'GHOST' })).rejects.toThrow('thrown after writing');
      expect((await alice.client.dump()).songs).toEqual([]);
      expect(await alice.client.pending()).toEqual([]);
    });

    it('server: concurrent pushes from three clients serialise without interleaving', async () => {
      await seed();
      const ds = [alice, bob, carol];
      for (const [i, d] of ds.entries()) {
        for (let k = 0; k < 15; k++) {
          await d.client.mutate('addSongToPresentation', { itemId: `C${i}-${k}`, presentationId: 'P', songId: 'S3' });
        }
      }
      await Promise.all(ds.map((d) => d.client.push()));
      await syncAll(...ds);
      const sorts = (await server()).tables.presentation_items.map((r) => Number(r.sort)).toSorted((a, b) => a - b);
      expect(sorts).toEqual([...Array(47).keys()]); // 2 seeded + 45, each sort assigned once
      await expectConverged(...ds);
    });
  });

  // ------------------------------------------------------------ convergence

  it('offline edits on two clients converge byte for byte', async () => {
    await seed();
    alice.net.online = false;
    bob.net.online = false;
    await alice.client.mutate('addSongToPresentation', { itemId: 'A1', presentationId: 'P', songId: 'S3' });
    await alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['A1', 'I2'] });
    await alice.client.mutate('renamePresentation', { id: 'P', name: 'Alice name' });
    await bob.client.mutate('addSongToPresentation', { itemId: 'B1', presentationId: 'P', songId: 'S4' });
    await bob.client.mutate('removeItem', { itemId: 'I1' });
    await bob.client.mutate('createPresentation', { id: 'Q', name: 'Bob new' });
    await bob.client.mutate('addSongPart', { id: 'BP1', songId: 'S4', labelText: 'Hymn', content: 'Amazing grace' });
    alice.net.online = true;
    bob.net.online = true;
    await syncAll(alice, bob, carol);
    await expectConverged(alice, bob, carol);
    // Alice pushed first, so her reorder ran before Bob's add and delete.
    expect((await items(alice)).map((r) => r.id)).toEqual(['A1', 'I2', 'B1']);
    expect((await presentation(alice))!.name).toBe('Alice name');
  });

  it('random interleavings on three clients converge (seeded)', async () => {
    await seed();
    let rngState = { node: 7, 'node-sqlite': 9, workers: 11, remote: 13 }[adapterName];
    const rnd = (n: number) => ((rngState = (rngState * 1103515245 + 12345) % 2 ** 31), rngState % n);
    const ds = [alice, bob, carol];
    let n = 0;
    for (let round = 0; round < 40; round++) {
      const d = ds[rnd(3)]!;
      d.net.online = rnd(3) !== 0;
      const its = (await items(d)).map((r) => String(r.id));
      const op = rnd(5);
      if (op === 0 || its.length < 2) {
        await d.client.mutate('addSongToPresentation', { itemId: `R${n++}`, presentationId: 'P', songId: `S${1 + rnd(4)}` });
      } else if (op === 1) await d.client.mutate('removeItem', { itemId: its[rnd(its.length)]! });
      else if (op === 2) await d.client.mutate('reorderItems', { presentationId: 'P', itemIds: its.toReversed() });
      else if (op === 3) await d.client.mutate('renamePresentation', { id: 'P', name: `Name ${round}` });
      else {
        const labelText = ['Verse', 'Bridge', ' bridge'][rnd(3)]!;
        await d.client.mutate('addSongPart', { id: `SP${n++}`, songId: `S${1 + rnd(4)}`, labelText, content: `Part ${round}` });
      }
      if (rnd(2)) await d.client.sync().catch(() => undefined);
    }
    for (const d of ds) d.net.online = true;
    await syncAll(...ds);
    await expectConverged(...ds);
  });

  // ------------------------------------------------------------ spec 06 scenarios, rewritten for mutations

  it('SYNC-A7: offline add of an item and a server rename both land, no duplicate', async () => {
    await seed();
    alice.net.online = false;
    await alice.client.mutate('addSongToPresentation', { itemId: 'X', presentationId: 'P', songId: 'S3' });
    await carol.client.mutate('renamePresentation', { id: 'P', name: 'Server name' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    for (const d of [alice, carol]) {
      expect((await d.client.dump()).presentations.map((p) => [p.id, p.name])).toEqual([['P', 'Server name']]);
      expect((await items(d)).map((r) => r.id)).toEqual(['I1', 'I2', 'X']);
    }
    await expectConverged(alice, carol);
  });

  it('offline edits to different fields of one song both land', async () => {
    await seed();
    alice.net.online = false;
    await alice.client.mutate('updateSong', { id: 'S1', author: 'Alice Author' });
    await carol.client.mutate('updateSong', { id: 'S1', name: 'Carol name', year: 1998 });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    const s1 = (await alice.client.dump()).songs.find((r) => r.id === 'S1');
    expect(s1).toMatchObject({ name: 'Carol name', author: 'Alice Author', year: 1998 });
    await expectConverged(alice, carol);
  });

  it('song parts keep a contiguous order through concurrent moves and removals', async () => {
    await seed();
    for (const n of [0, 1, 2, 3]) await alice.client.mutate('addSongPart', { id: `PT${n}`, songId: 'S1', labelText: 'Verse', content: `v${n}` });
    await syncAll(alice, bob);
    bob.net.online = false;
    await bob.client.mutate('moveSongPart', { id: 'PT3', toIndex: 0 });
    await alice.client.mutate('removeSongPart', { id: 'PT1' });
    await alice.client.sync();
    bob.net.online = true;
    await syncAll(alice, bob);
    const parts = (await bob.client.dump()).song_parts.toSorted((a, b) => Number(a.sort) - Number(b.sort));
    expect(parts.map((r) => [r.id, r.sort])).toEqual([
      ['PT3', 0],
      ['PT0', 1],
      ['PT2', 2],
    ]);
    await expectConverged(alice, bob);
  });

  it('SYNC-A8 (D4): an offline item delete stays deleted although the server edited P', async () => {
    await seed();
    alice.net.online = false;
    await alice.client.mutate('removeItem', { itemId: 'I2' });
    await carol.client.mutate('renamePresentation', { id: 'P', name: 'Edited' });
    await carol.client.mutate('addSongToPresentation', { itemId: 'Z', presentationId: 'P', songId: 'S4' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    // Today Y comes back (additions win). Under D4 the deletion is exact.
    for (const d of [alice, carol]) expect((await items(d)).map((r) => r.id)).toEqual(['I1', 'Z']);
    await expectConverged(alice, carol);
  });

  it('SYNC-A10 (D14): an offline purge of P that the server restored and renamed is refused; both agree and push again', async () => {
    await seed();
    await alice.client.mutate('trashPresentation', { id: 'P', at: 1000 });
    await syncAll(alice, carol);
    alice.net.online = false;
    await alice.client.mutate('purgePresentation', { id: 'P' });
    expect(await presentation(alice)).toBeUndefined(); // optimistic: gone locally
    await carol.client.mutate('restorePresentation', { id: 'P' });
    await carol.client.mutate('renamePresentation', { id: 'P', name: 'Rescued' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    expect(alice.client.rejected.map((r) => r.error)).toEqual(['not-in-trash']);
    for (const d of [alice, carol]) expect(await presentation(d)).toEqual({ id: 'P', name: 'Rescued', event_date: null, deleted_at: null });
    await alice.client.mutate('renamePresentation', { id: 'P', name: 'Alice can push again' });
    await syncAll(alice, carol);
    expect((await presentation(carol))!.name).toBe('Alice can push again');
    await expectConverged(alice, carol);
  });

  it('SYNC-A10 (D14): an offline purge of P still in the server trash is final, despite a rename', async () => {
    await seed();
    await alice.client.mutate('trashPresentation', { id: 'P', at: 1000 });
    await syncAll(alice, carol);
    alice.net.online = false;
    await alice.client.mutate('purgePresentation', { id: 'P' });
    await carol.client.mutate('renamePresentation', { id: 'P', name: 'Renamed in trash' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    for (const d of [alice, carol]) {
      expect(await presentation(d)).toBeUndefined();
      expect(await items(d)).toEqual([]);
    }
    await expectConverged(alice, carol);
  });

  it('SYNC-A12: a label created offline that the server already has converges to one row', async () => {
    await seed();
    alice.net.online = false;
    await alice.client.mutate('addSongPart', { id: 'PA', songId: 'S1', labelText: 'bridge ', content: 'From Alice' });
    await carol.client.mutate('addSongPart', { id: 'PC', songId: 'S2', labelText: 'Bridge', content: 'From Carol' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    for (const d of [alice, carol]) {
      const dump = await d.client.dump();
      // The server's row survives, with Carol's spelling and the default colour.
      expect(dump.labels).toEqual([{ id: labelId('Bridge'), text: 'Bridge', color: '#7834c7', sort: 12 }]);
      expect(dump.song_parts.map((r) => [r.id, r.song_id, r.label_id])).toEqual([
        ['PA', 'S1', labelId('Bridge')],
        ['PC', 'S2', labelId('Bridge')],
      ]);
    }
    await expectConverged(alice, carol);
  });

  // ------------------------------------------------------------ milestone 2: arrangements, items, trash

  const arrangements = async (d: Device, song = 'S1') =>
    (await d.client.dump()).song_arrangements
      .filter((r) => r.song_id === song)
      .toSorted((a, b) => Number(a.sort) - Number(b.sort))
      .map((r) => ({ id: r.id, name: r.name, parts: JSON.parse(String(r.part_ids)) as string[] }));

  async function seedParts(song = 'S1', n = 3) {
    for (let i = 0; i < n; i++) await alice.client.mutate('addSongPart', { id: `${song}-P${i}`, songId: song, labelText: 'Verse', content: `v${i}` });
  }

  it('arrangements: created after the others, foreign part ids dropped (SONG-R15), names trimmed (SONG-R16)', async () => {
    await seed();
    await seedParts('S1');
    await seedParts('S2', 1);
    await alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0', 'S1-P1', 'S1-P2'] });
    await alice.client.mutate('createArrangement', { id: 'A2', songId: 'S1', name: '  Kort ', partIds: ['S1-P2', 'S2-P0', 'NOPE', 'S1-P2'] });
    await syncAll(alice, bob);
    expect(await arrangements(bob)).toEqual([
      { id: 'A1', name: null, parts: ['S1-P0', 'S1-P1', 'S1-P2'] },
      { id: 'A2', name: 'Kort', parts: ['S1-P2', 'S1-P2'] },
    ]);
    await bob.client.mutate('updateArrangement', { id: 'A2', name: '   ' });
    await bob.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P1', 'S1-P1', 'S2-P0'] });
    await syncAll(alice, bob);
    expect(await arrangements(alice)).toEqual([
      { id: 'A1', name: null, parts: ['S1-P1', 'S1-P1'] },
      { id: 'A2', name: null, parts: ['S1-P2', 'S1-P2'] },
    ]);
    await expectConverged(alice, bob);
  });

  it('SONG-R9: the eleventh arrangement is refused; SONG-R8: so is the 51st part', async () => {
    await seed();
    for (let i = 0; i < 10; i++) await alice.client.mutate('createArrangement', { id: `A${i}`, songId: 'S1', partIds: [] });
    await expect(alice.client.mutate('createArrangement', { id: 'A10', songId: 'S1', partIds: [] })).rejects.toThrow(/maximum number of arrangements/);
    await seedParts('S2', 50);
    await expect(alice.client.mutate('addSongPart', { id: 'S2-P50', songId: 'S2', labelText: null, content: '' })).rejects.toThrow(/maximum number of parts/);
    // The server says the same to a client that did not know (here: Bob, offline, before Alice's parts arrive).
    bob.net.online = false;
    await bob.client.mutate('addSongPart', { id: 'B51', songId: 'S2', labelText: null, content: 'one too many' });
    await alice.client.sync();
    bob.net.online = true;
    await syncAll(alice, bob);
    expect(bob.client.rejected.map((r) => r.error)).toEqual(['limit']);
    expect((await server()).tables.song_parts.filter((r) => r.song_id === 'S2')).toHaveLength(50);
    await expectConverged(alice, bob);
  });

  it('SONG-R14: removing a part takes every occurrence out of every arrangement, also one edited concurrently', async () => {
    await seed();
    await seedParts('S1');
    await alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0', 'S1-P1', 'S1-P0'] });
    await syncAll(alice, bob, carol);
    bob.net.online = false;
    await bob.client.mutate('removeSongPart', { id: 'S1-P0' });
    expect(await arrangements(bob)).toEqual([{ id: 'A1', name: null, parts: ['S1-P1'] }]);
    // Carol, online, puts P0 in again first; Bob's removal lands after it.
    await carol.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P0', 'S1-P2', 'S1-P0'] });
    await carol.client.sync();
    bob.net.online = true;
    await syncAll(alice, bob, carol);
    expect(await arrangements(alice)).toEqual([{ id: 'A1', name: null, parts: ['S1-P2'] }]);
    // And the other order: an arrangement edit made offline names a part the server already removed.
    bob.net.online = false;
    await bob.client.mutate('updateArrangement', { id: 'A1', partIds: ['S1-P1', 'S1-P2'] });
    await carol.client.mutate('removeSongPart', { id: 'S1-P1' });
    await carol.client.sync();
    bob.net.online = true;
    await syncAll(alice, bob, carol);
    expect(await arrangements(bob)).toEqual([{ id: 'A1', name: null, parts: ['S1-P2'] }]);
    await expectConverged(alice, bob, carol);
  });

  it('an arrangement edited offline after another client removed it stays removed, without an error', async () => {
    await seed();
    await alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: [] });
    await syncAll(alice, bob, carol);
    bob.net.online = false;
    await bob.client.mutate('updateArrangement', { id: 'A1', name: 'Bob' });
    await carol.client.mutate('removeArrangement', { id: 'A1' });
    await carol.client.sync();
    bob.net.online = true;
    await syncAll(alice, bob, carol);
    expect(bob.client.rejected).toEqual([]);
    expect(await arrangements(bob)).toEqual([]);
    await expectConverged(alice, bob, carol);
  });

  it('items: insert after the selected item, rename, and choose an arrangement (spec 03 2d, 03 Q13)', async () => {
    await seed();
    await alice.client.mutate('createArrangement', { id: 'A1', songId: 'S3', partIds: [] });
    await alice.client.mutate('createArrangement', { id: 'B1', songId: 'S4', partIds: [] });
    await alice.client.mutate('addSongToPresentation', { itemId: 'N', presentationId: 'P', songId: 'S3', arrangementId: 'A1', afterItemId: 'I1' });
    await alice.client.mutate('addSongToPresentation', { itemId: 'W', presentationId: 'P', songId: 'S3', arrangementId: 'B1', afterItemId: 'GONE' });
    await alice.client.mutate('renameItem', { itemId: 'N', title: '  Inledning ' });
    await syncAll(alice, bob);
    expect((await items(bob)).map((r) => [r.id, r.sort, r.title, r.arrangement_id])).toEqual([
      ['I1', 0, 'Song 1', null],
      ['N', 1, 'Inledning', 'A1'],
      ['I2', 2, 'Song 2', null],
      ['W', 3, 'Song 3', null], // after an item that is gone: appended; an arrangement of another song: dropped
    ]);
    await bob.client.mutate('setItemArrangement', { itemId: 'N', arrangementId: null });
    await expect(bob.client.mutate('setItemArrangement', { itemId: 'N', arrangementId: 'B1' })).rejects.toThrow('arrangement not found');
    await syncAll(alice, bob);
    expect((await items(alice)).find((r) => r.id === 'N')!.arrangement_id).toBeNull();
    await expectConverged(alice, bob);
  });

  it('two offline inserts after the same item both land, in push order, with contiguous sorts', async () => {
    await seed();
    alice.net.online = false;
    bob.net.online = false;
    await alice.client.mutate('addSongToPresentation', { itemId: 'XA', presentationId: 'P', songId: 'S3', afterItemId: 'I1' });
    await bob.client.mutate('addSongToPresentation', { itemId: 'XB', presentationId: 'P', songId: 'S4', afterItemId: 'I1' });
    alice.net.online = true;
    bob.net.online = true;
    await syncAll(alice, bob, carol);
    expect((await items(carol)).map((r) => [r.id, r.sort])).toEqual([
      ['I1', 0],
      ['XB', 1],
      ['XA', 2],
      ['I2', 3],
    ]);
    await expectConverged(alice, bob, carol);
  });

  it('the event date is set, changed and cleared on its own; a concurrent rename keeps both', async () => {
    await seed();
    alice.net.online = false;
    await alice.client.mutate('updatePresentation', { id: 'P', eventDate: '2026-11-01' });
    await carol.client.mutate('updatePresentation', { id: 'P', name: 'Allhelgona' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, carol);
    expect(await presentation(alice)).toMatchObject({ name: 'Allhelgona', event_date: '2026-11-01' });
    await carol.client.mutate('updatePresentation', { id: 'P', eventDate: null });
    await syncAll(alice, carol);
    expect(await presentation(alice)).toMatchObject({ name: 'Allhelgona', event_date: null });
    await expectConverged(alice, carol);
  });

  it('SONG-R27: a song is purged only from the trash, with its parts and arrangements; items that used it stay', async () => {
    await seed();
    await seedParts('S1');
    await alice.client.mutate('createArrangement', { id: 'A1', songId: 'S1', partIds: ['S1-P0'] });
    await expect(alice.client.mutate('purgeSong', { id: 'S1' })).rejects.toThrow('not in the trash');
    await alice.client.mutate('trashSong', { id: 'S1', at: Date.now() });
    await syncAll(alice, bob);
    await bob.client.mutate('restoreSong', { id: 'S1' });
    await syncAll(alice, bob);
    await alice.client.mutate('trashSong', { id: 'S1', at: Date.now() });
    await alice.client.mutate('purgeSong', { id: 'S1' });
    await syncAll(alice, bob);
    const d = await bob.client.dump();
    expect(d.songs.map((r) => r.id)).toEqual(['S2', 'S3', 'S4']);
    expect(d.song_parts).toEqual([]);
    expect(d.song_arrangements).toEqual([]);
    expect((await items(bob)).map((r) => r.id)).toEqual(['I1', 'I2']);
    await expectConverged(alice, bob);
  });

  it('PRES-R26: expired trash is purged by the server clock; a client clock that runs ahead purges nothing early', async () => {
    await seed();
    const day = 86_400_000;
    const now = Date.now();
    await alice.client.mutate('trashSong', { id: 'S1', at: now - 31 * day });
    await alice.client.mutate('trashSong', { id: 'S2', at: now - 10 * day });
    await alice.client.mutate('trashPresentation', { id: 'P', at: now - 40 * day });
    await syncAll(alice, bob);
    bob.net.online = false;
    await bob.client.mutate('purgeExpiredTrash', { now: now + 60 * day }); // a clock two months ahead
    expect((await bob.client.dump()).songs.map((r) => r.id)).toEqual(['S3', 'S4']); // optimistic: both gone
    bob.net.online = true;
    await syncAll(alice, bob);
    const d = await bob.client.dump();
    expect(d.songs.map((r) => r.id)).toEqual(['S2', 'S3', 'S4']); // the server kept the 10-day-old one
    expect(d.presentations).toEqual([]);
    expect(d.presentation_items).toEqual([]);
    await expectConverged(alice, bob);
  });

  // ------------------------------------------------------------ protocol

  it('a push retried after a lost response is applied once', async () => {
    await seed();
    await alice.client.mutate('addSongToPresentation', { itemId: 'L1', presentationId: 'P', songId: 'S3' });
    await alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['L1'] });
    alice.net.loseNextPushResponse = true;
    await expect(alice.client.push()).rejects.toThrow('response lost');
    expect(await alice.client.pending()).toHaveLength(2); // the client cannot know it landed
    const afterFirst = await server();
    await alice.client.push(); // the retry
    const afterRetry = await server();
    expect(afterRetry).toEqual(afterFirst); // nothing re-ran: no row and no change-log entry moved
    await syncAll(alice, carol);
    expect((await items(carol)).map((r) => r.id)).toEqual(['L1', 'I1', 'I2']);
    await expectConverged(alice, carol);
  });

  it('a rejected mutation disappears from the client with its optimistic rows', async () => {
    await seed();
    await carol.client.mutate('createPresentation', { id: 'GONE', name: 'Soon purged' });
    await syncAll(carol, bob);
    // Bob adds to GONE offline while Carol trashes and purges it.
    bob.net.online = false;
    await bob.client.mutate('addSongToPresentation', { itemId: 'NOPE', presentationId: 'GONE', songId: 'S3' });
    expect((await items(bob, 'GONE')).map((r) => r.id)).toEqual(['NOPE']);
    await carol.client.mutate('trashPresentation', { id: 'GONE', at: 1000 });
    await carol.client.mutate('purgePresentation', { id: 'GONE' });
    await carol.client.sync();
    bob.net.online = true;
    await bob.client.sync();
    expect(bob.client.rejected).toEqual([{ id: 1, error: 'not-found' }]);
    expect(await items(bob, 'GONE')).toEqual([]);
    expect(await bob.client.pending()).toEqual([]);
    await syncAll(alice, bob, carol);
    await expectConverged(alice, bob, carol);
  });

  it('invalid arguments are refused on the client and on the server', async () => {
    await expect(alice.client.mutate('createPresentation', { id: 'P', name: '   ' })).rejects.toThrow(/too_small|at least/i);
    expect(await alice.client.pending()).toEqual([]);
    const res = await api<{ results: { id: number; error: string }[] }>(h, 'POST', '/sync/push', {
      user: 'alice',
      org,
      body: {
        protocol: PROTOCOL_VERSION,
        schemaVersion: SCHEMA_VERSION,
        clientId: 'raw-client',
        mutations: [{ id: 1, name: 'createSong', v: 1, args: { id: 'S9', name: 'x'.repeat(201) } }],
      },
    });
    expect(res.body.results).toEqual([{ id: 1, error: 'invalid-args' }]);
    expect((await server()).tables.songs).toEqual([]);
  });

  it('delete versus concurrent edit of the same item: the delete is exact, the edit lands on the rest', async () => {
    await seed();
    await alice.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S3' });
    await syncAll(alice, bob, carol);
    // Bob deletes I2 offline while Carol reorders with I2 first.
    bob.net.online = false;
    await bob.client.mutate('removeItem', { itemId: 'I2' });
    await carol.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['I2', 'I3', 'I1'] });
    await carol.client.sync();
    bob.net.online = true;
    await syncAll(bob, carol);
    expect((await items(bob)).map((r) => [r.id, r.sort])).toEqual([
      ['I3', 1],
      ['I1', 2],
    ]);
    // And the other way round: Alice reorders offline, Carol deletes the item Alice moved.
    alice.net.online = false;
    await alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['I1', 'I3'] });
    await carol.client.mutate('removeItem', { itemId: 'I1' });
    await carol.client.sync();
    alice.net.online = true;
    await syncAll(alice, bob, carol);
    expect((await items(alice)).map((r) => [r.id, r.sort])).toEqual([['I3', 0]]);
    await expectConverged(alice, bob, carol);
  });

  it('a first sync larger than one pull page is staged and applied in one rebase', async () => {
    for (let i = 0; i < 1200; i++) await alice.client.mutate('createSong', { id: `S${String(i).padStart(4, '0')}`, name: `Song ${i}` });
    let start = performance.now();
    await alice.client.push();
    const pushMs = performance.now() - start;
    const fresh = await device(h, org, 'carol', 'user');
    devices.push(fresh);
    start = performance.now();
    await fresh.client.pull();
    const pullMs = performance.now() - start;
    expect((await fresh.client.dump()).songs).toHaveLength(1200);
    expect(fresh.net.requests.filter((p) => p === '/sync/pull')).toHaveLength(3); // pages of 500
    await alice.client.pull();
    await expectConverged(alice, fresh);
    console.log(`[measure] ${adapterName} push 1200 mutations: ${Math.round(pushMs)} ms; first pull of 1200 rows (3 pages): ${Math.round(pullMs)} ms`);
  });

  it('an old client is refused with "update required" and keeps its queue', async () => {
    await setRole(h, 'dave', org, 'user');
    const old = await device(h, org, 'dave', 'user', { protocol: 0 });
    devices.push(old);
    await old.client.mutate('createPresentation', { id: 'OLD', name: 'From an old app' });
    await old.client.sync();
    expect(old.client.updateRequired).toBe(true);
    expect(await old.client.pending()).toHaveLength(1);
    expect((await server()).tables.presentations).toEqual([]);
    const raw = await api(h, 'POST', '/sync/pull', {
      user: 'dave',
      org,
      body: { protocol: 0, schemaVersion: SCHEMA_VERSION, clientId: 'x', cookie: null, lastMutationId: 0 },
    });
    expect(raw).toEqual({ status: 426, body: { error: 'update-required', minimumProtocol: 1, detail: 'protocol 0' } });
  });

  it('SYNC-R42: a server edit reaches another client in under 3 s through a poke', async () => {
    await seed();
    await new Promise((r) => setTimeout(r, POKE_WINDOW_MS + 200)); // let the seed's own poke window drain
    let bobPokes = 0;
    await alice.client.listen(pokeUrl(h, org, 'alice'));
    await bob.client.listen(pokeUrl(h, org, 'bob'));
    const origSync = bob.client.sync.bind(bob.client);
    bob.client.sync = async () => {
      bobPokes++;
      return origSync();
    };
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const name = `Poked ${i}`;
      const start = performance.now();
      await bob.client.mutate('renamePresentation', { id: 'P', name });
      await bob.client.push();
      await waitFor(async () => (await presentation(alice))?.name === name, 3000);
      samples.push(performance.now() - start);
    }
    (measured[`poke latency ms (${adapterName})`] ??= []).push(...samples.map(Math.round));
    console.log(`[measure] ${adapterName} poke latency ms: ${samples.map(Math.round).join(', ')}`);
    for (const s of samples) expect(s).toBeLessThan(3000);
    await new Promise((r) => setTimeout(r, 700));
    expect(bobPokes).toBe(0); // the writer is not woken by its own change (SYNC-R39)
  });

  it.runIf(adapterName === 'workers' || adapterName === 'remote')('DO SQLite: only storage.transaction() makes an async mutator atomic', async () => {
    const { body } = await api<Record<string, { error: string; rowsLeft: string[] }>>(h, 'GET', '/debug/tx-probe', {
      user: 'alice',
      org,
    });
    console.log('[measure] DO transaction probe', JSON.stringify(body));
    expect(body.rawBegin!.error).toMatch(/transactionSync|BEGIN|transaction/i); // BEGIN is refused
    expect(body.transactionSync!.rowsLeft).toHaveLength(2); // committed early: NOT atomic
    expect(body.transaction).toEqual({ error: 'mutator failed', rowsLeft: [] }); // rolled back: atomic
  });

  it.runIf(adapterName === 'node')('better-sqlite3: db.transaction() refuses an async mutator; BEGIN/COMMIT works', async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    const mutator = async () => {
      db.prepare("INSERT INTO t VALUES ('a')").run();
      await Promise.resolve();
      db.prepare("INSERT INTO t VALUES ('b')").run();
      throw new Error('mutator failed');
    };
    const caught = () => {
      const p = mutator();
      p.catch(() => undefined);
      return p;
    };
    expect(() => (db.transaction as (f: unknown) => () => void)(caught)()).toThrow(/promise/i);
    db.exec('DELETE FROM t');
    db.exec('BEGIN IMMEDIATE');
    await mutator().catch(() => db.exec('ROLLBACK'));
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
    db.close();
  });

  it.runIf(adapterName === 'workers' || adapterName === 'remote')('SQLite triggers fire in DO SQLite and in local D1', async () => {
    expect(await api(h, 'GET', '/debug/d1-triggers')).toEqual({ status: 200, body: { fired: true } });
    expect(await api(h, 'GET', '/debug/triggers', { user: 'alice', org })).toEqual({ status: 200, body: { fired: true } });
  });
});
