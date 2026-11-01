import type { LibraryVideo, Overlay, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
import { useEffect, useState, type ReactNode } from 'react';
import { AudioEngine, type AudioControl } from '../../live/audio.ts';
import { AudioPlayer } from '../live/AudioPlayer.tsx';
import { VideoPlayer } from '../live/VideoPlayer.tsx';
import type { VideoControl } from '../../live/video.ts';
import { canPlayVideo, codecName, playUrl } from '../../media/video.ts';
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
import { ArrangementPills } from './SlideGrid.tsx';

/**
 * An audio item in the editor: the player of the live page (AudioPlayer.razor), on a preview of its
 * own that stops when the item is left; once this device has the file.
 */
function AudioPreview({ itemId, hash, name }: { itemId: string; hash: string; name: string }) {
  const url = useBlobUrl(hash);
  if (!url)
    return (
      <div className="w-full sm:max-w-lg bg-surface rounded-xl p-4 shadow-sm space-y-3">
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
    <div className="w-full sm:max-w-lg">
      <AudioPlayer control={engine} itemId={itemId} name={name} testId="audio-preview" />
    </div>
  );
}

/**
 * A video item in the editor: a player that streams the video from the server when it is played and
 * keeps nothing (TODO.md "Video"), over its still. A device that cannot play the codec says so.
 */
function VideoPreview({ video }: { video: LibraryVideo }) {
  const poster = useBlobUrl(video.stillHash);
  const playable = canPlayVideo(video.contentType, video.codec);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!playable) return;
    let live = true;
    void playUrl(video.hash).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [video.hash, playable]);
  return (
    <div className="w-full sm:max-w-lg space-y-2">
      {!playable && <ItemWarning>{t('videos.cannotPlay', { codec: codecName(video.codec) })}</ItemWarning>}
      {playable ? (
        <video
          className="w-full aspect-video rounded-xl bg-black"
          controls
          playsInline
          preload="none"
          poster={poster ?? undefined}
          src={src ?? undefined}
          aria-label={t('videos.preview', { name: video.fileName })}
          data-testid="video-preview"
        />
      ) : (
        poster && <img className="w-full aspect-video object-contain rounded-xl bg-black" src={poster} alt="" draggable={false} />
      )}
    </div>
  );
}

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
    </>
  );
}

/** While presenting: the session's audio and video, which an item's players drive. */
export type Players = { audio: AudioControl; video?: VideoControl };

/**
 * An audio or video item's player: while presenting the session's own (what plays on the presenting computer, the
 * outputs following its picture), the video only on the item shown; before, a preview of its own.
 */
export function ItemMedia({ item, set, players, shownId }: { item: PresentationItem; set: ItemSlides | undefined; players?: Players; shownId: string | null }) {
  if (set?.audio)
    return players ? (
      <div className="w-full sm:max-w-lg">
        <AudioPlayer control={players.audio} itemId={item.id} name={set.audio.fileName} />
      </div>
    ) : (
      <AudioPreview key={item.id} itemId={item.id} hash={set.audio.hash} name={set.audio.fileName} />
    );
  if (set?.video) {
    if (!players) return <VideoPreview key={item.id} video={set.video} />;
    if (!players.video || item.id !== shownId) return null;
    return (
      <div className="w-full sm:max-w-lg">
        <VideoPlayer control={players.video} itemId={item.id} name={set.video.fileName} type={set.video.contentType} codec={set.video.codec} />
      </div>
    );
  }
  return null;
}

/** A song item's arrangement, when it has two or more, and the overlay any item carries, when there are overlays. */
export function ItemSettings({ item, song, arrangements, overlays }: { item: PresentationItem; song: Song | undefined; arrangements: SongArrangement[]; overlays: Overlay[] }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const pills = song?.deletedAt === null && arrangements.length > 1;
  if (!pills && !overlays.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {pills && (
        <ArrangementPills
          arrangements={arrangements}
          chosen={item.arrangementId ?? arrangements[0]?.id ?? null}
          onChoose={(arrangementId) => failing(db.mutate('setItemArrangement', { itemId: item.id, arrangementId }))}
        />
      )}
      {!!overlays.length && (
        <label className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400" title={t('overlays.itemHint')}>
          {t('overlays.itemOverlay')}
          <span className="relative">
            <select
              aria-label={t('overlays.itemOverlay')}
              value={item.overlayId ?? ''}
              onChange={(e) => failing(db.mutate('setItemOverlay', { itemId: item.id, overlayId: e.target.value || null }))}
              className="appearance-none h-7 pl-3 pr-8 rounded-full text-[13px] bg-raised dark:bg-raised-2 text-neutral-900 dark:text-neutral-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">{t('overlays.itemNone')}</option>
              {overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="size-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </span>
        </label>
      )}
    </div>
  );
}
