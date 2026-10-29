import { useEffect, type ReactNode, type RefObject, type Ref } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { CloseIcon, SearchIcon } from './icons.tsx';

// The parts the add-item modal's tabs share (Components/Presentations/AddItem):
// the round search field, the row at the foot with the add button, and the
// grey picture and line of an empty tab.

/**
 * The round search field with a magnifier, and a clear button once there is text.
 * `compact` is the song library's, a little lower and with smaller text (Pages/Admin/Songs.razor).
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  inputRef,
  autoFocus,
  compact,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  /** What the clear button does; by default it empties the field through `onChange`. */
  onClear?: () => void;
  label: string;
  /** Shown in the empty field; the label when not given. */
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  compact?: boolean;
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
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full ${compact ? 'py-2 text-sm' : 'py-2.5'} pl-10 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500 [&::-webkit-search-cancel-button]:appearance-none ${value ? 'pr-9' : 'pr-4'}`}
      />
      {value && (
        <AppButton variant="icon" aria-label={t('common.clear')} onClick={onClear ?? (() => onChange(''))} className="absolute right-2.5 top-1/2 -translate-y-1/2 size-6!">
          <CloseIcon className="size-4" />
        </AppButton>
      )}
    </div>
  );
}

/**
 * Puts focus in a tab's search when the tab is shown, so the user can type at once; not below
 * `md`, where it would bring up a phone's keyboard over the list (SongTab.razor's IsMobileAsync).
 */
export function useFocusWhenShown(input: RefObject<HTMLInputElement | null>, active: boolean) {
  useEffect(() => {
    if (active && !matchMedia('(max-width: 767.98px)').matches) input.current?.focus();
  }, [active, input]);
}

/**
 * Whether a key press in a tab adds: Ctrl+Enter, ⌘+Enter on a Mac. The dialog never closes after an
 * add (D15), so one key is enough; a plain Enter does nothing, since a new user may press it to search.
 */
export function isAddKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
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
