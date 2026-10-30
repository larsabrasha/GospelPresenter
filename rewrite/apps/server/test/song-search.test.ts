// Song search on a device (packages/sync's song-search.ts): each song's
// search texts kept in memory, dropped after local mutations, pulls and
// rebases that touch the songs; and the tables a change
// reports (`SyncClient.onChange`), which pages reload by. On the Node adapter
// only: neither depends on the server's runtime.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { searchSongs } from '@gp/core';
import { SongSearch, SyncClient } from '@gp/sync/client';
import { openWaSqlite } from '@gp/sync/wa-sqlite-node';
import { device, setRole, startAdapter, type Device, type Harness } from './harness.ts';

let h: Harness;
let org: string;
let alice: Device;
let bob: Device;
const devices: Device[] = [];

beforeAll(async () => {
  h = await startAdapter('node');
}, 60_000);
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  for (const d of devices.splice(0)) await d.client.close();
  org = `org-${crypto.randomUUID()}`;
  await setRole(h, 'alice', org, 'admin');
  await setRole(h, 'bob', org, 'user');
  alice = await device(h, org, 'alice', 'admin');
  bob = await device(h, org, 'bob', 'user');
  devices.push(alice, bob);
});

/** A song with its parts, made on `c`. */
async function song(c: SyncClient, id: string, name: string, parts: string[], author?: string) {
  await c.mutate('createSong', { id, name, author });
  for (const [i, content] of parts.entries()) await c.mutate('addSongPart', { id: `${id}-${i}`, songId: id, labelText: `Verse ${i + 1}`, content });
}

/** The names of the songs `query` finds, best first. */
async function names(c: SyncClient, search: SongSearch, query: string): Promise<string[]> {
  const ids = await search.search(query);
  const rows = (await c.query('SELECT id, name FROM songs')) as { id: string; name: string }[];
  return ids.map((id) => rows.find((r) => r.id === id)!.name);
}

