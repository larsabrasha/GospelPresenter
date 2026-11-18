import type { SlideAt } from '@gp/core';
import { useEffect } from 'react';
import type { PageCommand, PageControl, PageEvent } from '../../live/pageState.ts';
import { usePageKeys } from '../../ui/shortcuts.ts';
import { placedSlides, slideAcross } from './slideGridNav.ts';

/** How long typed digits wait for ↵ before they are forgotten. */
const TYPED_MS = 3000;

/**
 * The presentation page's keys (spec 03 section 6, spec 04 "Keyboard shortcuts during live"), as ProPresenter's: never
 * behind a dialog (PRES-R37), never a held key repeating, never in a text field (ui/shortcuts.ts). What each key does
 * is the core's (`pageEventView`, crates/gp-core/src/page_state.rs, which says what each event is), the same on every
 * shell; this turns a key into its event, does the command the core answers with (`onCommand`), and keeps what only
 * the screen knows: which slide stands above another (↑ ↓, as Finder's icons), where the focus is (whether ↵ is the
 * page's), and how long a number typed waits.
 */
export function useEditorKeys(o: {
  ticking: boolean;
  page: PageControl;
  /** The slide shown while presenting, where ↑ ↓ start from when nothing is made ready. */
  shown: SlideAt | null;
  onCommand: (command: PageCommand) => void;
}): void {
  const { page } = o;
  const typed = page.state.typed;
  useEffect(() => {
    if (!typed) return;
    const timer = setTimeout(() => page.send({ type: 'clearTyped' }), TYPED_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new number typed starts the wait again; `page` is new every render
  }, [typed]);
  usePageKeys((e) => {
    if (o.ticking) return;
    // The core's answer: its command done, and the key kept from the browser only when it was the page's.
    const send = (event: PageEvent) => {
      const { command, handled } = page.send(event);
      if (command) o.onCommand(command);
      if (handled) e.preventDefault();
    };
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
    const command = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (plain && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // ↑ ↓ a row as the slides stand; where they stand in one column (a phone), the same as ← →.
      e.preventDefault();
      const from = page.state.picked ?? o.shown;
      const key = slideAcross(placedSlides(), from && `${from.itemId}/${from.partIndex}`, e.key === 'ArrowDown' ? 1 : -1);
      if (!key) return;
      const [itemId, part] = key.split('/') as [string, string];
      return send({ type: 'pickAt', itemId, partIndex: Number(part) });
    }
    const plainKeys: Record<string, PageEvent> = {
      ArrowRight: { type: 'pick', delta: 1 },
      ArrowLeft: { type: 'pick', delta: -1 },
      PageDown: { type: 'clicker', delta: 1 },
      PageUp: { type: 'clicker', delta: -1 },
      ' ': { type: 'step', delta: 1 },
      b: { type: 'black' },
      B: { type: 'black' },
      '.': { type: 'black' },
    };
    if (plain && !e.shiftKey && plainKeys[e.key]) return send(plainKeys[e.key]!);
    // ⌥↑ ⌥↓ move the selected item one place: the keyboard's way to do what the drag handle does.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return send({ type: 'move', delta: e.key === 'ArrowUp' ? -1 : 1 });
    // F5, as PowerPoint's, and ⌥⌘P, as Keynote's Spela upp: Starta presentation. F5 never reloads this page, so a slip
    // of it while presenting does not start the page over.
    if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyP')) {
      e.preventDefault();
      return send({ type: 'start' });
    }
    // ⌘↑ ⌘↓ (Ctrl on Windows): the item before or after.
    if (command && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return send({ type: 'item', delta: e.key === 'ArrowDown' ? 1 : -1 });
    // ⌘. or Ctrl+., the Mac's "stop": Avsluta presentation, which asks first (PresentationBar's `end`).
    if (command && e.key === '.') {
      e.preventDefault();
      return send({ type: 'end' });
    }
    if (!plain) return;
    if (e.key === 'a') return send({ type: 'add' });
    if (e.key === 'Delete') return send({ type: 'delete' });
    if (/^[0-9]$/.test(e.key)) return send({ type: 'digit', digit: Number(e.key) });
    if (e.key === 'Escape') return send({ type: 'escape' });
    if (e.key === 'Enter') return send({ type: 'enter', onPage: onPage(e.target) });
  });
}

/** The page itself, a running order's row or a slide: where ↵ is the page's, not a focused button's. */
const onPage = (target: EventTarget | null) => target === document.body || (target instanceof Element && target.matches('[data-item-id] [aria-pressed], [data-current]'));
