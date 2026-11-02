import type { LivePointer, SongArrangement, Theme } from '@gp/core';
import { useShownOverlay } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import type { SlideMarkKind } from '../../live/liveList.ts';
import { SlideMark, tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

/** Arrangement pills, shown when a song has two or more (spec 02); unnamed ones read "Ordning". */
export function ArrangementPills({ arrangements, chosen, onChoose, className }: { arrangements: SongArrangement[]; chosen: string | null; onChoose: (id: string) => void; className?: string }) {
  if (arrangements.length < 2) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`} role="group" aria-label={t('song.arrangements')}>
      {arrangements.map((a) => (
        <AppButton
          key={a.id}
          variant="plain"
          aria-pressed={a.id === chosen}
          onClick={() => onChoose(a.id)}
          className={`${a.id === chosen ? 'bg-sky-500 text-white' : 'bg-stone-200 dark:bg-raised text-stone-700 dark:text-stone-200 hover:bg-stone-300 dark:hover:bg-raised-2'} rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors`}
        >
          {a.name ?? t('song.arrangement')}
        </AppButton>
      ))}
    </div>
  );
}

/**
 * The slides of an item, or a song in the add dialog; with the overlay the item
 * carries drawn above each, and no credits (SlideGrid.razor gives its tiles none).
 * A wrapping grid of tiles: one to a row on a phone, three to `lg`, then 384 px
 * each (SlideGrid.razor's scale); or with `column` one under the other at full
 * width, as the add dialog's preview, which marks its search's words with `highlight`.
 * With `shown`, while presenting, each tile is a button that shows its slide live, and the
 * one shown is marked (SlideGrid.razor's SelectSlide).
 */
export function SlideGrid({
  slides,
  label,
  theme,
  overlayId = null,
  column,
  highlight,
  shown,
}: {
  slides: ItemSlides['slides'];
  label: string;
  theme: Theme;
  overlayId?: string | null;
  column?: boolean;
  highlight?: string;
  shown?: { pointer: LivePointer; itemId: string; mark: (partIndex: number) => SlideMarkKind | null; onShow: (partIndex: number) => void };
}) {
  const overlay = useShownOverlay(overlayId);
  const size = column ? '' : 'w-full md:w-[calc(33.333%-0.75rem)] lg:w-96 m-1';
  if (shown) {
    const { pointer } = shown;
    return (
      <ol className="flex flex-wrap gap-3" aria-label={label}>
        {slides.map((s, i) => {
          // After Rensa nothing is shown: the slide last shown is only outlined in grey, where → goes on from.
          const here = pointer.itemId === shown.itemId && pointer.partIndex === i;
          const live = here && !pointer.black;
          const mark = shown.mark(i);
          return (
            <li key={s.key} className={`${size} flex`}>
              <AppButton
                variant="plain"
                aria-label={`${label} ${i + 1}`}
                aria-pressed={live}
                data-current={live}
                className={`${tileClass({ selected: live, live: true, rested: here && pointer.black })} w-full p-0`}
                onClick={() => shown.onShow(i)}
              >
                <SlideView slide={s} theme={theme} overlay={overlay} credits={false} />
                {mark && <SlideMark kind={mark} className="absolute top-2 left-2 z-[3]" />}
              </AppButton>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol className={column ? 'flex flex-col gap-2' : 'flex flex-wrap gap-3'} aria-label={label}>
      {slides.map((s, i) => (
        <li key={s.key} className={`${tileClass({ interactive: false })} ${size}`} aria-label={`${label} ${i + 1}`}>
          <SlideView slide={s} theme={theme} overlay={overlay} credits={false} highlight={highlight} />
        </li>
      ))}
    </ol>
  );
}
