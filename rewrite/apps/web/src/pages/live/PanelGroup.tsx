import type { ReactNode } from 'react';

/**
 * A group of the live column, as iOS's Settings groups its rows (Lars, 2026-11-02): a small grey caption over a card
 * whose rows are parted by hairlines, always open, with no line of its own saying how it is, since its switches say
 * it. What the group is for is the caption's tooltip. `bare` in a sheet whose own title names it: the card alone.
 */
export function PanelGroup({ title, hint, bare, children }: { title: string; hint: string; bare?: boolean; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 hidden={bare} className="px-3 pb-1.5 text-[13px]/4 font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400" title={hint}>
        {title}
      </h2>
      <div className="rounded-xl bg-raised overflow-hidden flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-separator">{children}</div>
    </section>
  );
}

/** The rows of a list inside a group, parted by the same hairlines. */
export const GROUP_LIST = 'flex flex-col empty:hidden [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator';
