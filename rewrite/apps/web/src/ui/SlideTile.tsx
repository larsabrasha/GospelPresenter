import { t } from '../i18n.ts';
import type { SlideMarkKind } from '../live/liveList.ts';

// A slide in a grid, as the current app draws one (Components/Slide.razor):
// rounded, with a thin dark edge at the top and a thick outline that marks
// the chosen slide, red while it is on the screens.

// A hairline round it in dark mode, so a black slide keeps its edge on a dark ground.
const BASE = 'block relative aspect-video rounded-2xl overflow-hidden border-t-[0.5px] border-stone-800/90 outline-4 dark:ring-[0.5px] dark:ring-white/15';

/**
 * The classes of a slide tile. `selected` is the chosen slide; `live` that the
 * presentation is showing (not the black screen), which turns the marks red.
 * A tile that is only shown, not chosen from, has no outline at all.
 */
export function tileClass({ selected, live, rested, interactive = true }: { selected?: boolean; live?: boolean; rested?: boolean; interactive?: boolean }): string {
  if (!interactive) return `${BASE} outline-transparent`;
  // `rested`: the slide last shown before Rensa, where → goes on from: a quiet grey, as nothing shows now.
  const mark = selected
    ? live
      ? 'outline-red-500 hover:outline-red-500'
      : 'outline-sky-500 hover:outline-sky-500'
    : rested
      ? 'outline-stone-400 dark:outline-stone-500 hover:outline-red-500'
      : live
        ? 'outline-transparent hover:outline-red-500'
        : 'outline-transparent hover:outline-sky-500';
  return `${BASE} cursor-pointer ${mark}`;
}

/** VISAS or NÄSTA on a slide while presenting (live/liveList.ts `slideMarks`), on a computer's tile and a phone's row. */
export function SlideMark({ kind, className }: { kind: SlideMarkKind; className?: string }) {
  return (
    <span
      className={`shrink-0 text-[11px]/4 font-bold tracking-wide px-2 py-0.5 rounded-lg pointer-events-none ${kind === 'shown' ? 'bg-red-600 text-white' : 'bg-sky-500/15 text-sky-500'} ${className ?? ''}`}
    >
      {kind === 'shown' ? t('live.shownBadge') : t('live.nextBadge')}
    </span>
  );
}
