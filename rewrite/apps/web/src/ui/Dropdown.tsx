import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { AppButton } from './AppButton.tsx';

/**
 * A menu that opens under its button (Components/Dropdown.razor). A click
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
    <div className={`relative flex items-center ${className ?? ''}`} onKeyDown={onKeyDown}>
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
          <div className="fixed inset-0 z-[120]" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            className={`absolute top-full right-0 mt-1 z-[130] bg-white dark:bg-neutral-700 rounded-2xl shadow-lg border-[0.5px] border-neutral-200 dark:border-neutral-600 overflow-hidden ${menuClassName ?? ''}`}
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

/** The choices the arrows move between, a ticked one included. */
const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])';

/** A choice in a Dropdown, as a link or a button, with an icon before it. */
export const MENU_ITEM =
  'flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-600 focus:bg-neutral-100 dark:focus:bg-neutral-600 focus:outline-none cursor-pointer no-underline whitespace-nowrap';

/** A red choice that deletes (Images.razor's Radera): smaller, as the current app draws it. */
export const MENU_ITEM_DANGER =
  'w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:bg-neutral-100 dark:focus:bg-neutral-700 focus:outline-none cursor-pointer whitespace-nowrap';
