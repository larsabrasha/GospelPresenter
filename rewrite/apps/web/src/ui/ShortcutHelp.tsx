import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n.ts';
import { Dialog } from './Dialog.tsx';
import { CAPTION, GROUP_ROW } from './Group.tsx';
import { isMac, isTextEntry } from './shortcuts.ts';

// The keyboard help (KeyboardShortcuts.razor, ShortcutHelpDialog.razor): `?` opens a dialog that lists the
// keys of what is on screen, one group per page or dialog, the topmost first, then "Överallt". A group
// that `blocks` (a dialog) hides the groups under it, whose keys are off while it is open. Drawn as iPadOS's list of
// a held ⌘ and macOS's menus write keys (Lars, 2026-11-05): each group's name over its card, in line with its rows'
// words; the keys in grey at the right, as glyphs, ⌥ before ⇧ before ⌘; the groups two abreast where there is room.

/** One line: the keys that do it, each as `Ctrl+1`, `Alt+ArrowDown`, a bare key or `g p` (one after the other), and what it does. */
type ShortcutLine = { keys: string[]; text: string };
export type ShortcutGroup = { title: string; lines: ShortcutLine[]; blocks?: boolean };

let groups: { id: number; group: ShortcutGroup }[] = [];

let nextId = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Lists `group` in the help dialog while the component is mounted. */
export function useShortcutGroup(group: ShortcutGroup): void {
  useEffect(() => {
    const id = nextId++;
    groups = [...groups, { id, group }];
    changed();
    return () => {
      groups = groups.filter((g) => g.id !== id);
      changed();
    };
  }, [group]);
}

/** The groups to show, the topmost first: down to the first that blocks, then "Överallt". */
export function describe(registered: ShortcutGroup[]): ShortcutGroup[] {
  const shown: ShortcutGroup[] = [];
  for (const g of registered.toReversed()) {
    shown.push(g);
    if (g.blocks) break;
  }
  return [...shown, { title: t('shortcuts.group.global'), lines: globalLines(typeof window !== 'undefined' && !!window.gpDesktop) }];
}

/** "Överallt": ui/appKeys.ts's keys; the desktop app's menu bar has ⌘ ones beside them. */
function globalLines(desktop: boolean): ShortcutLine[] {
  const go = (letter: string, n: number, text: string): ShortcutLine => ({ keys: [`g ${letter}`, ...(desktop ? [`Ctrl+${n}`] : [])], text });
  return [
    go('p', 1, t('shortcuts.goPresentations')),
    go('s', 2, t('shortcuts.goSongs')),
    go('b', 3, t('shortcuts.goBibles')),
    go('i', 4, t('shortcuts.goImages')),
    go('l', 5, t('shortcuts.goAudios')),
    go('v', 6, t('shortcuts.goVideos')),
    go('e', 7, t('shortcuts.goSlides')),
    { keys: [',', ...(desktop ? ['Ctrl+,'] : [])], text: t('shortcuts.settings') },
    { keys: ['Ctrl+K'], text: t('shortcuts.palette') },
    { keys: ['/', ...(desktop ? ['Ctrl+F'] : [])], text: t('shortcuts.search') },
    { keys: [isMac ? 'Ctrl+[' : 'Alt+ArrowLeft'], text: t('shortcuts.back') },
    { keys: ['?'], text: t('shortcuts.showHelp') },
  ];
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Escape: 'Esc',
  Delete: 'Del',
  ' ': 'Space',
};

/** macOS's order of the modifiers: ⌃ ⌥ ⇧ ⌘. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

/**
 * A key as the platform writes it (Shortcut.ToDisplay): `Ctrl+↵` or `⌘↵`, `Alt+↓` or `⌥↓`, `Ctrl+Alt+P` or `⌥⌘P`; a
 * letter in capitals, as a menu writes it; `g p` as `G P`, one after the other.
 */
export function keyLabel(spec: string, mac = isMac): string {
  if (spec.includes(' ') && spec.trim()) return spec.split(' ').map((k) => keyLabel(k, mac)).join(' ');
  const parts = spec === '+' ? ['+'] : spec.split('+');
  const key = parts.pop()!;
  const mods = parts.map((m) => (m === 'Ctrl' ? (mac ? '⌘' : 'Ctrl') : m === 'Alt' ? (mac ? '⌥' : 'Alt') : m === 'Shift' ? (mac ? '⇧' : 'Shift') : m));
  if (mac) mods.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
  const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...mods, name].join(mac ? '' : '+');
}

/** The `?` key and the dialog it opens; mounted once, in the signed-in app. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const registered = useSyncExternalStore(
    (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => groups,
  );
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (open && e.key === 'Escape') {
      // Focus may be outside the box (it has no field), or in a dialog under it, which must stay open.
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      return;
    }
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat || isTextEntry(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen((o) => !o);
  });
  useEffect(() => {
    // In the capture phase: a dialog keeps its keys from the page, and the add dialog's keys are listed too.
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);
  if (!open) return null;
  return (
    <Dialog title={t('shortcuts.title')} onClose={() => setOpen(false)} maxWidthClass="max-w-3xl" showClose>
      <div className="max-h-[65vh] overflow-y-auto -mx-1 px-1 grid sm:grid-cols-2 gap-x-6 gap-y-5 items-start">
        {describe(registered.map((g) => g.group)).map((group) => (
          <section key={group.title} className="space-y-1.5" aria-label={group.title}>
            <h3 className={CAPTION}>{group.title}</h3>
            <ul className="rounded-xl border-[0.5px] border-separator overflow-hidden [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
              {group.lines.map((line) => (
                <li key={line.text} className={GROUP_ROW}>
                  <span className="min-w-0">{line.text}</span>
                  <span className="shrink-0 flex flex-wrap justify-end gap-x-3 text-stone-500 dark:text-stone-400 tabular-nums">
                    {line.keys.map((k) => (
                      <kbd key={k} className="font-sans whitespace-nowrap">
                        {keyLabel(k)}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="px-4 text-xs text-stone-500 dark:text-stone-400">{t('shortcuts.hint')}</p>
    </Dialog>
  );
}
