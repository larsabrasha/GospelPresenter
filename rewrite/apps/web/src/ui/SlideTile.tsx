import type { ReactNode } from 'react';

// A slide in a grid, as the current app draws one (Components/Slide.razor):
// rounded, with a thin dark edge at the top and a thick outline that marks
// the chosen slide, red while it is on the screens.

const BASE = 'block relative aspect-video rounded-2xl overflow-hidden border-t-[0.5px] border-neutral-800/90 outline-4';

/**
 * The classes of a slide tile. `selected` is the chosen slide; `live` that the
 * presentation is showing (not the black screen), which turns the marks red.
 * A tile that is only shown, not chosen from, has no outline at all.
 */
export function tileClass({ selected, live, interactive = true }: { selected?: boolean; live?: boolean; interactive?: boolean }): string {
  if (!interactive) return `${BASE} outline-transparent`;
  const mark = selected ? (live ? 'outline-red-500 hover:outline-red-500' : 'outline-sky-500 hover:outline-sky-500') : live ? 'outline-transparent hover:outline-red-500' : 'outline-transparent hover:outline-sky-500';
  return `${BASE} cursor-pointer ${mark}`;
}

/** "● LIVE" in the corner of the slide on the screens. */
export function LiveBadge({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <span
      className={`absolute top-1 left-1 z-[3] flex items-center gap-1 bg-red-500 text-white font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full pointer-events-none ${small ? 'text-[8px]' : 'text-[9px]'}`}
    >
      <span className={`${small ? 'size-1' : 'size-1.5'} rounded-full bg-white animate-pulse`} />
      {children}
    </span>
  );
}
