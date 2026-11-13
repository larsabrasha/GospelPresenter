import { useMemo, type KeyboardEvent } from 'react';
import { t } from '../i18n.ts';
import { useShortcutGroup, type ShortcutGroup } from './ShortcutHelp.tsx';
import { isTextEntry } from './shortcuts.ts';

// A library's keys (Sånger, Bilder, Bildspel …; Lars, 2026-11-05: the whole app by the keyboard), as the start page's
// list: ↑ ↓ move between the items (← → too in a grid), ↓ in the search goes to the first, ↵ opens the focused one (its
// link or button), and Delete removes it, asked first. Each item's own control has `data-library-item` (its id).

/** Handles a key in the library's page; `remove` asks for and removes the item of an id. */
export function libraryKeyDown(e: KeyboardEvent<HTMLElement>, tiles: boolean, remove: ((id: string) => void) | null): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-library-item]')];
  const target = e.target as HTMLElement;
  if (e.key === 'ArrowDown' && target instanceof HTMLInputElement && target.type === 'search') {
    e.preventDefault();
    items[0]?.focus();
    return;
  }
  const at = items.findIndex((el) => el.contains(target));
  if (at < 0 || isTextEntry(target)) return;
  // In a grid ↑ ↓ go a row, as many as stand beside the first.
  const top = items[0]!.getBoundingClientRect().top;
  const perRow = tiles ? Math.max(1, items.filter((el) => el.getBoundingClientRect().top === top).length) : 1;
  const by = ({ ArrowDown: perRow, ArrowUp: -perRow, ...(tiles ? { ArrowRight: 1, ArrowLeft: -1 } : {}) } as Record<string, number>)[e.key];
  if (by) {
    e.preventDefault();
    const next = items[at + by];
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest' });
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && remove) {
    e.preventDefault();
    remove(items[at]!.dataset.libraryItem!);
  }
}

/** The library's keys in the help, under its name. */
export function useLibraryShortcuts(title: string, manage: boolean): void {
  const group = useMemo<ShortcutGroup>(
    () => ({
      title,
      lines: [
        { keys: ['ArrowUp', 'ArrowDown'], text: t('shortcuts.moveThroughList') },
        { keys: ['Enter'], text: t('shortcuts.openItem') },
        ...(manage ? [{ keys: ['Delete'], text: t('shortcuts.removeSelected') }, { keys: ['n'], text: t('shortcuts.newItem') }] : []),
      ],
    }),
    [title, manage],
  );
  useShortcutGroup(group);
}
