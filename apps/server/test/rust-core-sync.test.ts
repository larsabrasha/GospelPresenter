// The running order's mutators through the Rust core (packages/rust-core), on the clients and the server alike, on
// every server adapter: its writes reach the change log and the client's undo as the TS core's do.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RustCore } from '@gp/rust-core';
import type { MutatorCtx } from '@gp/core';
import { adapters, syncFixture } from './sync-fixture.ts';

describe.each(adapters)('%s adapter: the Rust core', (adapterName) => {
  const fx = syncFixture(adapterName);
  afterEach(() => vi.restoreAllMocks());

  it('runs a running order change on the client and on the server, and it reaches another device', async () => {
    await fx.seed();
    const ran = vi.spyOn(RustCore.prototype, 'mutate');
    await fx.alice.client.mutate('addHeaderToPresentation', { itemId: 'H', presentationId: 'P', title: 'Lovsång', afterItemId: 'I1' });
    await fx.alice.client.mutate('renameItem', { itemId: 'I2', title: 'Avslutning' });
    await fx.alice.client.mutate('setItemNote', { itemId: 'I1', note: 'Två verser' });
    await fx.alice.client.mutate('moveItem', { itemId: 'I2', by: -2 });
    await fx.alice.client.mutate('updatePresentation', { id: 'P', location: 'Kyrkan' });

    await fx.syncAll(fx.alice, fx.bob);

    expect((await fx.items(fx.bob)).map((r) => [r.id, r.title, r.note ?? null])).toEqual([
      ['I2', 'Avslutning', null],
      ['I1', 'Song 1', 'Två verser'],
      ['H', 'Lovsång', null],
    ]);
    await fx.expectConverged(fx.alice, fx.bob);
    // The server's calls have its clock in ctx (handlePush); a Worker's run in workerd, out of this process's sight.
    const where = new Set(ran.mock.calls.map(([name, , ctx]) => `${(ctx as MutatorCtx).now === undefined ? 'client' : 'server'} ${name}`));
    expect(where.has('client addHeaderToPresentation')).toBe(true);
    expect(where.has('server addHeaderToPresentation')).toBe(adapterName !== 'workers');
  });

  it('undoes a write the server refuses, through the client undo of the core writes', async () => {
    await fx.seed();
    fx.bob.net.online = false;
    await fx.bob.client.mutate('addHeaderToPresentation', { itemId: 'H', presentationId: 'P', title: 'Lovsång' });
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: 1 });
    await fx.alice.client.mutate('purgePresentation', { id: 'P' });
    await fx.alice.client.sync();
    fx.bob.net.online = true;

    await fx.syncAll(fx.bob, fx.alice);

    expect([fx.bob.client.rejected.map((r) => r.error), await fx.items(fx.bob)]).toEqual([['not-found'], []]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('replays a pending write on top of a change another device made first', async () => {
    await fx.seed();
    fx.bob.net.online = false;
    await fx.bob.client.mutate('addHeaderToPresentation', { itemId: 'H', presentationId: 'P', title: 'Lovsång', afterItemId: 'I1' });
    await fx.carol.client.mutate('removeItem', { itemId: 'I1' });
    await fx.carol.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S3', afterItemId: 'I2' });
    await fx.carol.client.sync();
    fx.bob.net.online = true;
    await fx.bob.client.pull(); // a pull before the push: carol's change under bob's pending header, replayed

    const rebased = (await fx.items(fx.bob)).map((r) => r.id);
    await fx.syncAll(fx.bob, fx.carol);

    expect([rebased, (await fx.items(fx.carol)).map((r) => r.id)]).toEqual([
      ['I2', 'I3', 'H'],
      ['I2', 'I3', 'H'],
    ]);
    await fx.expectConverged(fx.bob, fx.carol);
  });
});
