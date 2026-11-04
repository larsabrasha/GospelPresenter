import { useState } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { Dropdown, MENU_ITEM } from './Dropdown.tsx';
import { CheckIcon, ChevronDownIcon } from './icons.tsx';

// A library's order, as Files' and Photos' "Sortera efter": a quiet button with the order chosen, its menu the
// orders with a tick by the chosen one. The choice is this device's, kept per library.

export interface SortChoice {
  key: string;
  label: string;
}

/** A choice of this device's for `library` (its order, its layout): the first of `keys` when none, or one it no longer has. */
export function useStoredChoice(library: string, keys: string[]): [string, (key: string) => void] {
  const storageKey = `library:${library}`;
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const choose = (next: string) => {
    setKey(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // no storage: the order holds until the page is left
    }
  };
  return [keys.includes(key) ? key : (keys[0] ?? ''), choose];
}

export function SortMenu({ choices, value, onChange }: { choices: SortChoice[]; value: string; onChange: (key: string) => void }) {
  const chosen = choices.find((c) => c.key === value) ?? choices[0];
  return (
    <Dropdown
      menuClassName="min-w-48 left-0"
      className="relative"
      button={{ className: 'h-11 px-3 -ml-3 rounded-full flex items-center gap-1 text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2', 'aria-label': t('library.sortBy', { order: chosen?.label ?? '' }) }}
      trigger={
        <>
          {chosen?.label}
          <ChevronDownIcon className="size-4" />
        </>
      }
    >
      {choices.map((c) => (
        <AppButton key={c.key} variant="plain" role="menuitemradio" aria-checked={c.key === value} className={MENU_ITEM} onClick={() => onChange(c.key)}>
          <CheckIcon className={`size-4 ${c.key === value ? '' : 'invisible'}`} />
          {c.label}
        </AppButton>
      ))}
    </Dropdown>
  );
}
