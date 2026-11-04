// Presentations through sync (spec 03): the trash's clock, copies and templates, on every server adapter
// (`sync-fixture.ts`).
import { describe, expect, it } from 'vitest';
import { adapters, syncFixture } from './sync-fixture.ts';

describe.each(adapters)('%s adapter: presentations and templates', (adapterName) => {
  const fx = syncFixture(adapterName);

  it('PRES-R26: expired trash is purged by the fx.server clock; a client clock that runs ahead purges nothing early', async () => {
    await fx.seed();
    const day = 86_400_000;
    const now = Date.now();
    await fx.alice.client.mutate('trashSong', { id: 'S1', at: now - 31 * day });
    await fx.alice.client.mutate('trashSong', { id: 'S2', at: now - 10 * day });
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: now - 40 * day });
    await fx.syncAll(fx.alice, fx.bob);
    fx.bob.net.online = false;
    await fx.bob.client.mutate('purgeExpiredTrash', { now: now + 60 * day }); // a clock two months ahead
    expect((await fx.bob.client.dump()).songs.map((r) => r.id)).toEqual(['S3', 'S4']); // optimistic: both gone
    fx.bob.net.online = true;
    await fx.syncAll(fx.alice, fx.bob);
    const d = await fx.bob.client.dump();
    expect(d.songs.map((r) => r.id)).toEqual(['S2', 'S3', 'S4']); // the fx.server kept the 10-day-old one
    expect(d.presentations).toEqual([]);
    expect(d.presentation_items).toEqual([]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  // ------------------------------------------------------------ templates (spec 03)

  /** Copies of P's seeded fx.items into template T, and of T's into fx.presentation N, with the ids the caller makes. */
  const fromP = [
    { from: 'I1', id: 'T-I1' },
    { from: 'I2', id: 'T-I2' },
  ];
  const fromT = [
    { from: 'T-I1', id: 'N-I1' },
    { from: 'T-I2', id: 'N-I2' },
  ];

  it('a copy holds the fx.items the user copied: one added to the source meanwhile is left out, one removed is skipped', async () => {
    await fx.seed();
    fx.alice.net.online = false;
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.carol.client.mutate('addSongToPresentation', { itemId: 'I3', presentationId: 'P', songId: 'S3' });
    await fx.carol.client.mutate('removeItem', { itemId: 'I1' });
    await fx.carol.client.sync();
    fx.alice.net.online = true;

    await fx.syncAll(fx.alice, fx.carol);

    expect((await fx.items(fx.alice, 'T')).map((r) => [r.id, r.source_id, r.sort])).toEqual([['T-I2', 'S2', 0]]);
    await fx.expectConverged(fx.alice, fx.carol);
  });

  it('PRES-R31, D10: save as template copies the fx.items, their arrangements and the theme, without a schedule', async () => {
    await fx.seed();
    await fx.alice.client.mutate('createArrangement', { id: 'A1', songId: 'S2', partIds: [] });
    await fx.alice.client.mutate('setItemArrangement', { itemId: 'I2', arrangementId: 'A1' });
    await fx.alice.client.mutate('updatePresentation', { id: 'P', themeId: 'light', eventDate: '2026-11-01' });

    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.syncAll(fx.alice, fx.bob);

    expect(await fx.presentation(fx.bob, 'T')).toMatchObject({ name: 'Söndag', is_template: 1, theme_id: 'light', event_date: null, weekday: null, time: null, location: null });
    expect((await fx.items(fx.bob, 'T')).map((r) => [r.type, r.title, r.source_id, r.sort, r.arrangement_id])).toEqual([
      ['song', 'Song 1', 'S1', 0, null],
      ['song', 'Song 2', 'S2', 1, 'A1'],
    ]);
    // Made from the ids on both ends, as a UUID of version 8 (RFC 9562), so client and server agree.
    expect((await fx.items(fx.bob, 'T')).map((r) => r.id)).toEqual(['T-I1', 'T-I2']); // the ids the caller made
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('PRES-R30: a fx.presentation made from a template gets its fx.items and theme, and the template its last use', async () => {
    await fx.seed();
    await fx.alice.client.mutate('createTemplate', { id: 'T', name: 'Söndag', weekday: 0, time: '11:00', location: 'Kyrkan' });
    await fx.alice.client.mutate('updatePresentation', { id: 'P', themeId: 'light' }); // a presentation's theme: not the template's
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'TI1', presentationId: 'T', songId: 'S3' });
    await fx.alice.client.mutate('addSongToPresentation', { itemId: 'TI2', presentationId: 'T', songId: 'S4' });
    await fx.syncAll(fx.alice, fx.bob);

    await fx.bob.client.mutate('createFromTemplate', {
      id: 'N',
      templateId: 'T',
      name: 'Söndag 1 nov',
      eventDate: '2026-11-01',
      items: [
        { from: 'TI1', id: 'N1' },
        { from: 'TI2', id: 'N2' },
      ],
      at: 1000,
    });
    await fx.syncAll(fx.bob, fx.alice);

    expect(await fx.presentation(fx.alice, 'N')).toMatchObject({ name: 'Söndag 1 nov', is_template: 0, event_date: '2026-11-01', theme_id: null });
    expect((await fx.items(fx.alice, 'N')).map((r) => r.source_id)).toEqual(['S3', 'S4']);
    expect(await fx.presentation(fx.alice, 'T')).toMatchObject({ last_used_at: 1000, weekday: 0, time: '11:00', location: 'Kyrkan' });
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('PRES-A4: removing an item of a fx.presentation made from a template leaves the template as it was', async () => {
    await fx.seed();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.alice.client.mutate('createFromTemplate', { id: 'N', templateId: 'T', name: 'Söndag', items: fromT, at: 1 });
    const [first] = await fx.items(fx.alice, 'N');

    await fx.alice.client.mutate('removeItem', { itemId: String(first!.id) });
    await fx.syncAll(fx.alice, fx.bob);

    expect((await fx.items(fx.bob, 'N')).map((r) => r.source_id)).toEqual(['S2']);
    expect((await fx.items(fx.bob, 'T')).map((r) => r.source_id)).toEqual(['S1', 'S2']);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('D24: a user makes presentations from a template, but may not make, edit or delete one', async () => {
    await fx.seed();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.syncAll(fx.alice, fx.bob);
    const [item] = await fx.items(fx.bob, 'T');

    await expect(fx.bob.client.mutate('createTemplate', { id: 'T2', name: 'Fredag' })).rejects.toThrow('may not ManageTemplates');
    await expect(fx.bob.client.mutate('saveAsTemplate', { id: 'T3', presentationId: 'P', name: 'Kopia', items: [] })).rejects.toThrow('may not ManageTemplates');
    await expect(fx.bob.client.mutate('addSongToPresentation', { itemId: 'X', presentationId: 'T', songId: 'S3' })).rejects.toThrow('may not ManageTemplates');
    await expect(fx.bob.client.mutate('renameItem', { itemId: String(item!.id), title: 'Annat' })).rejects.toThrow('may not ManageTemplates');
    await expect(fx.bob.client.mutate('removeItem', { itemId: String(item!.id) })).rejects.toThrow('may not ManageTemplates');
    await expect(fx.bob.client.mutate('trashTemplate', { id: 'T', at: 1 })).rejects.toThrow('may not ManageTemplates');
    await fx.bob.client.mutate('createFromTemplate', { id: 'N', templateId: 'T', name: 'Söndag', items: fromT, at: 1 });
    await fx.syncAll(fx.bob, fx.alice);

    expect((await fx.items(fx.alice, 'N')).length).toBe(2);
    expect((await fx.items(fx.alice, 'T')).length).toBe(2);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it('PRES-R24: the trash of presentations and that of templates are separate', async () => {
    await fx.seed();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });

    await fx.alice.client.mutate('trashPresentation', { id: 'T', at: 5 });
    await fx.alice.client.mutate('trashTemplate', { id: 'P', at: 5 });
    await fx.alice.client.mutate('updatePresentation', { id: 'T', name: 'Annat' });
    await fx.syncAll(fx.alice);

    expect(await fx.presentation(fx.alice, 'T')).toMatchObject({ name: 'Söndag', deleted_at: null });
    expect(await fx.presentation(fx.alice, 'P')).toMatchObject({ deleted_at: null });
    await fx.alice.client.mutate('trashTemplate', { id: 'T', at: 5 });
    await fx.alice.client.mutate('purgePresentation', { id: 'T' }); // not a presentation: nothing happens
    await fx.syncAll(fx.alice);
    expect(await fx.presentation(fx.alice, 'T')).toMatchObject({ deleted_at: 5 });
    await fx.alice.client.mutate('purgeTemplate', { id: 'T' });
    await fx.syncAll(fx.alice);
    expect(await fx.presentation(fx.alice, 'T')).toBeUndefined();
    expect(await fx.items(fx.alice, 'T')).toEqual([]);
    await fx.expectConverged(fx.alice);
  });

  it('PRES-R23: a template in the trash cannot be used', async () => {
    await fx.seed();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.alice.client.mutate('trashTemplate', { id: 'T', at: 5 });

    await expect(fx.alice.client.mutate('createFromTemplate', { id: 'N', templateId: 'T', name: 'Söndag', items: fromT, at: 1 })).rejects.toThrow('Template not found.');
    await expect(fx.alice.client.mutate('createFromTemplate', { id: 'N', templateId: 'P', name: 'Söndag', items: [], at: 1 })).rejects.toThrow('Template not found.');
  });

  it("PRES-R28: a user's purge of expired trash leaves expired templates, which an admin's purges", async () => {
    await fx.seed();
    const day = 86_400_000;
    const now = Date.now();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.alice.client.mutate('trashTemplate', { id: 'T', at: now - 40 * day });
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: now - 40 * day });
    await fx.syncAll(fx.alice, fx.bob);

    await fx.bob.client.mutate('purgeExpiredTrash', { now });
    await fx.syncAll(fx.bob, fx.alice);
    expect((await fx.alice.client.dump()).presentations.map((r) => r.id)).toEqual(['T']);
    await fx.alice.client.mutate('purgeExpiredTrash', { now });
    await fx.syncAll(fx.alice, fx.bob);
    expect((await fx.bob.client.dump()).presentations).toEqual([]);
    await fx.expectConverged(fx.alice, fx.bob);
  });

  it("Töm empties a user's kinds of the trash in one change and leaves a template, which only an admin's empties", async () => {
    await fx.seed();
    await fx.alice.client.mutate('saveAsTemplate', { id: 'T', presentationId: 'P', name: 'Söndag', items: fromP });
    await fx.alice.client.mutate('trashTemplate', { id: 'T', at: 5 });
    await fx.alice.client.mutate('trashPresentation', { id: 'P', at: 5 });
    await fx.syncAll(fx.alice, fx.bob);

    await fx.bob.client.mutate('emptyTrash', {});
    await fx.syncAll(fx.bob, fx.alice);
    expect((await fx.alice.client.dump()).presentations.map((r) => r.id)).toEqual(['T']);
    await fx.alice.client.mutate('emptyTrash', {});
    await fx.syncAll(fx.alice, fx.bob);
    expect((await fx.bob.client.dump()).presentations).toEqual([]);
    await fx.expectConverged(fx.alice, fx.bob);
  });
});
