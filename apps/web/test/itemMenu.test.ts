// What an item's menu offers (live/itemMenu.ts), the same on its row, its heading's … and a phone's sheet.
import type { Overlay, PresentationItem, Song, SongArrangement } from '@gp/core';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n.ts';
import { itemMenu } from '../src/live/itemMenu.ts';

const item = (over: Partial<PresentationItem> = {}) => ({ id: 'i1', type: 'song', sourceId: 's1', arrangementId: null, overlayId: null, ...over }) as PresentationItem;
const songs = (deletedAt: number | null = null) => new Map([['s1', { id: 's1', deletedAt } as Song]]);
const arrangement = (id: string, name: string | null, sort: number) => ({ id, songId: 's1', name, sort }) as SongArrangement;
const TWO = [arrangement('a2', 'Kort', 1), arrangement('a1', null, 0)];
const WELCOME = [{ id: 'o1', title: 'Välkommen' } as Overlay];
const menu = (over: Partial<Parameters<typeof itemMenu>[0]> = {}) => itemMenu({ item: item(), songs: songs(), arrangements: [], overlays: [], shownId: null, ...over });

describe('itemMenu', () => {
  it("opens a song's page", () => {
    const m = menu();

    expect([m.rename, m.edit, m.editImages]).toEqual([false, true, false]);
  });

  it('offers Original, then the arrangements in their order, the first chosen when the item names none', () => {
    const m = menu({ arrangements: TWO });

    expect(m.arrangement).toEqual({
      choices: [
        { id: 'original', title: t('song.original') },
        { id: 'a1', title: `${t('song.arrangement')} 1` },
        { id: 'a2', title: 'Kort' },
      ],
      chosen: 'a1',
    });
  });

  it('keeps the arrangement the item names chosen, Original too', () => {
    const m = menu({ item: item({ arrangementId: 'original' }), arrangements: TWO });

    expect(m.arrangement?.chosen).toBe('original');
  });

  it('offers no arrangements for a song that has only its parts', () => {
    expect(menu().arrangement).toBeNull();
  });

  it('offers neither the page nor the arrangements of a song in the trash', () => {
    const m = menu({ songs: songs(5), arrangements: TWO });

    expect([m.edit, m.arrangement]).toEqual([false, null]);
  });

  it('renames a programme item, and offers it no overlay, which it would not show', () => {
    const m = menu({ item: item({ type: 'header' }), overlays: WELCOME });

    expect([m.rename, m.edit, m.overlay]).toEqual([true, false, null]);
  });

  it('offers the overlays with Ingen first, Ingen chosen when the item has none', () => {
    const m = menu({ overlays: WELCOME });

    expect(m.overlay).toEqual({ choices: [{ id: '', title: t('overlays.itemNone') }, { id: 'o1', title: 'Välkommen' }], chosen: '' });
  });

  it("edits a picture item's pictures", () => {
    const m = menu({ item: item({ type: 'image' }) });

    expect([m.edit, m.editImages]).toEqual([false, true]);
  });

  it('cannot remove the item on the outputs', () => {
    expect([menu({ shownId: 'i1' }).removable, menu({ shownId: 'i2' }).removable]).toEqual([false, true]);
  });
});
