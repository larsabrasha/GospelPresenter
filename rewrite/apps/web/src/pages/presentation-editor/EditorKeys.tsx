import { t } from '../../i18n.ts';
import type { Song } from '@gp/core';
import { usePaletteTarget } from '../../ui/CommandPalette.tsx';
import { PointIcon } from '../../ui/icons.tsx';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
import { addKinds, type AddChoice } from './AddItemDialog.tsx';

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

/** The keys while presenting: a clicker's step at once, the others outline the slide ↵ shows (useEditorKeys.ts, Lars, 2026-11-07). */
const LIVE_KEYS: ShortcutGroup = {
  title: t('shortcuts.group.live'),
  lines: [
    { keys: ['Enter'], text: t('shortcuts.showMarked') },
    { keys: ['ArrowRight', 'ArrowLeft'], text: t('shortcuts.moveOutline') },
    { keys: ['ArrowDown', 'ArrowUp'], text: t('shortcuts.nextItem') },
    { keys: ['1–9'], text: t('shortcuts.slideNumber') },
    { keys: [' ', 'PageDown'], text: t('shortcuts.nextSlide') },
    { keys: ['PageUp'], text: t('shortcuts.previousSlide') },
    { keys: ['Escape'], text: t('shortcuts.dropOutline') },
    { keys: ['B', '.'], text: t('shortcuts.black') },
  ],
};

export function LiveKeys() {
  useShortcutGroup(LIVE_KEYS);
  return null;
}

/** ⌘K's song added to this presentation, and + 's kinds offered as "Lägg till …", while it is drawn. */
export function PaletteTarget({ addSong, live, onChoose }: { addSong: (song: Song) => Promise<boolean>; live: boolean; onChoose: (choice: AddChoice) => void }) {
  const kinds = [...addKinds(), ['header', t('header.kind'), PointIcon] as const];
  usePaletteTarget({
    addSong,
    live,
    adds: kinds.map(([kind, label, Icon]) => ({ key: kind, label, icon: <Icon className="size-4" />, run: () => onChoose(kind) })),
  });
  return null;
}
