import type { ReactNode } from 'react';
import { SheetRows } from '../../ui/Toggle.tsx';

/** A sheet card's hairlines, from the rows' text (16 px in, a 16 px icon and its 8 px gap) to the right edge. */
const INSET_HAIRLINES =
  '[&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:left-10 [&>*+*]:before:right-0 [&>*+*]:before:h-[0.5px] [&>*+*]:before:bg-separator';

/**
 * A group of the live column, as iOS's Settings groups its rows (Lars, 2026-11-02): a small grey caption over a card
 * whose rows are parted by hairlines, always open, with no line of its own saying how it is, since its switches say
 * it. What the group is for is the caption's tooltip. `sheet` in a phone's Visning sheet, beside the other group.
 */
export function PanelGroup({ title, hint, sheet, children }: { title: string; hint: string; sheet?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className={`${sheet ? 'px-4' : 'px-3'} pb-1.5 text-sm/5 font-semibold text-stone-500 dark:text-stone-400`} title={hint}>
        {title}
      </h2>
      {/* In a sheet, the sheet's own white card and iOS's rows (SheetRows), as its other sheets have them, the hairline
          between rows starting where their text does, as iOS draws it. */}
      <div className={`${sheet ? `rounded-[1.375rem] bg-sheet-cell ${INSET_HAIRLINES}` : 'rounded-xl bg-raised [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator'} overflow-hidden flex flex-col`}>
        <SheetRows.Provider value={!!sheet}>{children}</SheetRows.Provider>
      </div>
    </section>
  );
}

/** The rows of a list inside a group, parted by the same hairlines; in a sheet, from the rows' text. */
export const GROUP_LIST = 'flex flex-col empty:hidden [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator';
export const SHEET_LIST = `flex flex-col empty:hidden ${INSET_HAIRLINES}`;
