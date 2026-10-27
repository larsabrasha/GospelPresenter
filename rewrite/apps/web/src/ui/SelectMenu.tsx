import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AppButton } from './AppButton.tsx';

/** One choice in a SelectMenu: its value, its name for screen readers, and what it shows. */
export interface Choice {
  value: string;
  label: string;
  content?: ReactNode;
}

/**
 * A custom select (Components/Dropdown.razor with a list of choices, as the
 * song editor's label and Lägg till del): `face` is the button, and a click
 * opens the choices under it. It is the ARIA select-only combobox: focus
 * stays on the button, which names the active choice with
 * aria-activedescendant. Enter, Space or ↓ opens (↑ opens at the end);
 * ↑ ↓ Home End move; Enter or Space picks; Escape closes; Tab leaves.
 * `value` marks the chosen one; leave it out for a list of actions, where
 * nothing stays chosen.
 */
export function SelectMenu({
  label,
  choices,
  value,
  onChoose,
  face,
  className,
  buttonClassName,
  listClassName,
}: {
  label: string;
  choices: Choice[];
  value?: string | null;
  onChoose: (value: string) => void;
  face: ReactNode;
  className?: string;
  buttonClassName?: string;
  listClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-${i}`;
  const chosenAt = choices.findIndex((c) => c.value === value);

  // A click elsewhere closes it, also where a click does not move focus (Safari's buttons).
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!(e.target instanceof Node && boxRef.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[id="${CSS.escape(optionId(active))}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  const show = (at: number) => {
    setActive(Math.max(0, Math.min(choices.length - 1, at)));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    const c = choices[i];
    if (c) onChoose(c.value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      const at = { Enter: chosenAt, ' ': chosenAt, ArrowDown: chosenAt, ArrowUp: chosenAt < 0 ? choices.length - 1 : chosenAt, Home: 0, End: choices.length - 1 }[e.key];
      if (at === undefined || !choices.length) return;
      e.preventDefault();
      show(Math.max(at, 0));
      return;
    }
    if (e.key === 'Escape' || (e.key === 'ArrowUp' && e.altKey)) {
      e.preventDefault();
      e.stopPropagation(); // a dialog around this must not close too
      setOpen(false);
    } else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else {
      const page = 10;
      const at = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: choices.length - 1, PageDown: active + page, PageUp: active - page }[e.key];
      if (at === undefined) return;
      e.preventDefault();
      setActive(Math.max(0, Math.min(choices.length - 1, at)));
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`}>
      <AppButton
        variant="plain"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? optionId(active) : undefined}
        className={buttonClassName}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        // A click from the keyboard (detail 0) was already handled by onKeyDown.
        onClick={(e) => (open ? setOpen(false) : e.detail !== 0 && show(chosenAt))}
      >
        {face}
      </AppButton>
      {open && (
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          // Keeps focus on the button while a choice is clicked.
          onMouseDown={(e) => e.preventDefault()}
          className={`absolute top-full mt-1 z-[130] bg-white dark:bg-neutral-700 rounded-2xl shadow-lg border-[0.5px] border-neutral-200 dark:border-neutral-600 overflow-hidden ${listClassName ?? ''}`}
        >
          {choices.map((c, i) => {
            const chosen = i === chosenAt;
            const shade =
              i === active
                ? chosen
                  ? 'bg-sky-100 dark:bg-sky-900/50'
                  : 'bg-neutral-100 dark:bg-neutral-600'
                : chosen
                  ? 'bg-sky-50 dark:bg-sky-900/30'
                  : '';
            return (
              <div
                key={c.value}
                id={optionId(i)}
                role="option"
                aria-selected={value === undefined ? undefined : chosen}
                aria-label={c.label}
                className={`w-full flex items-center px-3 py-1.5 text-sm text-left cursor-pointer ${shade}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                {c.content ?? c.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
