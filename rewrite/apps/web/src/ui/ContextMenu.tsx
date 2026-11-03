import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from './useDismiss.ts';

/**
 * A menu at a point, as a right click or a row's … opens it on macOS: kept on screen, closed by a press outside it
 * (which still reaches what was pressed), by a choice in it, or by Escape, which closes it and nothing else.
 */
export function ContextMenu({ at, label, onClose, children }: { at: { x: number; y: number }; label: string; onClose: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(menu, onClose);
  // Kept inside the window: a menu that would run off the right or the bottom opens to the left or upward.
  useLayoutEffect(() => {
    const el = menu.current!;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    el.style.left = `${Math.max(margin, at.x + width > innerWidth - margin ? at.x - width : at.x)}px`;
    el.style.top = `${Math.max(margin, at.y + height > innerHeight - margin ? at.y - height : at.y)}px`;
  }, [at]);
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="fixed z-[145] min-w-52 p-1.5 rounded-xl bg-surface dark:bg-raised shadow-2xl ring-[0.5px] ring-separator text-sm text-stone-800 dark:text-stone-100"
      onClick={onClose}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A choice in a ContextMenu; a red one removes. */
export const CONTEXT_ROW = 'w-full h-8 touch:h-11 px-2.5 flex items-center gap-2.5 rounded-md text-left cursor-pointer hover:bg-raised dark:hover:bg-raised-2 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent';
