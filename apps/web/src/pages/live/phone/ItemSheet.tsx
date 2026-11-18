import { sortedArrangements, type Overlay, type PresentationItem, type Song, type SongArrangement } from '@gp/core';
import { itemActions } from '../../../db/pageCore.ts';
import { t } from '../../../i18n.ts';
import { CheckSquareIcon, CommentIcon, PencilIcon, PlusIcon, TrashIcon } from '../../../ui/icons.tsx';
import { navigate } from '../../../ui/router.ts';
import { Sheet } from '../../../ui/Sheet.tsx';
import { ItemSettings } from '../../presentation-editor/ItemParts.tsx';
import { songPage } from '../songPage.ts';
import { MenuGroup, MenuRow } from './MenuRows.tsx';

/** What the item's sheet does, its parent's: the dialogs it opens and the list's select mode. */
export interface ItemSheetActions {
  onRename: (item: PresentationItem) => void;
  onNote: (item: PresentationItem) => void;
  onEditImages: (item: PresentationItem) => void;
  onAddAfter: (item: PresentationItem) => void;
  onTick: (item: PresentationItem) => void;
  onRemove: (item: PresentationItem) => void;
}

/**
 * An item's sheet on a phone, from its …: what it offers is the core's (`itemActionsView`, docs/view-models.md), the
 * same as the computer's … (ItemContextMenu); this draws it as iOS 27's sheets do, grouped as the computer's (Lars,
 * 2026-11-05): the item itself, its settings, the list around it, and Radera last, which the item on the outputs cannot,
 * black or not. `item` is the item as it is now, so a choice shows at once.
 */
export function ItemSheet({ item, songs, arrangements, overlays, shownId, on, onClose }: {
  item: PresentationItem;
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  /** The item on the outputs, black or not; none before presenting. */
  shownId: string | null;
  on: ItemSheetActions;
  onClose: () => void;
}) {
  const song = item.type === 'song' ? (songs.get(item.sourceId) ?? null) : null;
  const offered = itemActions({ item, song, arrangements: sortedArrangements(arrangements, item.sourceId), overlays, shownId });
  const page = offered.has('edit') ? songPage(item, songs) : undefined;
  const remove = offered.get('delete');
  return (
    <Sheet title={item.title} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <MenuGroup>
          {offered.has('rename') && (
            <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => (onClose(), on.onRename(item))}>
              {t('header.rename')}
            </MenuRow>
          )}
          {page && (
            <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => (onClose(), navigate(page))}>
              {t('presentation.editSong')}
            </MenuRow>
          )}
          {offered.has('editImages') && (
            <MenuRow icon={<PencilIcon className="size-5" />} onClick={() => on.onEditImages(item)}>
              {t('presentation.editImages')}
            </MenuRow>
          )}
          {offered.has('note') && (
            <MenuRow icon={<CommentIcon className="size-5" />} onClick={() => (onClose(), on.onNote(item))}>
              {t('note.title')}
            </MenuRow>
          )}
        </MenuGroup>
        <ItemSettings item={item} arrangement={offered.get('arrangement')} overlay={offered.get('overlay')} />
        <MenuGroup>
          {offered.has('addAfter') && (
            <MenuRow icon={<PlusIcon className="size-5" />} onClick={() => (onClose(), on.onAddAfter(item))}>
              {t('live.addAfter')}
            </MenuRow>
          )}
          {offered.has('tick') && (
            <MenuRow icon={<CheckSquareIcon className="size-5" />} onClick={() => (onClose(), on.onTick(item))}>
              {t('presentation.tick')}
            </MenuRow>
          )}
        </MenuGroup>
        {remove && (
          <MenuGroup>
            <MenuRow icon={<TrashIcon className="size-5" />} onClick={() => on.onRemove(item)} danger disabled={!remove.enabled}>
              {remove.enabled ? t('common.delete') : t('live.shownCannotRemove')}
            </MenuRow>
          </MenuGroup>
        )}
      </div>
    </Sheet>
  );
}
