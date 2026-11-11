// The start of every sync test (spec 06), run against each server adapter: Node (better-sqlite3, one file per
// organisation), Node's own node:sqlite, and Workers (a SQLite Durable Object per organisation plus D1, in workerd
// through Miniflare). Each test gets a new organisation with three devices on wa-sqlite.
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { device, serverDump, setRole, startAdapter, type AdapterName, type Device, type Harness } from './harness.ts';

export const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',') as AdapterName[];

export interface SyncFixture {
  h: Harness;
  org: string;
  /** An admin. */
  alice: Device;
  /** A user. */
  bob: Device;
  /** A user who plays "the server side" (an online editor). */
  carol: Device;
  /** Presentation `p`'s items on `d`, in order. */
  items(d: Device, p?: string): Promise<Record<string, unknown>[]>;
  presentation(d: Device, id?: string): Promise<Record<string, unknown> | undefined>;
  /** The server's rows, as alice reads them. */
  server(): ReturnType<typeof serverDump>;
  /** Seeds songs S1–S4 and presentation P with items I1 (S1) and I2 (S2), synced to everyone. */
  seed(): Promise<void>;
  syncAll(...ds: Device[]): Promise<void>;
  /** Every device and the server hold the same rows, byte for byte (as canonical JSON). */
  expectConverged(...ds: Device[]): Promise<void>;
  /** A device a test made itself, closed before the next test as the three are. */
  track(d: Device): void;
}

/** Registers the hooks that start the adapter once and give each test its devices; read them from the result inside a test. */
export function syncFixture(adapterName: AdapterName): SyncFixture {
  const devices: Device[] = [];
  const fx = {
    items: async (d: Device, p = 'P') => (await d.client.dump()).presentation_items.filter((r) => r.presentation_id === p).toSorted((a, b) => Number(a.sort) - Number(b.sort)),
    presentation: async (d: Device, id = 'P') => (await d.client.dump()).presentations.find((r) => r.id === id),
    server: () => serverDump(fx.h, fx.org, 'alice'),
    async seed() {
      for (const n of [1, 2, 3, 4]) await fx.alice.client.mutate('createSong', { id: `S${n}`, name: `Song ${n}` });
      await fx.alice.client.mutate('createPresentation', { id: 'P', name: 'Sunday' });
      await fx.alice.client.mutate('addSongToPresentation', { itemId: 'I1', presentationId: 'P', songId: 'S1' });
      await fx.alice.client.mutate('addSongToPresentation', { itemId: 'I2', presentationId: 'P', songId: 'S2' });
      await fx.alice.client.sync();
      await fx.bob.client.sync();
      await fx.carol.client.sync();
    },
    async syncAll(...ds: Device[]) {
      for (const d of ds) await d.client.sync();
      for (const d of ds) await d.client.pull();
    },
    async expectConverged(...ds: Device[]) {
      const s = JSON.stringify((await fx.server()).tables);
      for (const d of ds) {
        expect(await d.client.pending()).toEqual([]);
        expect(JSON.stringify(await d.client.dump())).toBe(s);
      }
    },
    track: (d: Device) => void devices.push(d),
  } as SyncFixture;

  beforeAll(async () => {
    fx.h = await startAdapter(adapterName);
  }, 60_000);

  afterAll(async () => {
    await fx.h?.close();
  });

  beforeEach(async () => {
    for (const d of devices.splice(0)) await d.client.close();
    fx.org = `org-${crypto.randomUUID()}`;
    await setRole(fx.h, 'alice', fx.org, 'admin');
    await setRole(fx.h, 'bob', fx.org, 'user');
    await setRole(fx.h, 'carol', fx.org, 'user');
    fx.alice = await device(fx.h, fx.org, 'alice', 'admin');
    fx.bob = await device(fx.h, fx.org, 'bob', 'user');
    fx.carol = await device(fx.h, fx.org, 'carol', 'user');
    devices.push(fx.alice, fx.bob, fx.carol);
  });

  return fx;
}
