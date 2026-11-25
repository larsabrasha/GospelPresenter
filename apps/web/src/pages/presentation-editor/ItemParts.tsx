import type { PresentationItem, Theme, ItemSlides } from '@gp/core';
import { useRef, type ReactNode } from 'react';
import type { AudioControl } from '../../live/audio.ts';
import type { ItemChoice } from '../../live/itemMenu.ts';
import type { VideoControl } from '../../live/video.ts';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { ChevronUpDownIcon, CloseIcon, PlusIcon, RectangleStackIcon, SquaresOverlapIcon, WarningIcon } from '../../ui/icons.tsx';
import { ICON_GROUP } from '../../ui/Sheet.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useSortable } from '../../ui/sortable.ts';
import { tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import { useToast } from '../../ui/Toast.tsx';

/** A warning about an item, under its heading, with an action at its end when there is one. */
function ItemWarning({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      <WarningIcon className="size-5 shrink-0" />
      <p className="flex-1 min-w-0">{children}</p>
      {action}
    </div>
  );
}

/**
 * An image item's pictures in Redigera (SlideGrid.razor's image edit mode): one under the other,
 * dragged to a new place, each with a red ✕ that removes it after a question, and a dashed tile
 * that adds more. Removing the last removes the item.
 */
export function ImageItemEditor({ item, slides, theme, onAddImages }: { item: PresentationItem; slides: ItemSlides['slides']; theme: Theme; onAddImages: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const { dialog, ask } = useConfirm();
  // The picture a key moved, to have focus at its new place once the list is drawn again.
  const refocus = useRef<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= slides.length) return;
    refocus.current = to;
    failing(db.mutate('moveItemImage', { itemId: item.id, from, to }));
  };
  const { listRef, rowStyle, handle } = useSortable<HTMLOListElement>(move);
  return (
    <>
      {dialog}
      <ol ref={listRef} className="flex flex-col gap-3" aria-label={item.title} data-testid="image-order">
        {slides.map((s, i) => (
          // Dragged; with focus on it, Alt+↑/↓ moves it, as an arrangement's parts.
          <li
            key={s.key}
            data-sort-row
            style={rowStyle(i)}
            {...handle(i)}
            tabIndex={0}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            ref={(el) => {
              if (el && refocus.current === i) {
                refocus.current = null;
                el.focus();
              }
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              // The picture's, not the running order's Alt+↑/↓ (the page's keys).
              e.preventDefault();
              e.stopPropagation();
              move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
            }}
            className={`${tileClass({ interactive: false })} w-full sm:w-96 m-1 cursor-grab active:cursor-grabbing touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
            aria-label={`${item.title} ${i + 1}`}
          >
            <SlideView slide={s} theme={theme} credits={false} />
            <AppButton
              variant="plain"
              className="absolute top-2 right-2 z-10 bg-red-500 hover:bg-red-600 text-white rounded-full size-6 flex items-center justify-center cursor-pointer"
              title={t('common.delete')}
              aria-label={t('presentation.removeImage', { n: i + 1 })}
              onClick={async () => {
                const ok = await ask({ title: t('common.delete'), text: t('presentation.removeImageConfirm'), confirm: t('common.delete'), compact: true });
                if (ok) failing(db.mutate('removeItemImage', { itemId: item.id, index: i }));
              }}
            >
              <CloseIcon className="size-3.5" />
            </AppButton>
          </li>
        ))}
      </ol>
      <AppButton
        variant="plain"
        className="aspect-video w-full sm:w-96 m-1 border-2 border-dashed border-stone-300 dark:border-stone-600 rounded-2xl flex items-center justify-center cursor-pointer hover:border-sky-500 hover:text-sky-500 text-stone-400 dark:text-stone-500 transition-colors"
        title={t('presentation.addMoreImages')}
        aria-label={t('presentation.addMoreImages')}
        onClick={onAddImages}
      >
        <PlusIcon className="size-8" />
      </AppButton>
    </>
  );
}

/** What is wrong with an item, under its heading: a song in the trash offers Återställ. */
export function ItemWarnings({ item, set, songName }: { item: PresentationItem; set: ItemSlides | undefined; songName: string | undefined }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  return (
    <>
      {set?.problem === 'song-trashed' && (
        <ItemWarning
          action={
            <AppButton
              variant="secondary"
              onClick={async () => {
                if (!(await trySave(db.mutate('restoreSong', { id: item.sourceId })))) return;
                toast(t('presentation.songRestored', { name: songName ?? item.title }));
              }}
            >
              {t('common.restore')}
            </AppButton>
          }
        >
          {t('presentation.songTrashed')}
        </ItemWarning>
      )}
      {set?.problem === 'song-missing' && <ItemWarning>{t('presentation.songMissing')}</ItemWarning>}
      {set?.problem === 'image-missing' && <ItemWarning>{t('presentation.imageMissing')}</ItemWarning>}
      {set?.problem === 'audio-missing' && <ItemWarning>{t('presentation.audioMissing')}</ItemWarning>}
      {set?.problem === 'video-missing' && <ItemWarning>{t('presentation.videoMissing')}</ItemWarning>}
      {set?.problem === 'custom-missing' && <ItemWarning>{t('presentation.customMissing')}</ItemWarning>}
    </>
  );
}

/** While presenting: the session's audio and video, which the controls on the live picture drive. */
export type Players = { audio: AudioControl; video?: VideoControl };


/**
 * A choice in a phone's item sheet, as iOS's Settings has one: a row of the sheet's card, its icon and name at the left
 * as the sheet's other rows have them (Lars, 2026-11-03) and the chosen value in grey at the right with ⌃⌄, the whole
 * row opening the menu (Lars, 2026-11-02).
 */
function SheetChoice({ label, icon, title, value, choices, onChoose }: { label: string; icon: ReactNode; title?: string; value: string; choices: { id: string; title: string }[]; onChoose: (id: string) => void }) {
  return (
    <label className="relative w-full min-h-12 px-4 flex items-center justify-between gap-3 text-[17px] cursor-pointer" title={title}>
      <span className="shrink-0 flex items-center gap-3.5">
        <span className="shrink-0 flex text-stone-500 dark:text-stone-400">{icon}</span>
        {label}
      </span>
      <span className="flex items-center gap-1 min-w-0 text-stone-500 dark:text-stone-400">
        <span className="truncate">{choices.find((c) => c.id === value)?.title}</span>
        <ChevronUpDownIcon className="size-4 shrink-0" />
      </span>
      {/* The menu itself, unseen over the whole row, so a tap anywhere on it opens the system's menu. */}
      <select aria-label={label} value={value} onChange={(e) => onChoose(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer">
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A song item's arrangement and the overlay an item carries, in a phone's item sheet (on a computer they are in the
 * heading's …, ItemContextMenu), when the item's menu offers them (live/itemMenu.ts: a song not in the trash with
 * arrangements; overlays there, and not a heading). Out of sight in the slides: the arrangement is chosen
 * when the song is added, and here only changed (Lars, 2026-11-02).
 */
export function ItemSettings({ item, arrangement, overlay }: { item: PresentationItem; arrangement: ItemChoice | null; overlay: ItemChoice | null }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  if (!arrangement && !overlay) return null;
  return (
    <div className={ICON_GROUP}>
      {arrangement && (
        <SheetChoice
          label={t('song.arrangements')}
          icon={<RectangleStackIcon className="size-5" />}
          value={arrangement.chosen}
          choices={arrangement.choices}
          onChoose={(arrangementId) => failing(db.mutate('setItemArrangement', { itemId: item.id, arrangementId }))}
        />
      )}
      {overlay && (
        <SheetChoice
          label={t('overlays.itemOverlay')}
          icon={<SquaresOverlapIcon className="size-5" />}
          title={t('overlays.itemHint')}
          value={overlay.chosen}
          choices={overlay.choices}
          onChoose={(overlayId) => failing(db.mutate('setItemOverlay', { itemId: item.id, overlayId: overlayId || null }))}
        />
      )}
    </div>
  );
}
