import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { LIFTED } from './glass.ts';
import { useHeaderFloat } from './headerFloat.ts';
import { CheckIcon } from './icons.tsx';

// Välj, as iOS's (Lars, 2026-11-07: the same on every list, the libraries, Papperskorg, Etiketter and Teman): Välj at the
// top right turns the items into ticks, Markera alla beside it, and a toolbar floats where + floats with how many are
// marked and what can be done with them. Klar or Escape ends it. A Shift-click marks every item from the one clicked
// before to this one, as Finder and Gmail do (Lars, 2026-11-07); a Shift-click on a marked one unmarks them.

/**
 * What is marked after a click on `id`: that item turned over, or with `shift` and an earlier click (`anchor`) in
 * `order`, every item from there to `id` given the state `id` turns to.
 */
export function marked(now: ReadonlySet<string>, id: string, shift: boolean, anchor: string | null, order: readonly string[]): ReadonlySet<string> {
  const next = new Set(now);
  const on = !now.has(id);
  const from = shift && anchor !== null ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  const range = from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  for (const each of range) {
    if (on) next.add(each);
    else next.delete(each);
  }
  return next;
}

/** Which items Välj has marked, by id, and whether it is on. */
export function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /** The item clicked last, where a Shift-click's range starts. */
  const anchor = useRef<string | null>(null);
  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
    anchor.current = null;
  };
  /** A click on `id`: `order` is the items as they stand on the page, for a Shift-click's range. */
  const toggle = (id: string, e: { shiftKey: boolean }, order: readonly string[]) => {
    const from = anchor.current;
    anchor.current = id;
    // A Shift-click selects the page's text between the clicks too; that is not what was meant.
    if (e.shiftKey) getSelection()?.removeAllRanges();
    setPicked((now) => marked(now, id, e.shiftKey, from, order));
  };
  /** Escape ends Välj, and only that (one step at a time, as everywhere); false when it was not on. */
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !selecting) return false;
    e.stopPropagation();
    stop();
    return true;
  };
  return { selecting, picked, start: () => setSelecting(true), stop, toggle, setPicked, escape };
}

export type Selection = ReturnType<typeof useSelection>;

/** Välj, Klar and Markera alla: words in the app's colour, as iOS's bar buttons. */
const HEADER_TEXT = 'h-11 px-3 rounded-full text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2';

/** Välj or Klar, and Markera alla (or Avmarkera alla) of `ids` while it is on. */
export function SelectButtons({ selection, ids }: { selection: Selection; ids: readonly string[] }) {
  const all = ids.length > 0 && ids.every((id) => selection.picked.has(id));
  return (
    <span className="flex items-center gap-1 -mr-3">
      {selection.selecting && (
        <AppButton variant="plain" className={HEADER_TEXT} onClick={() => selection.setPicked(all ? new Set() : new Set(ids))}>
          {t(all ? 'library.deselectAll' : 'library.selectAll')}
        </AppButton>
      )}
      <AppButton variant="plain" className={`${HEADER_TEXT} font-semibold`} onClick={() => (selection.selecting ? selection.stop() : selection.start())}>
        {t(selection.selecting ? 'library.done' : 'library.select')}
      </AppButton>
    </span>
  );
}

/** A round tick, as iOS marks a chosen item: empty, or filled in the app's colour with a check. */
export function Tick({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`size-6 shrink-0 rounded-full flex items-center justify-center ${on ? 'bg-sky-500 text-white' : 'border-2 border-stone-300 dark:border-stone-600 bg-white/80 dark:bg-black/30'} ${className ?? ''}`}
    >
      {on && <CheckIcon className="size-4" />}
    </span>
  );
}

/** What Välj floats where + floats: how many are marked, then `children`, the buttons for them (Radera last). */
export function SelectionBar({ count, children }: { count: number; children: ReactNode }) {
  const float = useHeaderFloat();
  const bar = (
    <div role="toolbar" aria-label={t('library.toolbar')} className={`h-14 pl-5 pr-2 rounded-full flex items-center gap-3 ${LIFTED}`}>
      <span className="text-[15px] text-stone-600 dark:text-stone-300 tabular-nums">{count ? t(count === 1 ? 'library.picked.one' : 'library.picked.many', { n: count }) : t('library.pickNone')}</span>
      {children}
    </div>
  );
  return float ? createPortal(bar, float) : <div className="sticky bottom-4 flex justify-center">{bar}</div>;
}
