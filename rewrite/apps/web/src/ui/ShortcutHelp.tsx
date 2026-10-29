import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n.ts';
import { Dialog } from './Dialog.tsx';
import { isMac, isTextEntry } from './shortcuts.ts';

// The keyboard help (KeyboardShortcuts.razor, ShortcutHelpDialog.razor): `?` opens a dialog that lists the
// keys of what is on screen, one group per page or dialog, the topmost first, then "Överallt". A group
// that `blocks` (a dialog, the stage view) hides the groups under it, whose keys are off while it is open.

/** One line: the keys that do it, each as `Ctrl+1`, `Alt+ArrowDown` or a bare key, and what it does. */
export type ShortcutLine = { keys: string[]; text: string };
export type ShortcutGroup = { title: string; lines: ShortcutLine[]; blocks?: boolean };

let groups: { id: number; group: ShortcutGroup }[] = [];
let shownNow = false;

/** Whether the help dialog is open: the stage view, which listens before any dialog, leaves the keys to it then. */
export function helpOpen(): boolean {
  return shownNow;
}
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
  return [...shown, { title: t('shortcuts.group.global'), lines: [{ keys: ['?'], text: t('shortcuts.showHelp') }] }];
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

/** A key as the platform writes it (Shortcut.ToDisplay): `Ctrl+↵` or `⌘↵`, `Alt+↓` or `⌥↓`. */
export function keyLabel(spec: string, mac = isMac): string {
  const parts = spec === '+' ? ['+'] : spec.split('+');
  const key = parts.pop()!;
  const mods = parts.map((m) => (m === 'Ctrl' ? (mac ? '⌘' : 'Ctrl') : m === 'Alt' ? (mac ? '⌥' : 'Alt') : m === 'Shift' ? (mac ? '⇧' : 'Shift') : m));
  return [...mods, KEY_NAMES[key] ?? key].join(mac ? '' : '+');
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
      // Focus may be outside the box (it has no field), or in a dialog under it, which must stay open; nor may
      // the stage view, listening on the window after this, take it as leaving.
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
  useEffect(() => {
    shownNow = open;
    return () => {
      shownNow = false;
    };
  }, [open]);
  if (!open) return null;
  return (
    <Dialog title={t('shortcuts.title')} onClose={() => setOpen(false)} maxWidthClass="max-w-lg" showClose>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 -mt-3">{t('shortcuts.hint')}</p>
      <div className="max-h-[60vh] overflow-y-auto space-y-5 -mx-1 px-1">
        {describe(registered.map((g) => g.group)).map((group) => (
          <section key={group.title} className="space-y-1" aria-label={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{group.title}</h3>
            <ul className="rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
              {group.lines.map((line) => (
                <li key={line.text} className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
                  <span className="text-sm min-w-0">{line.text}</span>
                  <span className="shrink-0 flex flex-wrap justify-end gap-1">
                    {line.keys.map((k) => (
                      <kbd
                        key={k}
                        className="px-2 py-1 rounded-md bg-neutral-100 dark:bg-neutral-700 border-b-2 border-neutral-300 dark:border-neutral-600 text-xs font-sans font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap"
                      >
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
    </Dialog>
  );
}
