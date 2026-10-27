import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AppButton } from './AppButton.tsx';

/**
 * A menu that opens under its button (Components/Dropdown.razor). A click
 * outside, a choice in the menu or Escape closes it. `button` is the
 * button's own attributes: its label, its class.
 */
export function Dropdown({ button, trigger, children, menuClassName }: { button: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string }; trigger: ReactNode; children: ReactNode; menuClassName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative flex items-center"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <AppButton variant="plain" {...button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </AppButton>
      {open && (
        <>
          <div className="fixed inset-0 z-[120]" onClick={() => setOpen(false)} />
          <div
            className={`absolute top-full right-0 mt-1 z-[130] bg-white dark:bg-neutral-700 rounded-2xl shadow-lg border-[0.5px] border-neutral-200 dark:border-neutral-600 overflow-hidden ${menuClassName ?? ''}`}
            role="menu"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

/** A choice in a Dropdown, as a link or a button, with an icon before it. */
export const MENU_ITEM =
  'flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-600 cursor-pointer no-underline';
