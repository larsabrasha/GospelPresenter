// What an item's menu offers, the same on its row, its heading's … and a phone's sheet (ItemContextMenu.tsx,
// ItemSheet.tsx; Lars, 2026-11-18). Kommentar, Lägg till efter › and Markera are always there; Radera too, disabled for
// the item on the outputs.
import { ORIGINAL_ARRANGEMENT, removableItem, sortedArrangements, type Overlay, type PresentationItem, type Song, type SongArrangement } from '@gp/core';
import { t } from '../i18n.ts';

/** A choice of Arrangemang › or Överlägg ›, by its id and its title. */
interface MenuChoice {
  id: string;
  title: string;
}

/** One of an item's settings in its menu: its choices, and the one chosen. */
export interface ItemChoice {
  choices: MenuChoice[];
  chosen: string;
}

export interface ItemMenu {
  /** Byt namn, for a programme item. */
  rename: boolean;
  /** Redigera, for a slide deck of its own or a song not in the trash. */
  edit: boolean;
  /** Redigera bilder, for a picture item. */
  editImages: boolean;
  /** Arrangemang ›: Original, then the song's arrangements in their order; null for no song or one without them. */
  arrangement: ItemChoice | null;
  /** Överlägg ›: Ingen, then each overlay; null for a programme item, which shows nothing, or with no overlays. */
  overlay: ItemChoice | null;
  /** Radera may be pressed: not for the item on the outputs, black or not. */
  removable: boolean;
}

/** What `item`'s menu offers. `shownId` is the item on the outputs while presenting, black or not. */
export function itemMenu({ item, songs, arrangements, overlays, shownId }: {
  item: PresentationItem;
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  shownId: string | null;
}): ItemMenu {
  const song = item.type === 'song' ? songs.get(item.sourceId) : undefined;
  const songHere = !!song && song.deletedAt === null;
  const own = songHere ? sortedArrangements(arrangements, item.sourceId) : [];
  const shows = item.type !== 'header';
  return {
    rename: item.type === 'header',
    edit: item.type === 'custom' || songHere,
    editImages: item.type === 'image',
    // Original first, the song's parts in their own order, beside an arrangement of its own (Lars, 2026-11-19); an
    // item that names none has the song's first.
    arrangement:
      shows && own.length
        ? {
            choices: [{ id: ORIGINAL_ARRANGEMENT, title: t('song.original') }, ...own.map((a, n) => ({ id: a.id, title: a.name ?? `${t('song.arrangement')} ${n + 1}` }))],
            chosen: item.arrangementId ?? own[0]!.id,
          }
        : null,
    overlay:
      shows && overlays.length
        ? { choices: [{ id: '', title: t('overlays.itemNone') }, ...overlays.map((o) => ({ id: o.id, title: o.title }))], chosen: item.overlayId ?? '' }
        : null,
    removable: removableItem(item.id, shownId),
  };
}
