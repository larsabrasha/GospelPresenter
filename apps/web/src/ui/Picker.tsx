import type { PresentationItem } from '@gp/core';
import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject, type Ref } from 'react';
import { t } from '../i18n.ts';
import { ctrlLabel } from './shortcuts.ts';
import { AppButton } from './AppButton.tsx';
import { CheckIcon, CloseIcon, SearchIcon } from './icons.tsx';
import { withMaxChars } from './maxChars.ts';

// The parts the add-item modal's tabs share (Components/Presentations/AddItem):
// the round search field, the row at the foot with the add button, and the
// grey picture and line of an empty tab.

/**
 * The round search field with a magnifier, and a clear button once there is text.
 * `compact` is the song library's, a little lower and with smaller text (Pages/Admin/Songs.razor). `filled` is iOS's:
 * no border, a soft grey fill, so it asks less than the rows under it (Inställningar's list; Lars, 2026-11-03).
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  inputRef,
  autoFocus,
  compact,
  filled,
  onClear,
  className = '',
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
  filled?: boolean;
  /** Added to the field's box, as `max-sm:basis-full` for a row of its own on a phone. */
  className?: string;
}) {
  return (
    <div className={`relative flex-1 min-w-0 ${className}`}>
      <SearchIcon className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        // The web's own limit: no rule of the core's counts a search's characters.
        onChange={withMaxChars(100, (e) => onChange(e.target.value))}
        className={`w-full ${compact ? 'py-2 text-sm' : 'py-2.5'} pl-10 rounded-full ${filled ? 'border border-transparent bg-stone-900/[0.06] dark:bg-white/[0.08] placeholder:text-stone-500 dark:placeholder:text-stone-400' : 'border border-stone-200 dark:border-stone-600 bg-white dark:bg-raised'} text-stone-900 dark:text-stone-100 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20 [&::-webkit-search-cancel-button]:appearance-none ${value ? 'pr-9' : 'pr-4'}`}
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
 * The add dialog's adds, counted, and when the last was: each turns its Lägg till into "Tillagd" for a moment. And the
 * presentation's items, so a tab can say when what is chosen is there already.
 */
export const AddContext = createContext<{ n: number; at: number; items: readonly PresentationItem[] }>({ n: 0, at: 0, items: [] });

/** The items of the presentation the add dialog adds to: a tab says when what is chosen is among them already. */
export const usePresentationItems = () => useContext(AddContext).items;

/** How long Lägg till says "Tillagd" after an add. */
const DONE_MS = 1500;

/**
 * The foot of a tab: "Lägg till <name>", the name in bold. `label` is the button's full name, for screen readers and
 * tests. Its key (⌘↵) is in its tooltip and the keyboard help, not written under the list (Lars, 2026-11-05: a line
 * of help in every tab, and on a phone a key it has not). After an add it is green with a tick, "Tillagd", for a
 * moment, where the eye already is, as the App Store's Hämta (Lars, 2026-11-25: one hardly noticed what had happened).
 * `again` when what is chosen is in the presentation already: it says so, and the button adds it again.
 */
export function AddFooter({ name, label, onAdd, again }: { name?: string; label?: string; onAdd?: () => void; again?: boolean }) {
  const added = useContext(AddContext);
  // "Tillagd" while the last add is under DONE_MS old, so a tab started over by its add (a new song's) shows it too;
  // drawn again as that time runs out.
  const [, redraw] = useState(0);
  const left = DONE_MS - (Date.now() - added.at);
  const done = left > 0;
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => redraw((n) => n + 1), left);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once for each add; `left` is read as it starts
  }, [added.at]);
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 pt-4">
      {done ? (
        <AppButton aria-live="polite" title={label} onClick={onAdd} disabled={!onAdd} className="added-pop inline-flex items-center gap-1.5 bg-green-600! hover:bg-green-600! disabled:opacity-100!">
          <CheckIcon className="size-4 shrink-0" />
          {t('presentation.addedDone')}
        </AppButton>
      ) : (
        name !== undefined &&
        onAdd && (
          <>
            {again && <span className="text-sm text-stone-500 dark:text-stone-400">{t('presentation.alreadyIn')}</span>}
            <AppButton aria-label={label} title={`${label ?? t('presentation.add')} (${ctrlLabel('↵')})`} onClick={onAdd} className="max-w-full min-w-0 inline-flex items-center gap-1">
              <span className="shrink-0">{t(again ? 'presentation.addAgain' : 'presentation.add')}</span> <span className="font-bold truncate">{name}</span>
            </AppButton>
          </>
        )
      )}
    </div>
  );
}

/**
 * "Avmarkera alla" at the end of a tab's top row while something is picked, as Photos' picker lets go of a choice at
 * once (Lars, 2026-11-05: three pictures picked took three taps to let go of).
 */
export function DeselectAll({ count, onClear }: { count: number; onClear: () => void }) {
  if (!count) return null;
  return (
    <AppButton variant="plain" className="ml-auto h-11 px-3 rounded-full text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2" onClick={onClear}>
      {t('library.deselectAll')}
    </AppButton>
  );
}

/** A tab with nothing to show: a large grey icon and a line. */
export function EmptyTab({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-stone-400 dark:text-stone-500 text-sm py-8 gap-3 select-none">
      {icon}
      {children}
    </div>
  );
}
