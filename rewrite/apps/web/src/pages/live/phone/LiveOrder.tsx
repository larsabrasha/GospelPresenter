import type { LivePointer, PresentationItem, Slide, Theme } from '@gp/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { t } from '../../../i18n.ts';
import type { AudioControl } from '../../../live/audio.ts';
import { followsShown } from '../../../live/liveList.ts';
import type { ItemSlides } from '../../../live/live.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { EllipsisIcon } from '../../../ui/icons.tsx';
import { SlideView } from '../../../ui/SlideView.tsx';
import { ItemMedia, ItemWarnings } from '../../presentation-editor/ItemParts.tsx';
import { Description } from '../../presentation-editor/Description.tsx';

/** How tall a section's sticky heading is: a part under it is out of view. */
const HEADING = 36;

/**
 * The running order on a phone, before and while presenting (docs/layout-2-0.md): every part of every item with its
 * whole text, each item a section whose heading sticks at the top until the next pushes it away. While presenting a
 * tap on a part shows it. The list follows the shown part only when it changed some other way than a tap here, and only when the part
 * is out of view; an item just added is scrolled to and marked.
 */
export function LiveOrder({
  items,
  slides,
  theme,
  pointer,
  audio,
  addedId,
  description,
  onPick,
  onItemMenu,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  pointer: LivePointer;
  /** While presenting: the session's audio; before, an audio item plays a preview of its own. */
  audio?: AudioControl;
  /** The item just added, scrolled to and marked for a moment. */
  addedId: string | null;
  /** The presentation's description, at the top of the list. */
  description: string | null;
  /** While presenting: a part tapped is shown. */
  onPick?: (itemId: string, partIndex: number) => void;
  onItemMenu: (item: PresentationItem) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  const steps = items.flatMap((item) => (slides.get(item.id)?.slides ?? []).map((_, partIndex) => ({ itemId: item.id, partIndex })));
  const at = steps.findIndex((s) => s.itemId === pointer.itemId && s.partIndex === pointer.partIndex);
  // NÄSTA is what → shows next, after Rensa too: from the part last shown, which keeps a grey border (Lars, 2026-11-01).
  const next = at === -1 ? null : (steps[at + 1] ?? null);

  // Once for each part shown, on opening too.
  const shownKey = `${pointer.itemId}/${pointer.partIndex}`;
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (followed.current === shownKey) return;
    followed.current = shownKey;
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[data-current="true"]');
    const byTap = picked.current;
    picked.current = false;
    if (!box || !row) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (followsShown({ byTap, top, bottom: top + row.offsetHeight, viewHeight: box.clientHeight, headingHeight: HEADING }))
      box.scrollTo({ top: box.scrollTop + top - HEADING - 56, behavior: 'smooth' });
  }, [shownKey]);

  useEffect(() => {
    const box = list.current;
    const section = addedId ? box?.querySelector<HTMLElement>(`[data-item="${addedId}"]`) : null;
    if (box && section) box.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
  }, [addedId]);

  const badge = (itemId: string, partIndex: number) => {
    if (!pointer.black && itemId === pointer.itemId && partIndex === pointer.partIndex) return { text: t('live.shownBadge'), className: 'bg-red-600 text-white' };
    if (next && itemId === next.itemId && partIndex === next.partIndex) return { text: t('live.nextBadge'), className: 'bg-sky-500/15 text-sky-500' };
    return null;
  };

  return (
    <div ref={list} className="relative flex-1 min-h-0 overflow-y-auto px-4 pb-24" data-testid="live-order">
      <div className="flex flex-col gap-2">
        {description && <Description key={description} text={description} className="mt-2" />}
        {items.map((item) => {
          const set = slides.get(item.id);
          const liveHere = !pointer.black && item.id === pointer.itemId;
          return (
            <section key={item.id} data-item={item.id} aria-label={item.title} className="flex flex-col gap-1.5">
              {/* As iOS's grouped lists: the heading close above its rows, the space between the sections above it. */}
              <h3
                className={`sticky top-0 z-[1] -mx-4 px-5 pt-5 pb-0.5 flex items-center justify-between gap-3 text-[13px]/4 font-semibold uppercase tracking-wide backdrop-blur-md bg-ground/90 transition-colors ${item.id === addedId ? 'text-sky-500' : 'text-neutral-500 dark:text-neutral-400'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{item.title}</span>
                  {liveHere && <span className="size-2 rounded-full bg-red-500 shrink-0" aria-label={t('live.badge')} />}
                </span>
                <AppButton
                  variant="plain"
                  aria-label={t('live.itemMore', { title: item.title })}
                  onClick={() => onItemMenu(item)}
                  // 44 pt to a finger, drawn into the heading's space above and down to the card, so the row stays its height.
                  className="-mr-3 -mt-5 -mb-2 size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-neutral-600 dark:text-neutral-300"
                >
                  <EllipsisIcon className="size-5" />
                </AppButton>
              </h3>
              <ItemWarnings item={item} set={set} songName={undefined} />
              {/* The video plays in the picture while presenting. */}
              {(set?.audio || (!audio && set?.video)) && <ItemMedia item={item} set={set} players={audio && { audio }} shownId={pointer.itemId} />}
              {set?.slides.map((slide, partIndex) => {
                const current = liveHere && partIndex === pointer.partIndex;
                // After Rensa, the part last shown keeps a quiet grey border: where → goes on from.
                const rested = pointer.black && item.id === pointer.itemId && partIndex === pointer.partIndex;
                const mark = badge(item.id, partIndex);
                return (
                  <AppButton
                    key={slide.key}
                    variant="plain"
                    data-current={current}
                    data-rested={rested || undefined}
                    aria-current={current || undefined}
                    onClick={
                      onPick &&
                      (() => {
                        picked.current = true;
                        onPick(item.id, partIndex);
                      })
                    }
                    // The border is always there, clear until the part is shown, so the shown card is no bigger than the rest.
                    className={`w-full flex gap-3 px-3.5 py-2.5 rounded-2xl border-2 text-left ${onPick ? 'cursor-pointer' : 'cursor-default'} ${slide.kind === 'media' ? 'items-center' : 'items-start'} ${current ? 'bg-surface dark:bg-raised border-red-500' : rested ? 'bg-surface border-neutral-300 dark:border-neutral-600' : 'bg-surface border-transparent'}`}
                  >
                    {slide.kind === 'media' && (
                      <span className="w-24 aspect-video shrink-0 rounded-lg overflow-hidden">
                        <SlideView slide={slide} theme={theme} label={false} credits={false} />
                      </span>
                    )}
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400 truncate">{partLabel(slide, partIndex)}</span>
                        {mark && <span className={`shrink-0 text-[11px] font-bold tracking-wide px-2 py-0.5 rounded-lg ${mark.className}`}>{mark.text}</span>}
                      </span>
                      {slide.kind !== 'media' && <span className="text-[17px]/snug whitespace-pre-line text-neutral-900 dark:text-neutral-100">{slide.text}</span>}
                    </span>
                  </AppButton>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A part's name: its label (Vers 1), else its place in the item. */
function partLabel(slide: Slide, partIndex: number): string {
  return slide.label?.text ?? String(partIndex + 1);
}
