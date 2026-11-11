import type { PresentationItem } from '@gp/core';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import type { LiveControl } from '../../live/remote.ts';
import { runCommand } from '../../ui/appKeys.ts';
import { usePageKeys } from '../../ui/shortcuts.ts';
import type { SlidePick } from '../live/SlideList.tsx';
import { useTypedNumber } from './typedNumber.ts';
import { placedSlides, slideAcross } from './slideGridNav.ts';

/**
 * The presentation page's keys (spec 03 section 6, spec 04 "Keyboard shortcuts during live"), as ProPresenter's: never
 * behind a dialog (PRES-R37), never a held key repeating, never in a text field (ui/shortcuts.ts).
 *
 * While presenting (Lars, 2026-11-07: a nervous ↓ showed the next item at once, a song may start on its chorus, and an
 * outline always there that moved by itself was hard to follow): ↵ shows the next slide, as Space and PageDown, unless
 * a slide has been made ready, outlined in blue (`picked`), which ↵ then shows, the outline gone after. The arrows
 * make one ready and move it through the slides as they stand, ← → a slide, ↑ ↓ a row (as Finder's icons); ⌘↑ ⌘↓ mark
 * the item before or after, focus its row and make its first slide ready; a number makes that slide of the item marked
 * ready. Escape goes back a step: the number, then the outline. Space PageDown PageUp, a clicker's keys, step what is
 * shown at once; `b` and `.` black, as Släck. The slide made ready is said over the live picture (`cueText`).
 * Before presenting the same keys move the slide picked; Space stays a focused button's, and nothing blacks.
 */
