// Sync between devices and the server (spec 06): convergence, conflicts, and the protocol's edges, on every
// server adapter (`sync-fixture.ts`). Songs and presentations have files of their own.
import { describe, expect, it } from 'vitest';
import { labelId, PROTOCOL_VERSION, SCHEMA_VERSION } from '@gp/core';
import { PULL_PAGE } from '@gp/sync/server';
import { api, device, POKE_WINDOW_MS, pokeProtocols, pokeUrl, setRole, waitFor } from './harness.ts';
import { adapters, syncFixture } from './sync-fixture.ts';

/** Measured numbers, printed at the end for RESULTS.md. */
export const measured: Record<string, number[]> = {};

describe.each(adapters)('%s adapter: sync', (adapterName) => {
  const fx = syncFixture(adapterName);

  // ------------------------------------------------------------ the riskiest assumption

  describe('async mutators run atomically (riskiest assumption)', () => {
    it('server: a mutator that writes, awaits and throws leaves nothing behind', async () => {
      await fx.seed();
      const before = await fx.server();
      const res = await api<{ lastMutationId: number; results: { id: number; error: string }[] }>(fx.h, 'POST', '/api/sync/push', {
        user: 'alice',
        org: fx.org,
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
      const after = await fx.server();
      expect(after.tables.songs).toEqual(before.tables.songs); // no GHOST row
      expect(after.changes.filter((c) => c.pk === 'GHOST')).toEqual([]); // the trigger's write rolled back too
      expect(after.tables.presentations[0]!.name).toBe('After the failure');
    });

    it('client: a mutator that throws writes nothing and queues nothing', async () => {
      await expect(fx.alice.client.mutate('probeWriteThenThrow', { songId: 'GHOST' })).rejects.toThrow('thrown after writing');
      expect((await fx.alice.client.dump()).songs).toEqual([]);
      expect(await fx.alice.client.pending()).toEqual([]);
    });

    it('server: concurrent pushes from three clients serialise without interleaving', async () => {
      await fx.seed();
      const ds = [fx.alice, fx.bob, fx.carol];
      for (const [i, d] of ds.entries()) {
        for (let k = 0; k < 15; k++) {
          await d.client.mutate('addSongToPresentation', { itemId: `C${i}-${k}`, presentationId: 'P', songId: 'S3' });
        }
      }
      await Promise.all(ds.map((d) => d.client.push()));
      await fx.syncAll(...ds);
      const sorts = (await fx.server()).tables.presentation_items.map((r) => Number(r.sort)).toSorted((a, b) => a - b);
      expect(sorts).toEqual([...Array(47).keys()]); // 2 seeded + 45, each sort assigned once
      await fx.expectConverged(...ds);
    });
  });

  // ------------------------------------------------------------ convergence

  it('offline edits on two clients converge byte for byte', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    fx.bob.net.online = false;
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'A1', presentationId: 'P', songId: 'S3' });
    await fx.alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['A1', 'I2'] });
    await fx.alice.client.mutate('renamePresentation', { id: 'P', name: 'Alice name' });
    await fx.bob.client.mutate('addSongToPresentation', { itemId: 'B1', presentationId: 'P', songId: 'S4' });
    await fx.bob.client.mutate('removeItem', { itemId: 'I1' });
    await fx.bob.client.mutate('createPresentation', { id: 'Q', name: 'Bob new' });
    await fx.bob.client.mutate('addSongPart', { id: 'BP1', songId: 'S4', labelText: 'Hymn', content: 'Amazing grace' });
    fx.alice.net.online = true;
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
    // Alice pushed first, so her reorder ran before Bob's add and delete.
    expect((await fx.items(fx.alice)).map((r) => r.id)).toEqual(['A1', 'I2', 'B1']);
    expect((await fx.presentation(fx.alice))!.name).toBe('Alice name');
  });

  it('random interleavings on three clients converge (seeded)', async () => {
    await fx.seed();
    let rngState = { node: 7, 'node-sqlite': 9, workers: 11, remote: 13 }[adapterName];
    const rnd = (n: number) => ((rngState = (rngState * 1103515245 + 12345) % 2 ** 31), rngState % n);
    const ds = [fx.alice, fx.bob, fx.carol];
    let n = 0;
    for (let round = 0; round < 40; round++) {
      const d = ds[rnd(3)]!;
      d.net.online = rnd(3) !== 0;
      const its = (await fx.items(d)).map((r) => String(r.id));
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
    await fx.syncAll(...ds);
    await fx.expectConverged(...ds);
  });

  // ------------------------------------------------------------ spec 06 scenarios, rewritten for mutations

  it('SYNC-A7: offline add of an item and a fx.server rename both land, no duplicate', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'X', presentationId: 'P', songId: 'S3' });
    await fx.carol.client.mutate('renamePresentation', { id: 'P', name: 'Server name' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    for (const d of [fx.alice, fx.carol]) {
      expect((await d.client.dump()).presentations.map((p) => [p.id, p.name])).toEqual([['P', 'Server name']]);
      expect((await fx.items(d)).map((r) => r.id)).toEqual(['I1', 'I2', 'X']);
    }
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('offline edits to different fields of one song both land', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('updateSong', { id: 'S1', author: 'Alice Author' });
    await fx.carol.client.mutate('updateSong', { id: 'S1', name: 'Carol name', year: 1998 });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    const s1 = (await fx.alice.client.dump()).songs.find((r) => r.id === 'S1');
    expect(s1).toMatchObject({ name: 'Carol name', author: 'Alice Author', year: 1998 });
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('song parts keep a contiguous order through concurrent moves and removals', async () => {
    await fx.seed();
    for (const n of [0, 1, 2, 3]) await fx.alice.client.mutate('addSongPart', { id: `PT${n}`, songId: 'S1', labelText: 'Verse', content: `v${n}` });
    await fx.syncAll(fx.alice, fx.bob);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('moveSongPart', { id: 'PT3', toIndex: 0 });
    await fx.alice.client.mutate('removeSongPart', { id: 'PT1' });
    await fx.alice.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob);
    const parts = (await fx.bob.client.dump()).song_parts.toSorted((a, b) => Number(a.sort) - Number(b.sort));
    expect(parts.map((r) => [r.id, r.sort])).toEqual([
      ['PT3', 0],
      ['PT0', 1],
      ['PT2', 2],
    ]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SYNC-A8 (D4): an offline item delete stays deleted although the fx.server edited P', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('removeItem', { itemId: 'I2' });
    await fx.carol.client.mutate('renamePresentation', { id: 'P', name: 'Edited' });
    await fx.carol.client.mutate('addSongToPresentation', { itemId: 'Z', presentationId: 'P', songId: 'S4' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    // Today Y comes back (additions win). Under D4 the deletion is exact.
    for (const d of [fx.alice, fx.carol]) expect((await fx.items(d)).map((r) => r.id)).toEqual(['I1', 'Z']);
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('SYNC-A10 (D14): an offline purge of P that the fx.server restored and renamed is refused; both agree and push again', async () => {
    await fx.seed();
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: 1000 });
    await fx.syncAll(fx.alice, fx.carol);
    fx.alice.net.online = false;
    await fx.alice.client.mutate('purgePresentation', { id: 'P' });
    expect(await fx.presentation(fx.alice)).toBeUndefined(); // optimistic: gone locally
    await fx.carol.client.mutate('restorePresentation', { id: 'P' });
    await fx.carol.client.mutate('renamePresentation', { id: 'P', name: 'Rescued' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    expect(fx.alice.client.rejected.map((r) => r.error)).toEqual(['not-in-trash']);
    for (const d of [fx.alice, fx.carol])
      expect(await fx.presentation(d)).toEqual({
        id: 'P',
        name: 'Rescued',
        event_date: null,
        deleted_at: null,
        theme_id: null,
        is_template: 0,
        weekday: null,
        time: null,
        location: null,
        last_used_at: null,
        description: null,
        // The rename's time on the server's clock, the same on both devices.
        updated_at: expect.any(Number),
      });
    await fx.alice.client.mutate('renamePresentation', { id: 'P', name: 'Alice can push again' });
    await fx.syncAll(fx.alice, fx.carol);
    expect((await fx.presentation(fx.carol))!.name).toBe('Alice can push again');
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('SYNC-A10 (D14): an offline purge of P still in the fx.server trash is final, despite a rename', async () => {
    await fx.seed();
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: 1000 });
    await fx.syncAll(fx.alice, fx.carol);
    fx.alice.net.online = false;
    await fx.alice.client.mutate('purgePresentation', { id: 'P' });
    await fx.carol.client.mutate('renamePresentation', { id: 'P', name: 'Renamed in trash' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    for (const d of [fx.alice, fx.carol]) {
      expect(await fx.presentation(d)).toBeUndefined();
      expect(await fx.items(d)).toEqual([]);
    }
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('SYNC-A12: a label created offline that the fx.server already has converges to one row', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('addSongPart', { id: 'PA', songId: 'S1', labelText: 'bridge ', content: 'From Alice' });
    await fx.carol.client.mutate('addSongPart', { id: 'PC', songId: 'S2', labelText: 'Bridge', content: 'From Carol' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.carol);
    for (const d of [fx.alice, fx.carol]) {
      const dump = await d.client.dump();
      // The server's row survives, with Carol's spelling and the default colour.
      expect(dump.labels.filter((l) => String(l.text).toLowerCase().trim() === 'bridge')).toEqual([{ id: labelId('Bridge'), text: 'Bridge', color: '#7834c7', sort: 12 }]);
      expect(dump.song_parts.map((r) => [r.id, r.song_id, r.label_id])).toEqual([
        ['PA', 'S1', labelId('Bridge')],
        ['PC', 'S2', labelId('Bridge')],
      ]);
    }
    await fx.expectConverged(fx.alice, fx.carol);
  });

  // ------------------------------------------------------------ labels (spec 02 "/admin/labels")

  /** The labels a device has, in order, as [text, colour]. */


  // ------------------------------------------------------------ protocol

  it('a push retried after a lost response is applied once', async () => {
    await fx.seed();
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'L1', presentationId: 'P', songId: 'S3' });
    await fx.alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['L1'] });
    fx.alice.net.loseNextPushResponse = true;
    await expect(fx.alice.client.push()).rejects.toThrow('response lost');
    expect(await fx.alice.client.pending()).toHaveLength(2); // the client cannot know it landed
    const afterFirst = await fx.server();
    await fx.alice.client.push(); // the retry
    const afterRetry = await fx.server();
    expect(afterRetry).toEqual(afterFirst); // nothing re-ran: no row and no change-log entry moved
    await fx.syncAll(fx.alice, fx.carol);
    expect((await fx.items(fx.carol)).map((r) => r.id)).toEqual(['L1', 'I1', 'I2']);
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('a sync run is busy from its start to its end, and says so at both', async () => {
    const seen: boolean[] = [];
    fx.alice.client.onBusy(() => seen.push(fx.alice.client.busy));

    const run = fx.alice.client.requestSync();
    const during = fx.alice.client.busy;
    await run;

    expect(during).toBe(true);
    expect(fx.alice.client.busy).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a rejected mutation disappears from the client with its optimistic rows', async () => {
    await fx.seed();
    await fx.carol.client.mutate('createPresentation', { id: 'GONE', name: 'Soon purged' });
    await fx.syncAll(fx.carol, fx.bob);
    // Bob adds to GONE offline while Carol trashes and purges it.
    fx.bob.net.online = false;
    await fx.bob.client.mutate('addSongToPresentation', { itemId: 'NOPE', presentationId: 'GONE', songId: 'S3' });
    expect((await fx.items(fx.bob, 'GONE')).map((r) => r.id)).toEqual(['NOPE']);
    await fx.carol.client.mutate('trashPresentation', { id: 'GONE', at: 1000 });
    await fx.carol.client.mutate('purgePresentation', { id: 'GONE' });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.bob.client.sync();
    expect(fx.bob.client.rejected).toEqual([{ id: 1, error: 'not-found' }]);
    expect(await fx.items(fx.bob, 'GONE')).toEqual([]);
    expect(await fx.bob.client.pending()).toEqual([]);
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('invalid arguments are refused on the client and on the server', async () => {
    await expect(fx.alice.client.mutate('createPresentation', { id: 'P', name: '   ' })).rejects.toMatchObject({ code: 'invalid-args' });
    expect(await fx.alice.client.pending()).toEqual([]);
    const res = await api<{ results: { id: number; error: string }[] }>(fx.h, 'POST', '/api/sync/push', {
      user: 'alice',
      org: fx.org,
      body: {
        protocol: PROTOCOL_VERSION,
        schemaVersion: SCHEMA_VERSION,
        clientId: 'raw-client',
        mutations: [{ id: 1, name: 'createSong', v: 1, args: { id: 'S9', name: 'x'.repeat(201) } }],
      },
    });
    expect(res.body.results).toEqual([{ id: 1, error: 'invalid-args' }]);
    expect((await fx.server()).tables.songs).toEqual([]);
  });

  it('delete versus concurrent edit of the same item: the delete is exact, the edit lands on the rest', async () => {
    await fx.seed();
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S3' });
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    // Bob deletes I2 offline while Carol reorders with I2 first.
    fx.bob.net.online = false;
    await fx.bob.client.mutate('removeItem', { itemId: 'I2' });
    await fx.carol.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['I2', 'I3', 'I1'] });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.syncAll(fx.bob, fx.carol);
    expect((await fx.items(fx.bob)).map((r) => [r.id, r.sort])).toEqual([
      ['I3', 1],
      ['I1', 2],
    ]);
    // And the other way round: Alice reorders offline, Carol deletes the item Alice moved.
    fx.alice.net.online = false;
    await fx.alice.client.mutate('reorderItems', { presentationId: 'P', itemIds: ['I1', 'I3'] });
    await fx.carol.client.mutate('removeItem', { itemId: 'I1' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;
    await fx.syncAll(fx.alice, fx.bob, fx.carol);
    expect((await fx.items(fx.alice)).map((r) => [r.id, r.sort])).toEqual([['I3', 0]]);
    await fx.expectConverged(fx.alice, fx.bob, fx.carol);
  });

  it('a first sync larger than one pull page is staged and applied in one rebase', async () => {
    // Two pages and part of a third: songs of nine parts, ten rows each (songs are capped at 5 000).
    const n = 2 * PULL_PAGE + 200;
    for (let i = 0; i < n / 10; i++) {
      const id = `S${String(i).padStart(4, '0')}`;
      await fx.alice.client.mutate('createSong', { id, name: `Song ${i}` });
      for (let k = 0; k < 9; k++) await fx.alice.client.mutate('addSongPart', { id: `${id}-${k}`, songId: id, labelText: null, content: `Rad ${k}` });
    }
    let start = performance.now();
    await fx.alice.client.push();
    const pushMs = performance.now() - start;
    const fresh = await device(fx.h, fx.org, 'carol', 'user');
    fx.track(fresh);
    start = performance.now();
    await fresh.client.pull();
    const pullMs = performance.now() - start;
    const dump = await fresh.client.dump();
    expect(dump.songs.length + dump.song_parts!.length).toBe(n);
    expect(fresh.net.requests.filter((p) => p === '/api/sync/pull')).toHaveLength(3);
    await fx.alice.client.pull();
    await fx.expectConverged(fx.alice, fresh);
    console.log(`[measure] ${adapterName} push ${n} mutations: ${Math.round(pushMs)} ms; first pull of ${n} rows (3 pages): ${Math.round(pullMs)} ms`);
  });

  it('an old client is refused with "update required" and keeps its queue', async () => {
    await setRole(fx.h, 'dave', fx.org, 'user');
    const old = await device(fx.h, fx.org, 'dave', 'user', { protocol: 0 });
    fx.track(old);
    await old.client.mutate('createPresentation', { id: 'OLD', name: 'From an old app' });
    await old.client.sync();
    expect(old.client.updateRequired).toBe(true);
    expect(await old.client.pending()).toHaveLength(1);
    expect((await fx.server()).tables.presentations).toEqual([]);
    const raw = await api(fx.h, 'POST', '/api/sync/pull', {
      user: 'dave',
      org: fx.org,
      body: { protocol: 0, schemaVersion: SCHEMA_VERSION, clientId: 'x', cookie: null, lastMutationId: 0 },
    });
    expect(raw).toEqual({ status: 426, body: { error: 'update-required', minimumProtocol: 1, detail: 'protocol 0' } });
  });

  it('SYNC-R42: a fx.server edit reaches another client in under 3 s through a poke', async () => {
    await fx.seed();
    await new Promise((r) => setTimeout(r, POKE_WINDOW_MS + 200)); // let the seed's own poke window drain
    let bobPokes = 0;
    await fx.alice.client.listen(pokeUrl(fx.h), { protocols: pokeProtocols(fx.h, fx.org, 'alice') });
    await fx.bob.client.listen(pokeUrl(fx.h), { protocols: pokeProtocols(fx.h, fx.org, 'bob') });
    const origSync = fx.bob.client.sync.bind(fx.bob.client);
    fx.bob.client.sync = async () => {
      bobPokes++;
      return origSync();
    };
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const name = `Poked ${i}`;
      const start = performance.now();
      await fx.bob.client.mutate('renamePresentation', { id: 'P', name });
      await fx.bob.client.push();
      await waitFor(async () => (await fx.presentation(fx.alice))?.name === name, 3000);
      samples.push(performance.now() - start);
    }
    (measured[`poke latency ms (${adapterName})`] ??= []).push(...samples.map(Math.round));
    console.log(`[measure] ${adapterName} poke latency ms: ${samples.map(Math.round).join(', ')}`);
    for (const s of samples) expect(s).toBeLessThan(3000);
    await new Promise((r) => setTimeout(r, 700)); // nothing may happen: past a poke window
    expect(bobPokes).toBe(0); // the writer is not woken by its own change (SYNC-R39)
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
});
