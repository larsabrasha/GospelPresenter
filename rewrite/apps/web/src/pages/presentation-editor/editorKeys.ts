import { t } from '../../i18n.ts';
import type { Song } from '@gp/core';
import { usePaletteTarget } from '../../ui/CommandPalette.tsx';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';

// The presentation editor's keys in the help dialog (spec 03 section 6); PresentationEditor.tsx handles them.

/** The editor's keys in the help dialog (Presentation.razor's scope); ↑ ↓ wherever focus is, as ProPresenter's. */
export const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.presentation'),
  lines: [
    { keys: ['a'], text: t('shortcuts.addItem') },
    { keys: ['Delete'], text: t('shortcuts.removeItem') },
    { keys: ['ArrowUp', 'ArrowDown'], text: t('shortcuts.moveThroughItems') },
    { keys: ['ArrowRight', 'ArrowLeft'], text: t('shortcuts.pickSlide') },
    { keys: ['Alt+ArrowUp', 'Alt+ArrowDown'], text: t('shortcuts.moveItem') },
    { keys: ['F5', 'Ctrl+Alt+P'], text: t('shortcuts.start') },
  ],
};

/** The keys while presenting: ProPresenter's (Lars, 2026-10-29). */
const LIVE_KEYS: ShortcutGroup = {
  title: t('shortcuts.group.live'),
  lines: [
    { keys: ['ArrowRight', ' ', 'PageDown'], text: t('shortcuts.nextSlide') },
    { keys: ['ArrowLeft', 'PageUp'], text: t('shortcuts.previousSlide') },
    { keys: ['ArrowDown'], text: t('shortcuts.nextItem') },
    { keys: ['ArrowUp'], text: t('shortcuts.previousItem') },
    { keys: ['B', '.'], text: t('shortcuts.black') },
  ],
};

export function LiveKeys() {
  useShortcutGroup(LIVE_KEYS);
  return null;
}

/** ⌘K's song added to this presentation, while it is drawn. */
export function PaletteTarget({ addSong }: { addSong: (song: Song) => Promise<boolean> }) {
  usePaletteTarget({ addSong });
  return null;
}