export function useEditorKeys(o: {
  ticking: boolean;
  presenting: boolean;
  live: LiveControl;
  liveItemId: string | null;
  items: PresentationItem[];
  slides: Map<string, ItemSlides> | undefined;
  selected: PresentationItem | null;
  setSelectedId: (itemId: string | null) => void;
  /** The slide the keys outlined in blue: before presenting the one picked, while presenting the one ↵ shows. */
  picked: SlidePick | null;
  /** The slide shown while presenting, where the outline starts from. */
  shown: SlidePick | null;
  setPicked: (p: SlidePick | null) => void;
  /** Steps what is shown, or the outline, by a slide through the running order. */
  step: (delta: number) => void;
  pickStep: (delta: number) => void;
  /** Starta presentation, when it may start. */
  start: (() => void) | null;
  onAdd: () => void;
  onRemove: (item: PresentationItem) => void;
  onMove: (item: PresentationItem, by: number) => void;
  /** Scrolls the slides to an item, as a click on its row does. */
  onReveal: (itemId: string) => void;
}): { cueText: string | null } {
  const { presenting, live, liveItemId, items, slides, selected, picked } = o;
  const typing = useTypedNumber();
  const count = (itemId: string) => slides?.get(itemId)?.slides.length ?? 0;
  const title = (itemId: string) => items.find((i) => i.id === itemId)?.title ?? '';
  usePageKeys((e) => {
    if (o.ticking) return;
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
    const arrow = (delta: number) => {
      typing.clear();
      o.pickStep(delta);
    };
    // ↑ ↓ a row as the slides stand; where they stand in one column (a phone), the same as ← →.
    const row = (dir: 1 | -1) => {
      typing.clear();
      const from = picked ?? o.shown;
      const key = slideAcross(placedSlides(), from && `${from.itemId}/${from.partIndex}`, dir);
      if (!key) return;
      const [itemId, part] = key.split('/') as [string, string];
      o.setPicked({ itemId, partIndex: Number(part) });
      o.setSelectedId(itemId);
    };
    const clicker = (delta: number) => (presenting ? o.step(delta) : o.pickStep(delta));
    const black = () => live.set({ black: true });
    const keys: Record<string, () => void> = {
      ArrowRight: () => arrow(1),
      ArrowLeft: () => arrow(-1),
      ArrowDown: () => row(1),
      ArrowUp: () => row(-1),
      PageDown: () => clicker(1),
      PageUp: () => clicker(-1),
      ...(presenting ? { ' ': () => clicker(1), b: black, B: black, '.': black } : {}),
    };
    if (plain && !e.shiftKey && keys[e.key]) {
      e.preventDefault();
      keys[e.key]!();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Alt+↑/↓ moves the selected item one place: the keyboard's way to do what the drag handle does.
      if (!selected) return;
      e.preventDefault();
      o.onMove(selected, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    // F5, as PowerPoint's, and ⌥⌘P, as Keynote's Spela upp: Starta presentation. F5 never reloads this page, so a slip
    // of it while presenting does not start the page over.
    if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyP')) {
      e.preventDefault();
      o.start?.();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
      // ⌘↑ ⌘↓ (Ctrl on Windows): the item before or after. PRES-R41: no wrap; from none, ↓ the first, ↑ the last.
      e.preventDefault();
      const at = items.findIndex((i) => i.id === selected?.id);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      const item = items[next]!;
      o.setSelectedId(item.id);
      typing.clear();
      // Its first slide made ready, unless it is what is shown; the focus with the mark, so ↵ is not a slide's clicked before.
      o.setPicked(count(item.id) && !(presenting && item.id === liveItemId) ? { itemId: item.id, partIndex: 0 } : null);
      // One with no slides (a heading) has no outline to follow: the slides go to it all the same (Lars, 2026-11-07).
      if (!count(item.id)) o.onReveal(item.id);
      if (presenting) document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(item.id)}"] [aria-pressed]`)?.focus({ preventScroll: true });
      return;
    }
    // ⌘. or Ctrl+., the Mac's "stop": Avsluta presentation, which asks first (PresentationBar's `end`).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '.') {
      e.preventDefault();
      if (presenting) runCommand('end');
      return;
    }
    if (!plain) return;
    if (e.key === 'a') o.onAdd(); // the most used
    // The item shown cannot be removed while presenting (docs/layout-2-0.md).
    else if (e.key === 'Delete' && selected && !(presenting && selected.id === liveItemId)) o.onRemove(selected);
    else if (presenting && /^[0-9]$/.test(e.key)) {
      const typed = (typing.typed + e.key).slice(-3);
      typing.set(typed);
      const itemId = picked?.itemId ?? selected?.id ?? liveItemId;
      const at = Number(typed) - 1;
      if (itemId && at >= 0 && at < count(itemId)) o.setPicked({ itemId, partIndex: at });
    } else if (e.key === 'Escape' && typing.typed) typing.clear();
    else if (e.key === 'Escape' && presenting && picked) {
      o.setPicked(null);
      if (liveItemId) o.setSelectedId(liveItemId);
    } else if (e.key === 'Enter' && presenting && (picked || typing.typed || onPage(e.target))) {
      // A slide made ready, or a number, take the ↵ wherever the focus is; else only on the page, a row or a slide, so
      // any other focused button keeps its ↵. A number with no such slide shows nothing; with none made ready, the next.
      typing.clear();
      if (typing.typed && !(picked && Number(typing.typed) - 1 === picked.partIndex)) return void e.preventDefault();
      if (picked) {
        live.set({ ...picked, black: false });
        o.setPicked(null);
      } else o.step(1);
    } else return;
    e.preventDefault();
  });
  // Said over the live picture once the keys moved the outline: the slide ↵ shows, or that the number typed has none.
  const typedAt = typing.typed ? Number(typing.typed) : null;
  const target = picked?.itemId ?? selected?.id ?? liveItemId;
  if (!presenting) return { cueText: null };
  if (typedAt !== null && target && (typedAt < 1 || typedAt > count(target))) return { cueText: t('live.noSuchSlide', { n: typedAt, item: title(target) }) };
  return { cueText: picked ? t('live.cued', { n: picked.partIndex + 1, item: title(picked.itemId) }) : null };
}

/** The page itself, a running order's row or a slide: where ↵ is the page's, not a focused button's. */
const onPage = (target: EventTarget | null) => target === document.body || (target instanceof Element && target.matches('[data-item-id] [aria-pressed], [data-current]'));
