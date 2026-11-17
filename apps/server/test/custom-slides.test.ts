// Custom slides (docs/custom-slides.md) on each server adapter: made, changed, synced, put in a presentation as a
// reference, and trashed, restored and purged as a song is.
import { describe, expect, it } from 'vitest';
import { blankPage, type CustomPage } from '@gp/core';
import { adapters, syncFixture } from './sync-fixture.ts';

const withText = (text: string): CustomPage => ({
  ...blankPage(),
  elements: [{ id: 't1', kind: 'text', x: 100, y: 100, w: 800, h: 160, text, size: 96, bold: false, italic: false, align: 'center', color: null }],
});

describe.each(adapters)('%s adapter: custom slides', (adapterName) => {
  const fx = syncFixture(adapterName);

  it('syncs a slide made on one device, and a change of its pages, to the others', async () => {
    await fx.bob.client.mutate('createCustomSlide', { id: 'CS', name: 'Välkommen', pages: [blankPage()], at: 1 });
    await fx.bob.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Hej'), blankPage()], at: 2 });
    await fx.syncAll(fx.bob, fx.alice);

    const [row] = (await fx.alice.client.dump()).custom_slides;
    expect([row?.name, row?.updated_at, (JSON.parse(String(row?.pages)) as CustomPage[]).map((p) => p.elements.length)]).toEqual(['Välkommen', 2, [1, 0]]);
  });

  it('SYNC-R23: a change made offline before one made online is refused when it arrives, and its device is told', async () => {
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Välkommen', pages: [blankPage()], at: 1 });
    await fx.syncAll(fx.alice, fx.bob);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Från iPad offline')], at: 10 });
    await fx.alice.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Från webben')], at: 20 });
    await fx.alice.client.sync();

    fx.bob.net.online = true;
    await fx.syncAll(fx.bob, fx.alice);

    const pages = JSON.parse(String((await fx.server()).tables.custom_slides[0]?.pages)) as CustomPage[];
    expect([pages[0]?.elements.map((e) => ('text' in e ? e.text : null)), fx.bob.client.rejected.map((r) => r.error)]).toEqual([['Från webben'], ['newer-change']]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SYNC-R23: a rename made offline and new pages made online later both land, each field its own', async () => {
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Välkommen', pages: [blankPage()], at: 1 });
    await fx.syncAll(fx.alice, fx.bob);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('updateCustomSlide', { id: 'CS', name: 'Välkommen hit', at: 10 });
    await fx.alice.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Från webben')], at: 20 });
    await fx.alice.client.sync();

    fx.bob.net.online = true;
    await fx.syncAll(fx.bob, fx.alice);

    const [row] = (await fx.server()).tables.custom_slides;
    const pages = JSON.parse(String(row?.pages)) as CustomPage[];
    expect([row?.name, pages[0]?.elements.length, row?.name_at, row?.pages_at, row?.updated_at, fx.bob.client.rejected]).toEqual(['Välkommen hit', 1, 10, 20, 20, []]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('SYNC-R23: a change made offline after the last one online is kept', async () => {
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Välkommen', pages: [blankPage()], at: 1 });
    await fx.syncAll(fx.alice, fx.bob);
    await fx.alice.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Från webben')], at: 10 });
    await fx.alice.client.sync();
    fx.bob.net.online = false;
    await fx.bob.client.mutate('updateCustomSlide', { id: 'CS', pages: [withText('Från iPad offline')], at: 20 });

    fx.bob.net.online = true;
    await fx.syncAll(fx.bob, fx.alice);

    expect([(await fx.server()).tables.custom_slides[0]?.updated_at, fx.bob.client.rejected]).toEqual([20, []]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('refuses pages that are not a slide’s, and changes nothing', async () => {
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Välkommen', pages: [blankPage()], at: 1 });

    await expect(fx.alice.client.mutate('updateCustomSlide', { id: 'CS', pages: [], at: 2 } as never)).rejects.toThrow();
    expect((await fx.alice.client.dump()).custom_slides[0]?.updated_at).toBe(1);
  });

  it('puts a slide in a presentation as a reference, titled by its name', async () => {
    await fx.seed();
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Kollekt', pages: [blankPage()], at: 1 });

    await fx.alice.client.mutate('addCustomSlideToPresentation', { itemId: 'I9', presentationId: 'P', slideId: 'CS', afterItemId: 'I1' });
    await fx.syncAll(fx.alice);

    expect((await fx.items(fx.alice)).map((i) => [i.id, i.type, i.title, i.source_id])).toEqual([
      ['I1', 'song', 'Song 1', 'S1'],
      ['I9', 'custom', 'Kollekt', 'CS'],
      ['I2', 'song', 'Song 2', 'S2'],
    ]);
  });

  it('trashes, restores and purges a slide; purging one not in the trash is refused', async () => {
    await fx.alice.client.mutate('createCustomSlide', { id: 'CS', name: 'Kollekt', pages: [blankPage()], at: 1 });
    await expect(fx.alice.client.mutate('purgeCustomSlide', { id: 'CS' })).rejects.toMatchObject({ code: 'not-in-trash' });

    await fx.alice.client.mutate('trashCustomSlide', { id: 'CS', at: 5 });
    const trashed = (await fx.alice.client.dump()).custom_slides[0]?.deleted_at;
    await fx.alice.client.mutate('restoreCustomSlide', { id: 'CS' });
    const restored = (await fx.alice.client.dump()).custom_slides[0]?.deleted_at;
    await fx.alice.client.mutate('trashCustomSlide', { id: 'CS', at: 6 });
    await fx.alice.client.mutate('purgeCustomSlide', { id: 'CS' });
    await fx.syncAll(fx.alice);

    expect([trashed, restored, (await fx.server()).tables.custom_slides]).toEqual([5, null, []]);
  });
});
