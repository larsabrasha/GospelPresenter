import type { SongArrangement, Theme } from '@gp/core';
import { useShownOverlay } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { tileClass } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';

/** Arrangement pills, shown when a song has two or more (spec 02); unnamed ones read "Arrangemang". */
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
          className={`${a.id === chosen ? 'bg-sky-500 text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-600'} rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors`}
        >
          {a.name ?? t('song.arrangement')}
        </AppButton>
      ))}
    </div>
  );
}

/**
 * The slides of an item, or a song in the add dialog; with the overlay the item
 * carries drawn above each. A wrapping grid of tiles (SlideGrid.razor), or with
 * `column` one under the other at full width, as the add dialog's preview.
 */
export function SlideGrid({ slides, label, theme, overlayId = null, column }: { slides: ItemSlides['slides']; label: string; theme: Theme; overlayId?: string | null; column?: boolean }) {
  const overlay = useShownOverlay(overlayId);
  return (
    <ol className={column ? 'flex flex-col gap-2' : 'flex flex-wrap gap-3'} aria-label={label}>
      {slides.map((s, i) => (
        <li key={s.key} className={`${tileClass({ interactive: false })} ${column ? '' : 'w-full sm:w-[calc(50%-0.75rem)] lg:w-96 m-1'}`} aria-label={`${label} ${i + 1}`}>
          <SlideView slide={s} theme={theme} overlay={overlay} />
        </li>
      ))}
    </ol>
  );
}
