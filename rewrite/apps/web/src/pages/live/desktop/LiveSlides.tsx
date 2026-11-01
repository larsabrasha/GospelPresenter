import type { LivePointer, PresentationItem, Theme } from '@gp/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { t } from '../../../i18n.ts';
import type { AudioControl } from '../../../live/audio.ts';
import { followsShown } from '../../../live/liveList.ts';
import type { ItemSlides } from '../../../live/live.ts';
import type { VideoControl } from '../../../live/video.ts';
import { SlideGrid } from '../../presentation-editor/SlideGrid.tsx';
import { AudioPlayer } from '../AudioPlayer.tsx';
import { VideoPlayer } from '../VideoPlayer.tsx';

/** How tall a section's sticky heading is: a slide under it is out of view. */
const HEADING = 44;

/**
 * The middle while presenting on a computer (docs/layout-2-0.md): the whole running order, each item a section
 * whose heading sticks at the top, its slides a grid; a click shows one. It follows the shown slide only when that
 * changed some other way than a click here, and only when out of view; `reveal` scrolls to an item chosen at the left.
 */
export function LiveSlides({
  items,
  slides,
  theme,
  pointer,
  audio,
  video,
  reveal,
  onShow,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  pointer: LivePointer;
  audio: AudioControl;
  video?: VideoControl;
  /** The item last chosen at the left, and a count so choosing it again scrolls again. */
  reveal: { id: string; n: number } | null;
  onShow: (itemId: string, partIndex: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const clicked = useRef(false);

  // Once for each slide shown, on opening too.
  const shownKey = `${pointer.itemId}/${pointer.partIndex}`;
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (followed.current === shownKey) return;
    followed.current = shownKey;
    const el = box.current;
    const tile = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const byTap = clicked.current;
    clicked.current = false;
    if (!el || !tile) return;
    const top = tile.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (followsShown({ byTap, top, bottom: top + tile.offsetHeight, viewHeight: el.clientHeight, headingHeight: HEADING }))
      el.scrollTo({ top: el.scrollTop + top - HEADING - 16, behavior: 'smooth' });
  }, [shownKey]);

  useEffect(() => {
    const el = box.current;
    const section = reveal ? el?.querySelector<HTMLElement>(`[data-item="${reveal.id}"]`) : null;
    if (el && section) el.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
  }, [reveal]);

  return (
    <div ref={box} className="relative flex-1 min-w-0 overflow-y-auto px-6 pb-12 bg-ground" data-testid="live-slides">
      {items.map((item) => {
        const set = slides.get(item.id);
        return (
          <section key={item.id} data-item={item.id} aria-label={item.title} className="flex flex-col gap-2 pb-3">
            <h3 className="sticky top-0 z-[2] -mx-6 px-6 pt-3.5 pb-2 flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 bg-ground/90 backdrop-blur-md">
              <span className="truncate">{item.title}</span>
              {item.id === pointer.itemId && <span className="size-2 rounded-full bg-red-500 shrink-0" aria-label={t('live.badge')} />}
            </h3>
            {set?.audio && <AudioPlayer control={audio} itemId={item.id} name={set.audio.fileName} />}
            {set?.video && video && item.id === pointer.itemId && <VideoPlayer control={video} itemId={item.id} name={set.video.fileName} type={set.video.contentType} codec={set.video.codec} />}
            {!!set?.slides.length && (
              <SlideGrid
                slides={set.slides}
                label={item.title}
                theme={theme}
                overlayId={item.overlayId}
                shown={{
                  pointer,
                  itemId: item.id,
                  onShow: (partIndex) => {
                    clicked.current = true;
                    onShow(item.id, partIndex);
                  },
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
