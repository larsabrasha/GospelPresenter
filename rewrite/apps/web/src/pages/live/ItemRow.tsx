import type { LivePointer, Overlay, PresentationItem, Theme } from '@gp/core';
import { t } from '../../i18n.ts';
import type { AudioControl } from '../../live/audio.ts';
import type { ItemSlides } from '../../live/live.ts';
import type { LiveControl } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ItemIcon } from '../../ui/icons.tsx';
import { LiveBadge, tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import { AudioPlayer } from './AudioPlayer.tsx';

const problemText = { 'song-missing': t('live.songMissing'), 'song-trashed': t('live.songTrashed'), 'no-parts': t('live.noParts'), 'image-missing': t('live.imageMissing'), 'audio-missing': t('live.audioMissing') };

/** One item of the running order on the live page: its caption, a problem, an audio player, and its slide tiles. */
export function ItemRow({
  item,
  slides: s,
  overlays,
  theme,
  pointer,
  live,
  audio,
}: {
  item: PresentationItem;
  slides: ItemSlides;
  overlays: Overlay[];
  theme: Theme;
  pointer: LivePointer;
  live: LiveControl;
  audio: AudioControl;
}) {
  const selected = item.id === pointer.itemId;
  const carried = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  return (
    <li className="space-y-2">
      <h3 className={`flex items-center gap-2 px-2 text-sm/6 font-semibold ${selected ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}>
        <span className={`size-2 shrink-0 rounded-full ${selected && !pointer.black ? 'bg-red-500 animate-pulse' : ''}`} />
        <ItemIcon type={item.type} className="size-4 shrink-0" />
        <span className="truncate">{item.title}</span>
        {carried && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-normal bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400" title={t('overlays.carried')}>
            {carried.title}
          </span>
        )}
      </h3>
      {s.problem && <p className="mx-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{problemText[s.problem]}</p>}
      {s.audio && (
        <div className="px-1">
          <AudioPlayer control={audio} itemId={item.id} name={s.audio.fileName} />
        </div>
      )}
      {!!s.slides.length && (
        <div className="flex flex-wrap gap-3">
          {s.slides.map((slide, i) => {
            const shown = selected && i === pointer.partIndex;
            return (
              <AppButton
                key={slide.key}
                variant="plain"
                aria-label={`${item.title} ${i + 1}`}
                aria-pressed={shown}
                className={`${tileClass({ selected: shown, live: !pointer.black })} w-full sm:w-[calc(50%-0.75rem)] lg:w-96 m-1 p-0`}
                onClick={() => live.set({ itemId: item.id, partIndex: i, black: false })}
              >
                <SlideView slide={slide} theme={theme} />
                {shown && !pointer.black && <LiveBadge>{t('stage.live')}</LiveBadge>}
              </AppButton>
            );
          })}
        </div>
      )}
    </li>
  );
}
