import type { Slide } from '@gp/core';
import { t } from '../i18n.ts';
import { SpeakerWaveIcon } from './icons.tsx';
import type { SlideMarkKind } from '@gp/core';

// A slide in a grid, as the current app draws one (Components/Slide.razor):
// rounded, with a thin dark edge at the top and a thick outline that marks
// the chosen slide, red while it is on the screens.

// A hairline round it in dark mode, so a black slide keeps its edge on a dark ground. `isolate`: the layers inside
// (its number, VISAS, the black cover) stack within the tile, so a sticky heading scrolled over it stays on top.
const BASE = 'block relative isolate aspect-video rounded-2xl overflow-hidden border-t-[0.5px] border-stone-800/90 outline-4 dark:ring-[0.5px] dark:ring-white/15';

/**
 * The classes of a slide tile. `selected` is the chosen slide; `live` that the
 * presentation is showing (not the black screen), which turns the marks red.
 * A tile that is only shown, not chosen from, has no outline at all.
 */
export function tileClass({ selected, live, rested, interactive = true }: { selected?: boolean; live?: boolean; rested?: boolean; interactive?: boolean }): string {
  if (!interactive) return `${BASE} outline-transparent`;
  // `rested`: the slide last shown before Släck, where → goes on from: a quiet grey, as nothing shows now.
  const mark = selected ? (live ? 'outline-red-500' : 'outline-sky-500') : rested ? 'outline-stone-400 dark:outline-stone-500' : 'outline-transparent';
  // Nothing under the mouse but the pointer, as Keynote's slides and Photos' pictures: red is what shows, blue what ↵
  // shows, grey where → goes on after Släck, and a red ring on hover looked like the slide shown (Lars, 2026-11-07).
  return `${BASE} cursor-pointer ${mark}`;
}

/**
 * A mark on a slide while presenting: VISAS on the one shown (`slideMarks` in packages/core), on a computer's tile and a
 * phone's row, and "Tryck Enter för att visa" on the one the arrows or a number made ready (Lars, 2026-11-25: in place
 * of a line under the live picture; NÄSTA is no longer drawn, the slides' numbers say the order).
 */
export function SlideMark({ kind, className }: { kind: SlideMarkKind | 'enter'; className?: string }) {
  return (
    <span
      className={`shrink-0 text-[11px]/4 px-2 py-0.5 rounded-lg pointer-events-none ${kind === 'shown' ? 'font-bold tracking-wide bg-red-600 text-white' : kind === 'enter' ? 'font-medium bg-sky-500 text-white' : 'font-bold tracking-wide bg-sky-500/15 text-sky-500'} ${className ?? ''}`}
    >
      {kind === 'shown' ? t('live.shownBadge') : kind === 'enter' ? <EnterWords /> : t('live.nextBadge')}
    </span>
  );
}

/**
 * What an audio slide is, drawn over its tile for the operator only (the outputs show the theme's background alone):
 * a speaker and, unless `small`, the file's name.
 */
export function AudioMark({ slide, small = false }: { slide: Slide; small?: boolean }) {
  if (!slide.audio) return null;
  return (
    <span className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-2 px-4 text-white pointer-events-none" data-testid="audio-mark">
      <SpeakerWaveIcon className={`${small ? 'size-6' : 'size-10'} drop-shadow`} />
      {!small && <span className="max-w-full truncate text-sm drop-shadow">{slide.audio.name}</span>}
    </span>
  );
}

/** "Tryck Enter för att visa", only the key bold: the eye finds what to press (Lars, 2026-11-25). */
function EnterWords() {
  const [before, after] = t('live.enterBadge').split('{key}') as [string, string?];
  return (
    <>
      {before}
      <b className="font-bold">{t('live.enterKey')}</b>
      {after}
    </>
  );
}
