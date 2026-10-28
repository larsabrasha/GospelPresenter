import type { Overlay, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
import type { ReactNode } from 'react';
import { useBlobUrl, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ChevronDownIcon, WarningIcon } from '../../ui/icons.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { ArrangementPills, SlideGrid } from './SlideGrid.tsx';

/** An audio item in the editor: a player for the file (spec 03), once this device has it, in a card (AudioPlayer.razor). */
function AudioPreview({ hash, name }: { hash: string; name: string }) {
  const url = useBlobUrl(hash);
  return (
    <div className="w-full sm:max-w-lg sm:mx-auto bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm space-y-3">
      <p className="text-sm font-medium truncate">{name}</p>
      {url ? <audio controls src={url} aria-label={name} data-testid="audio-preview" className="w-full" /> : <p className="text-sm text-neutral-400">{t('presentation.audioFetching')}</p>}
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
 * The selected item in the main area: its warnings, the audio player, the
 * arrangement and overlay pickers, and its slides.
 */
export function SelectedItem({
  selected,
  selectedSong,
  selectedArrangements,
  selectedSlides,
  overlays,
  theme,
}: {
  selected: PresentationItem;
  selectedSong: Song | undefined;
  selectedArrangements: SongArrangement[];
  selectedSlides: ItemSlides | undefined;
  overlays: Overlay[];
  theme: Theme;
}) {
  const db = useDb();
  const toast = useToast();
  return (
    <>
      {selectedSlides?.problem === 'song-trashed' && (
        <ItemWarning
          action={
            <AppButton
              variant="secondary"
              onClick={async () => {
                await db.mutate('restoreSong', { id: selected.sourceId });
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
      {selectedSlides?.audio && <AudioPreview hash={selectedSlides.audio.hash} name={selectedSlides.audio.fileName} />}
      {(selectedSong?.deletedAt === null || !!overlays.length) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 empty:hidden">
          {selectedSong?.deletedAt === null && (
            <ArrangementPills
              arrangements={selectedArrangements}
              chosen={selected.arrangementId ?? selectedArrangements[0]?.id ?? null}
              onChoose={(arrangementId) => void db.mutate('setItemArrangement', { itemId: selected.id, arrangementId })}
            />
          )}
          {!!overlays.length && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400" title={t('overlays.itemHint')}>
              {t('overlays.itemOverlay')}
              <span className="relative">
                <select
                  aria-label={t('overlays.itemOverlay')}
                  value={selected.overlayId ?? ''}
                  onChange={(e) => void db.mutate('setItemOverlay', { itemId: selected.id, overlayId: e.target.value || null })}
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
      {selectedSlides && <SlideGrid theme={theme} label={selected.title} slides={selectedSlides.slides} overlayId={selected.overlayId} />}
    </>
  );
}
