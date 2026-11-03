import { sortedArrangements, type Overlay, type PresentationItem, type Song, type SongArrangement } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { itemActions } from '../../live/liveList.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { CONTEXT_ROW, ContextMenu } from '../../ui/ContextMenu.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { CheckIcon, CheckSquareIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon, TrashIcon } from '../../ui/icons.tsx';

/** What an item's menu needs from the page it is on, the same wherever it opens. */
export interface ItemMenuSource {
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  /** The running order's item ids, for Flytta upp and ned. */
  order: string[];
  /** The item shown, which cannot be removed. */
  shownId: string | null;
  /** A song's page, opened alone in Inställningar. */
  editHref: (item: PresentationItem) => string | undefined;
  /** A picture item's order and removal, in place. */
  onEditImages?: (item: PresentationItem) => void;
  onAddAfter: (item: PresentationItem) => void;
  /** Markera: select mode, this item ticked first. */
  onTick: (item: PresentationItem) => void;
  onRemove: (item: PresentationItem) => void;
}

/** An item's menu, open at a point: from its row at the left (a right click or its …) or its heading's …. */
export type OpenItemMenu = { item: PresentationItem; at: { x: number; y: number } };

const DIVIDER = 'h-px my-1 mx-1 bg-separator';

/** A group of choices, the chosen one ticked: an arrangement, an overlay. */
function ChoiceGroup({ label, choices, chosen, onChoose }: { label: string; choices: { id: string; title: string }[]; chosen: string; onChoose: (id: string) => void }) {
  return (
    <div role="group" aria-label={label}>
      <div className={DIVIDER} />
      <p className="px-2.5 pt-1 pb-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</p>
      {choices.map((c) => (
        <AppButton
          key={c.id}
          variant="plain"
          role="menuitemradio"
          aria-checked={chosen === c.id}
          data-choice={c.id}
          className={CONTEXT_ROW}
          // Read from the row, so what is chosen is what the row names.
          onClick={(e) => onChoose(e.currentTarget.dataset.choice ?? '')}
        >
          <span className="size-4 shrink-0">{chosen === c.id && <CheckIcon className="size-4 text-sky-500" />}</span>
          <span className="truncate">{c.title}</span>
        </AppButton>
      ))}
    </div>
  );
}

/**
 * An item's menu, one and the same from its row at the left and from its heading's … (Lars, 2026-11-03: the two
 * showed different things): Redigera (a song's page, or a picture item's pictures); Lägg till efter, Flytta upp and
 * ned, Markera; a song's arrangement when it has two or more, and the overlay it carries; and Radera last, in red,
 * which the shown item cannot.
 */
export function ItemContextMenu({ menu, source, onClose }: { menu: OpenItemMenu; source: ItemMenuSource; onClose: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const { item, at } = menu;
  const can = itemActions(source.order, item.id, source.shownId);
  const songHref = source.editHref(item);
  const song = item.type === 'song' ? source.songs.get(item.sourceId) : undefined;
  const arrangements = song && song.deletedAt === null ? sortedArrangements(source.arrangements, song.id) : [];
  const editImages = item.type === 'image' && source.onEditImages;
  return (
    <ContextMenu at={at} label={t('presentation.itemOptions', { title: item.title })} onClose={onClose}>
      {songHref && (
        <AppButton variant="plain" role="menuitem" href={songHref} className={CONTEXT_ROW}>
          <PencilIcon className="size-4" />
          {t('presentation.editSong')}
        </AppButton>
      )}
      {editImages && (
        <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => editImages(item)}>
          <PencilIcon className="size-4" />
          {t('presentation.editImages')}
        </AppButton>
      )}
      {(songHref || editImages) && <div className={DIVIDER} />}
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => source.onAddAfter(item)}>
        <PlusIcon className="size-4" />
        {t('live.addAfter')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!can.up} onClick={() => failing(db.mutate('moveItem', { itemId: item.id, by: -1 }))}>
        <ChevronUpIcon className="size-4" />
        {t('common.moveUp')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!can.down} onClick={() => failing(db.mutate('moveItem', { itemId: item.id, by: 1 }))}>
        <ChevronDownIcon className="size-4" />
        {t('common.moveDown')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => source.onTick(item)}>
        <CheckSquareIcon className="size-4" />
        {t('presentation.tick')}
      </AppButton>
      {arrangements.length > 1 && (
        <ChoiceGroup
          label={t('song.arrangements')}
          choices={arrangements.map((a, i) => ({ id: a.id, title: a.name ?? `${t('song.arrangement')} ${i + 1}` }))}
          chosen={item.arrangementId ?? arrangements[0]!.id}
          onChoose={(arrangementId) => failing(db.mutate('setItemArrangement', { itemId: item.id, arrangementId }))}
        />
      )}
      {!!source.overlays.length && (
        <ChoiceGroup
          label={t('overlays.itemOverlay')}
          choices={[{ id: '', title: t('overlays.itemNone') }, ...source.overlays.map((o) => ({ id: o.id, title: o.title }))]}
          chosen={item.overlayId ?? ''}
          onChoose={(overlayId) => failing(db.mutate('setItemOverlay', { itemId: item.id, overlayId: overlayId || null }))}
        />
      )}
      <div className={DIVIDER} />
      <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} disabled={!can.remove} onClick={() => source.onRemove(item)}>
        <TrashIcon className="size-4" strokeWidth={1.5} />
        {can.remove ? t('common.delete') : t('live.shownCannotRemove')}
      </AppButton>
    </ContextMenu>
  );
}
