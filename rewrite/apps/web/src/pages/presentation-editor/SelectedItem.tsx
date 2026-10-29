import type { Overlay, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
import { useEffect, useState, type ReactNode } from 'react';
import { AudioEngine } from '../../live/audio.ts';
import { AudioPlayer } from '../live/AudioPlayer.tsx';
import { useBlobUrl, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed, useTrySave } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { ChevronDownIcon, CloseIcon, PlusIcon, WarningIcon } from '../../ui/icons.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useSortable } from '../../ui/sortable.ts';
import { tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { ArrangementPills, SlideGrid } from './SlideGrid.tsx';

/**
 * An audio item in the editor: the player of the live page (AudioPlayer.razor), on a preview of its
 * own that stops when the item is left; once this device has the file.
 */
function AudioPreview({ itemId, hash, name }: { itemId: string; hash: string; name: string }) {
  const url = useBlobUrl(hash);
  if (!url)
    return (
      <div className="w-full sm:max-w-lg sm:mx-auto bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm space-y-3">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-sm text-neutral-400">{t('presentation.audioFetching')}</p>
      </div>
    );
  return <PreviewPlayer key={url} url={url} itemId={itemId} name={name} />;
}

function PreviewPlayer({ url, itemId, name }: { url: string; itemId: string; name: string }) {
  const [engine] = useState(() => new AudioEngine(async () => url));
  useEffect(() => () => engine.stop(), [engine]);
  return (
    <div className="w-full sm:max-w-lg sm:mx-auto">
      <AudioPlayer control={engine} itemId={itemId} name={name} testId="audio-preview" />
    </div>
  );
}

/** A warning about the selected item, in the main area, with an action at its end when there is one. */
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
function ImageItemEditor({ item, slides, theme, onAddImages }: { item: PresentationItem; slides: ItemSlides['slides']; theme: Theme; onAddImages: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const { dialog, ask } = useConfirm();
  const { listRef, rowStyle, handle } = useSortable<HTMLOListElement>((from, to) => failing(db.mutate('moveItemImage', { itemId: item.id, from, to })));
  return (
    <>
      {dialog}
      <ol ref={listRef} className="flex flex-col gap-3" aria-label={item.title} data-testid="image-order">
        {slides.map((s, i) => (
          <li key={s.key} data-sort-row style={rowStyle(i)} {...handle(i)} className={`${tileClass({ interactive: false })} w-full sm:w-96 m-1 cursor-grab active:cursor-grabbing touch-none select-none`} aria-label={`${item.title} ${i + 1}`}>
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
        className="aspect-video w-full sm:w-96 m-1 border-2 border-dashed border-neutral-300 dark:border-neutral-600 rounded-2xl flex items-center justify-center cursor-pointer hover:border-sky-500 hover:text-sky-500 text-neutral-400 dark:text-neutral-500 transition-colors"
        title={t('presentation.addMoreImages')}
        aria-label={t('presentation.addMoreImages')}
        onClick={onAddImages}
      >
        <PlusIcon className="size-8" />
      </AppButton>
    </>
  );
}

/**
 * The selected item in the main area: its warnings, the audio player, the
 * arrangement and overlay pickers, and its slides; an image item's pictures to
 * reorder, remove and add to while `editingImages`.
 */
export function SelectedItem({
  selected,
  selectedSong,
  selectedArrangements,
  selectedSlides,
  overlays,
  theme,
  editingImages,
  onAddImages,
}: {
  editingImages: boolean;
  onAddImages: () => void;
  selected: PresentationItem;
  selectedSong: Song | undefined;
  selectedArrangements: SongArrangement[];
  selectedSlides: ItemSlides | undefined;
  overlays: Overlay[];
  theme: Theme;
}) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  return (
    <>
      {selectedSlides?.problem === 'song-trashed' && (
        <ItemWarning
          action={
            <AppButton
              variant="secondary"
              onClick={async () => {
                if (!(await trySave(db.mutate('restoreSong', { id: selected.sourceId })))) return;
                toast(t('presentation.songRestored', { name: selectedSong?.name ?? selected.title }));
              }}
            >
              {t('common.restore')}
            </AppButton>
          }
        >
          {t('presentation.songTrashed')}
        </ItemWarning>
      )}
      {selectedSlides?.problem === 'song-missing' && <ItemWarning>{t('presentation.songMissing')}</ItemWarning>}
      {selectedSlides?.problem === 'image-missing' && <ItemWarning>{t('presentation.imageMissing')}</ItemWarning>}
      {selectedSlides?.problem === 'audio-missing' && <ItemWarning>{t('presentation.audioMissing')}</ItemWarning>}
      {selectedSlides?.audio && <AudioPreview key={selected.id} itemId={selected.id} hash={selectedSlides.audio.hash} name={selectedSlides.audio.fileName} />}
      {(selectedSong?.deletedAt === null || !!overlays.length) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 empty:hidden">
          {selectedSong?.deletedAt === null && (
            <ArrangementPills
              arrangements={selectedArrangements}
              chosen={selected.arrangementId ?? selectedArrangements[0]?.id ?? null}
              onChoose={(arrangementId) => failing(db.mutate('setItemArrangement', { itemId: selected.id, arrangementId }))}
            />
          )}
          {!!overlays.length && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400" title={t('overlays.itemHint')}>
              {t('overlays.itemOverlay')}
              <span className="relative">
                <select
                  aria-label={t('overlays.itemOverlay')}
                  value={selected.overlayId ?? ''}
                  onChange={(e) => failing(db.mutate('setItemOverlay', { itemId: selected.id, overlayId: e.target.value || null }))}
                  className="appearance-none py-1.5 pl-3 pr-8 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">{t('overlays.itemNone')}</option>
                  {overlays.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </span>
              <span className="text-xs text-neutral-400 dark:text-neutral-500">{t('overlays.itemHint')}</span>
            </label>
          )}
        </div>
      )}
      {selectedSlides && selected.type === 'image' && editingImages ? (
        <ImageItemEditor item={selected} slides={selectedSlides.slides} theme={theme} onAddImages={onAddImages} />
      ) : (
        selectedSlides && <SlideGrid theme={theme} label={selected.title} slides={selectedSlides.slides} overlayId={selected.overlayId} />
      )}
    </>
  );
}
