import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { AppButton } from './AppButton.tsx';

/**
 * A menu that opens under its button, or above it when it does not fit
 * (Components/Dropdown.razor). A click
 * outside, a choice in the menu or Escape closes it. `button` is the
 * button's own attributes: its label, its class. Opened from the keyboard,
 * focus moves to the first choice, the arrows move between the choices, and
 * Escape puts focus back on the button.
 */
export function Dropdown({
  button,
  trigger,
  children,
  menuClassName,
  className,
}: {
  button: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string };
  trigger: ReactNode;
  children: ReactNode;
  menuClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState<false | 'mouse' | 'keyboard'>(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];

  useEffect(() => {
    if (open === 'keyboard') menuRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open]);

  // A menu that would run off the bottom opens upward when there is more room
  // above, and is cut to fit and scrolls otherwise (utils.js positionDropdown). The bottom is the window's, or a
  // clipping box's around it: Inställningar's dialog cut the floating +'s menu off (Lars, 2026-11-02).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const margin = 8;
    const room = visibleRoom(menu);
    const rect = menu.getBoundingClientRect();
    // Kept inside the window sideways too: a menu under a ⋯ at a grid's left edge ran off the screen (Lars, 2026-11-04).
    const shift = rect.left < margin ? margin - rect.left : rect.right > innerWidth - margin ? innerWidth - margin - rect.right : 0;
    if (shift) menu.style.transform = `translateX(${shift}px)`;
    if (rect.bottom <= room.bottom - margin) return;
    const parent = menu.parentElement!.getBoundingClientRect();
    const above = parent.top - room.top;
    const below = room.bottom - parent.bottom;
    if (above > below) {
      Object.assign(menu.style, { top: 'auto', bottom: '100%', marginTop: '0', marginBottom: '0.25rem' });
      if (rect.height > above - margin) Object.assign(menu.style, { maxHeight: `${above - margin}px`, overflowY: 'auto' });
    } else {
      Object.assign(menu.style, { maxHeight: `${below - margin}px`, overflowY: 'auto' });
    }
  }, [open]);

  // A press anywhere outside closes it. Listened for on the document rather than by a cover under the menu: a cover
  // inside a blurred sticky heading (backdrop-filter) is held to that heading, and a press beside it went through.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' && e.target === triggerRef.current) {
        e.preventDefault();
        setOpen('keyboard');
      }
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const all = items();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at < 0 ? all.length - 1 : at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    all[(next + all.length) % all.length]?.focus();
  };

  return (
    <div ref={root} className={`relative flex items-center ${className ?? ''}`} onKeyDown={onKeyDown}>
      <AppButton
        variant="plain"
        {...button}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={!!open}
        // A click from the keyboard (Enter, Space) has no pointer position.
        onClick={(e) => setOpen((o) => (o ? false : e.detail === 0 ? 'keyboard' : 'mouse'))}
      >
        {trigger}
      </AppButton>
      {open && (
        <>
          <div
            ref={menuRef}
            className={`absolute top-full right-0 mt-1 z-[130] bg-white dark:bg-raised rounded-2xl shadow-lg border-[0.5px] border-stone-200 dark:border-stone-600 overflow-hidden ${menuClassName ?? ''}`}
            role="menu"
            onClick={() => close(open === 'keyboard')}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

/** The part of the window `el` can be seen in: the window, cut by every box around it that clips what overflows it. */
function visibleRoom(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (!/hidden|auto|scroll|clip/.test(getComputedStyle(box).overflowY)) continue;
    const r = box.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  return { top, bottom };
}

/** The choices the arrows move between, a ticked one included. */
const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/** A choice in a Dropdown, as a link or a button, with an icon before it. */
export const MENU_ITEM =
  'flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-raised-2 focus:bg-stone-100 dark:focus:bg-stone-600 focus:outline-none cursor-pointer no-underline whitespace-nowrap';

/** A red choice that deletes (Images.razor's Radera): smaller, as the current app draws it. */
export const MENU_ITEM_DANGER =
  'w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-raised focus:bg-stone-100 dark:focus:bg-stone-700 focus:outline-none cursor-pointer whitespace-nowrap';
