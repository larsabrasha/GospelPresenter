import { t } from '../../i18n.ts';
import type { Slide, Song } from '@gp/core';
import { usePaletteTarget, type PaletteAction } from '../../ui/CommandPalette.tsx';
import { BlackScreenIcon, ChevronLeftIcon, ChevronRightIcon, FadeOutIcon, PlayIcon, PointIcon, StopIcon } from '../../ui/icons.tsx';
import { runCommand } from '../../ui/appKeys.ts';
import { isMac } from '../../ui/shortcuts.ts';
import type { Players } from './ItemParts.tsx';
import { useShortcutGroup, type ShortcutGroup } from '../../ui/ShortcutHelp.tsx';
import { addKinds, type AddChoice } from './AddItemDialog.tsx';

// The presentation editor's keys in the help dialog (spec 03 section 6); PresentationEditor.tsx handles them.

/** The editor's keys in the help dialog (Presentation.razor's scope); the arrows wherever focus is (useEditorKeys.ts). */
export const KEYS: ShortcutGroup = {
  title: t('shortcuts.group.presentation'),
  lines: [
    { keys: ['a'], text: t('shortcuts.addItem') },
    { keys: ['Delete'], text: t('shortcuts.removeItem') },
    { keys: ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'], text: t('shortcuts.pickSlide') },
    { keys: ['Ctrl+ArrowUp', 'Ctrl+ArrowDown'], text: t('shortcuts.moveThroughItems') },
    { keys: ['Alt+ArrowUp', 'Alt+ArrowDown'], text: t('shortcuts.moveItem') },
    { keys: ['F5', 'Ctrl+Alt+P'], text: t('shortcuts.start') },
  ],
};

/** The keys while presenting: ↵ and a clicker's step at once, the arrows make a slide ready for ↵ (useEditorKeys.ts, Lars, 2026-11-07). */
const LIVE_KEYS: ShortcutGroup = {
  title: t('shortcuts.group.live'),
  lines: [
    { keys: ['Enter'], text: t('shortcuts.showMarked') },
    { keys: ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'], text: t('shortcuts.moveOutline') },
    { keys: ['Ctrl+ArrowUp', 'Ctrl+ArrowDown'], text: t('shortcuts.nextItem') },
    { keys: ['1–9'], text: t('shortcuts.slideNumber') },
    { keys: [' ', 'PageDown'], text: t('shortcuts.nextSlide') },
    { keys: ['PageUp'], text: t('shortcuts.previousSlide') },
    { keys: ['Escape'], text: t('shortcuts.dropOutline') },
    { keys: ['Ctrl+.'], text: t('shortcuts.end') },
    { keys: ['B', '.'], text: t('shortcuts.black') },
  ],
};

export function LiveKeys() {
  useShortcutGroup(LIVE_KEYS);
  return null;
}

/** What the presentation's page is doing, for ⌘K's suggestions. */
interface PageState {
  /** Presenting it, this window or a controller. */
  live: boolean;
  /** This window presents it, so it may end it. */
  ends: boolean;
  canStart: boolean;
  onStart: () => void;
  onStep: (delta: number) => void;
  onBlack: () => void;
  /** The slide shown and its item, for its audio's or video's own. */
  shown: { slide: Slide; itemId: string } | null;
  players?: Players;
}

/**
 * ⌘K's song added to this presentation, + 's kinds offered as "Lägg till …", and the page's likeliest commands
 * suggested first (Lars, 2026-11-07), while it is drawn.
 */
export function PaletteTarget({ addSong, onChoose, ...page }: PageState & { addSong: (song: Song) => Promise<boolean>; onChoose: (choice: AddChoice) => void }) {
  const kinds = [...addKinds(), ['header', t('header.kind'), PointIcon] as const];
  const adds = kinds.map(([kind, label, Icon]) => ({ key: kind, label, icon: <Icon className="size-4" />, run: () => onChoose(kind) }));
  usePaletteTarget({ addSong, live: page.live, adds, actions: pageActions(page, adds[0]!) });
  return null;
}

/** The likeliest commands of the page, in their order, each with its keys. */
function pageActions(p: PageState, addSong: { key: string; icon: React.ReactNode; run: () => void; label: string }): PaletteAction[] {
  const icon = (Icon: typeof PlayIcon) => <Icon className="size-4" />;
  if (!p.live)
    return [
      ...(p.canStart ? [{ key: 'start', label: t('shortcuts.start'), icon: icon(PlayIcon), keys: [isMac ? 'Ctrl+Alt+P' : 'F5'], run: p.onStart }] : []),
      { key: 'add-song', label: t('palette.addKind', { kind: addSong.label.toLocaleLowerCase() }), icon: addSong.icon, keys: ['a'], run: addSong.run },
    ];
  const media: PaletteAction[] = [];
  const { shown, players } = p;
  if (shown?.slide.video && players?.video) {
    const video = players.video;
    media.push({ key: 'video', label: t('palette.playPauseVideo'), icon: icon(PlayIcon), run: () => video.command({ action: video.state()?.playing ? 'pause' : 'play', itemId: shown.itemId }) });
  }
  if (shown?.slide.audio && players) {
    const audio = players.audio;
    media.push(
      { key: 'audio', label: t('palette.playPauseAudio'), icon: icon(PlayIcon), run: () => audio.command({ action: audio.state()?.playing ? 'pause' : 'play', itemId: shown.itemId }) },
      { key: 'fade', label: t('audio.fade'), icon: icon(FadeOutIcon), run: () => audio.command({ action: 'fade', itemId: shown.itemId }) },
    );
  }
  return [
    { key: 'next', label: t('shortcuts.nextSlide'), icon: icon(ChevronRightIcon), keys: [' ', 'PageDown'], run: () => p.onStep(1) },
    { key: 'previous', label: t('shortcuts.previousSlide'), icon: icon(ChevronLeftIcon), keys: ['PageUp'], run: () => p.onStep(-1) },
    ...media,
    { key: 'black', label: t('shortcuts.black'), icon: icon(BlackScreenIcon), keys: ['B'], run: p.onBlack },
    ...(p.ends ? [{ key: 'end', label: t('shortcuts.end'), icon: icon(StopIcon), keys: ['Ctrl+.'], run: () => runCommand('end') }] : []),
  ];
}
