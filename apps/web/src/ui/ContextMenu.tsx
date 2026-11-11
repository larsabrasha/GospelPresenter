import { useEffect, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from './useDismiss.ts';

/** The choices of a menu that can be chosen now. */
const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/** The choices of `menu` itself, not of a submenu inside it. */
function choicesOf(menu: Element): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => el.closest('[role="menu"]') === menu);
}

/**
 * A menu at a point, as a right click or a row's … opens it on macOS: kept on screen, closed by a press outside it
 * (which still reaches what was pressed), by a choice in it, or by Escape, which closes it and nothing else.
 *
 * By the keyboard as macOS's menus (WAI-ARIA's menu pattern): opened from the keyboard, focus is on the first choice;
 * ↑ ↓ Home End move between the choices also when the pointer opened it, → opens a row's submenu (`aria-haspopup`)
 * and ← goes back to the row, Tab closes it, and closing gives focus back to what had it.
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

  useLayoutEffect(() => {
    const root = menu.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A key on a focused row (Enter on its …, or the menu key) opened it: the keyboard goes on in the menu.
    if (opener?.matches(':focus-visible')) choicesOf(root)[0]?.focus();
    return () => {
      // Focus goes with the menu (a choice, Escape, Tab): back to the opener. A choice that focused something else
      // (a dialog's field) keeps it.
      const now = document.activeElement;
      if (!now || now === document.body || root.contains(now)) opener?.focus();
    };
  }, []);

  const key = useEffectEvent((e: KeyboardEvent) => {
    const root = menu.current;
    if (!root) return;
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    // The menu the focus is in: a submenu, or this one (also with the focus still on what opened it).
    const here = focused?.closest('[role="menu"]') ?? root;
    // In a submenu, Escape steps back to its row, one step as everywhere; in the menu it is useDismiss's.
    if (e.key === 'Escape' && here === root) return;
    // The menu has the keys while it is open: the page's own (↑ ↓ in the running order, Delete) wait.
    if (focused || ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') === 'menu') {
      e.preventDefault();
      if (focused.getAttribute('aria-expanded') !== 'true') focused.click();
      // The submenu is drawn after the click's render (a task, not a frame: a hidden window draws no frames).
      setTimeout(() => {
        const sub = focused.parentElement?.querySelector('[role="menu"]');
        if (sub) choicesOf(sub)[0]?.focus();
      });
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'Escape') && here !== root) {
      e.preventDefault();
      here.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
      return;
    }
    const all = choicesOf(here);
    if (!all.length) return;
    const now = focused ? all.indexOf(focused) : -1;
    const next = { ArrowDown: now + 1, ArrowUp: now < 0 ? all.length - 1 : now - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    all[(next + all.length) % all.length]!.focus();
  });
  useEffect(() => {
    // On the window, before anything else hears the key: the arrows work also when the pointer opened the menu and
    // the focus is outside it, and the page's keys wait while the menu is open.
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, []);

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
export const CONTEXT_ROW = 'w-full h-8 touch:h-11 px-2.5 flex items-center gap-2.5 rounded-md text-left cursor-pointer hover:bg-raised dark:hover:bg-raised-2 focus-visible:bg-raised dark:focus-visible:bg-raised-2 focus-visible:outline-none disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent';
