import type { ReactNode, Ref } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CloseIcon, SearchIcon } from './icons.tsx';

// The parts the add-item modal's tabs share (Components/Presentations/AddItem):
// the round search field, the row at the foot with the add button, and the
// grey picture and line of an empty tab.

/** The round search field with a magnifier, and a clear button once there is text. */
export function SearchField({
  value,
  onChange,
  label,
  inputRef,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <SearchIcon className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        type="search"
        maxLength={100}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full py-2.5 pl-10 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500 [&::-webkit-search-cancel-button]:appearance-none ${value ? 'pr-9' : 'pr-4'}`}
      />
      {value && (
        <AppButton variant="icon" aria-label={t('common.clear')} onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 size-6!">
          <CloseIcon className="size-4" />
        </AppButton>
      )}
    </div>
  );
}

/**
 * The foot of a tab: the keyboard hint at the left, and "Lägg till <name>",
 * the name in bold. `label` is the button's full name, for screen readers and tests.
 */
export function AddFooter({ hint, name, label, onAdd }: { hint?: string; name?: string; label?: string; onAdd?: () => void }) {
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-end gap-x-10 gap-y-2 pt-4">
      {hint && <p className="mr-auto text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
      {name !== undefined && onAdd && (
        <AppButton aria-label={label} onClick={onAdd} className="max-w-full min-w-0 inline-flex items-center gap-1">
          <span className="shrink-0">{t('presentation.add')}</span> <span className="font-bold truncate">{name}</span>
        </AppButton>
      )}
    </div>
  );
}

/** A tab with nothing to show: a large grey icon and a line. */
export function EmptyTab({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-neutral-400 dark:text-neutral-500 text-sm py-8 gap-3 select-none">
      {icon}
      {children}
    </div>
  );
}