describe('song search on a device', () => {
  it('ranks as the search over whole songs does (SONG-R33), ties in library order', async () => {
    const c = alice.client;
    await song(c, 'S1', 'Härlig är jorden', ['Härlig är jorden, härlig är Guds himmel'], 'Ingemann');
    await song(c, 'S2', 'Jorden runt', ['En sång om resor']);
    await song(c, 'S3', 'Morgon', ['Solen går upp över jorden']);
    await song(c, 'S4', 'Ack saliga stunder', ['Härliga jord']);
    const library = [
      { name: 'Ack saliga stunder', author: null, firstPart: 'Härliga jord', lyrics: 'Härliga jord' },
      { name: 'Härlig är jorden', author: 'Ingemann', firstPart: 'Härlig är jorden, härlig är Guds himmel', lyrics: 'Härlig är jorden, härlig är Guds himmel' },
      { name: 'Jorden runt', author: null, firstPart: 'En sång om resor', lyrics: 'En sång om resor' },
      { name: 'Morgon', author: null, firstPart: 'Solen går upp över jorden', lyrics: 'Solen går upp över jorden' },
    ];
    const search = new SongSearch(c);

    for (const q of ['jorden', 'harlig', 'härlig jorden', 'ingemann', 'sol', '', 'zzz']) expect(await names(c, search, q), q).toEqual(searchSongs(library, q).map((s) => s.name));
  });

  it('finds a song by a line added to it, and by its new name, not its old one', async () => {
    const c = alice.client;
    await song(c, 'S1', 'Gammal titel', ['Första versen']);
    const search = new SongSearch(c);
    expect(await names(c, search, 'gammal')).toEqual(['Gammal titel']);

    await c.mutate('updateSong', { id: 'S1', name: 'Ny titel' });
    await c.mutate('addSongPart', { id: 'S1-x', songId: 'S1', labelText: 'Chorus', content: 'Halleluja i höjden' });

    expect(await names(c, search, 'gammal')).toEqual([]);
    expect(await names(c, search, 'ny')).toEqual(['Ny titel']);
    expect(await names(c, search, 'halleluja')).toEqual(['Ny titel']);
  });

  it('leaves out a song in the trash, and finds it again once restored', async () => {
    const c = alice.client;
    await song(c, 'S1', 'Psalm', ['Text']);
    const search = new SongSearch(c);
    expect(await names(c, search, 'psalm')).toEqual(['Psalm']);

    await c.mutate('trashSong', { id: 'S1', at: Date.now() });
    expect(await names(c, search, 'psalm')).toEqual([]);
    expect(await search.search('')).toEqual([]);

    await c.mutate('restoreSong', { id: 'S1' });
    expect(await names(c, search, 'psalm')).toEqual(['Psalm']);
  });

  it("finds what another device wrote once it is pulled, also a part's new text", async () => {
    const search = new SongSearch(alice.client);
    await song(bob.client, 'S1', 'Från Bob', ['Första raden']);
    await bob.client.sync();
    await alice.client.sync();
    expect(await names(alice.client, search, 'raden')).toEqual(['Från Bob']);

    await bob.client.mutate('updateSongPart', { id: 'S1-0', content: 'Ändrad rad' });
    await bob.client.sync();
    await alice.client.sync();

    expect(await names(alice.client, search, 'raden')).toEqual([]);
    expect(await names(alice.client, search, 'ändrad')).toEqual(['Från Bob']);
  });

  it("keeps a device's own edit not yet pushed when a pull rebases it", async () => {
    const search = new SongSearch(alice.client);
    await song(alice.client, 'S1', 'Delad', ['Början']);
    await alice.client.sync();
    await alice.client.mutate('updateSongPart', { id: 'S1-0', content: 'Lokal ändring' }); // not pushed
    await bob.client.sync();
    await bob.client.mutate('createSong', { id: 'S2', name: 'Annan' });
    await bob.client.sync();

    await alice.client.pull();

    expect(await names(alice.client, search, 'lokal')).toEqual(['Delad']);
    expect(await names(alice.client, search, 'annan')).toEqual(['Annan']);
  });

  it("answers from what it holds until told to forget: a write it did not hear of, as another window's", async () => {
    const sqlite = await openWaSqlite();
    const offline = { transport: { post: async () => ({ status: 503, body: {} }) as never }, ctx: { userId: 'u', role: 'admin' as const } };
    const mine = await SyncClient.open(sqlite, offline);
    const other = await SyncClient.open(sqlite, offline); // the same file, as a second window's worker
    await song(mine, 'S1', 'Först', ['Text']);
    const search = new SongSearch(mine);
    expect(await names(mine, search, 'först')).toEqual(['Först']);
    await other.mutate('updateSong', { id: 'S1', name: 'Sedan' });
    expect(await names(mine, search, 'sedan')).toEqual([]);

    search.forget();

    expect(await names(mine, search, 'sedan')).toEqual(['Sedan']);
    await mine.close();
  });
});

describe('the tables a change reports', () => {
  /** The tables of the next change `c` reports. */
  const next = (c: SyncClient) =>
    new Promise<string[]>((resolve) => {
      const off = c.onChange((tables) => {
        off();
        resolve([...tables].toSorted());
      });
    });

  it('a mutation reports the tables it wrote', async () => {
    const c = alice.client;
    let heard = next(c);
    await c.mutate('createSong', { id: 'S1', name: 'A' });
    expect(await heard).toEqual(['songs']);
    await c.mutate('createPresentation', { id: 'P', name: 'Söndag' });

    heard = next(c);
    await c.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'S1' });

    expect(await heard).toEqual(['presentation_items', 'presentations']);
  });

  it('a pull reports the tables it wrote, those its rebase rewrote included', async () => {
    await bob.client.mutate('createSong', { id: 'S1', name: 'A' });
    await bob.client.sync();
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Söndag' }); // pending: replayed on the pull
    const heard = next(alice.client);

    await alice.client.pull();

    expect(await heard).toEqual(['presentations', 'songs']);
  });

  it('a refused mutation reports nothing, and the next one only its own tables', async () => {
    const c = alice.client;
    await expect(c.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'missing' })).rejects.toThrow();
    const heard = next(c);

    await c.mutate('createSong', { id: 'S1', name: 'A' });

    expect(await heard).toEqual(['songs']);
  });
});
