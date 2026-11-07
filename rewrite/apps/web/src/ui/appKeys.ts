import { useEffect, useEffectEvent, useRef } from 'react';
import { navigate, type Route } from './router.ts';
import { isTextEntry } from './shortcuts.ts';
import { note } from '../report/trail.ts';

// The app's own keys, on every page and in Inställningar (Lars, 2026-11-05: the whole app by the keyboard): `g` and a
// letter goes to a section ("go to", as Gmail and GitHub have it: `a`, `b` and `n` are a page's own), `,` opens
// Inställningar, `/` the page's search, and `n` in Inställningar a list's + (the start page has its own `n`). The
// desktop app's menu bar sends the same as commands (⌘1–⌘7, ⌘,, ⌘F, ⌘N, ⌘[, ⌥⌘P), which a browser keeps for itself.

/** The sections `g` goes to, by their letter. */
const SECTIONS: Record<string, Route> = {
  p: { page: 'presentations' },
  s: { page: 'songs' },
  b: { page: 'bibles' },
  i: { page: 'images' },
  l: { page: 'audios' },
  v: { page: 'videos' },
  e: { page: 'customSlides' },
};

/** What a key or a choice in the menu bar does. */
export type AppCommand = `go:${string}` | 'settings' | 'search' | 'new' | 'newSong' | 'back' | 'start' | 'end' | 'report';

/** How long `g` waits for its letter. */
const SEQUENCE_MS = 1500;

/** The open dialog on top, or null: Inställningar is one, as a page (`data-page-dialog`). */
function topDialog(): Element | null {
  const all = document.querySelectorAll('[aria-modal="true"]');
  return all[all.length - 1] ?? null;
}

/** The topmost layer's visible elements that match `selector`: the dialog on top, else the page. */
function visibleIn(selector: string): HTMLElement[] {
  const root = topDialog() ?? document;
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.getClientRects().length > 0);
}

/** Runs a command. `start` and `end` are the presentation page's own (`useAppCommand`). */
export function runCommand(command: AppCommand): void {
  note('command', command);
  if (command.startsWith('go:')) {
    const route = SECTIONS[command.slice(3)];
    if (route) navigate(route);
  } else if (command === 'settings') navigate({ page: 'admin' });
  else if (command === 'search') {
    // The page's own, after Inställningar's list and its search.
    const field = visibleIn('input[type="search"], [role="searchbox"]').at(-1);
    field?.focus();
    if (field instanceof HTMLInputElement) field.select();
  } else if (command === 'new') visibleIn('[data-new]')[0]?.click();
  else if (command === 'newSong') {
    // Sånger's +, once Inställningar has drawn it.
    navigate({ page: 'songs' });
    const until = Date.now() + 2000;
    const press = () => {
      const plus = visibleIn('[data-new]')[0];
      if (plus) plus.click();
      else if (Date.now() < until) setTimeout(press, 50);
    };
    setTimeout(press);
  }
  else if (command === 'back') history.back();
  else for (const fn of handlers.get(command) ?? []) fn();
}

const handlers = new Map<AppCommand, Set<() => void>>();

/** A page's part of a command, while it is mounted. */
export function useAppCommand(command: AppCommand, fn: () => void): void {
  const run = useEffectEvent(fn);
  useEffect(() => {
    const set = handlers.get(command) ?? new Set();
    handlers.set(command, set);
    const own = () => run();
    set.add(own);
    return () => void set.delete(own);
  }, [command]);
}

/** The keys above, and the menu bar's commands; mounted once, in the signed-in app. */
export function useAppKeys(): void {
  /** When `g` was pressed, waiting for its letter; 0 for not. */
  const waiting = useRef(0);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
    // A dialog over the page has its own keys, and so has an open menu; only Inställningar, a page, lets these through.
    const top = topDialog();
    if ((top && !top.hasAttribute('data-page-dialog')) || document.querySelector('[role="menu"]')) return;
    const key = e.key.toLowerCase();
    let command: AppCommand | null = null;
    if (waiting.current && e.timeStamp - waiting.current < SEQUENCE_MS) {
      waiting.current = 0;
      if (SECTIONS[key]) command = `go:${key}`;
      else return;
    } else if (key === 'g') {
      // Not while presenting: a slip of `g` must not turn the live page's B (black) into Biblar.
      if (document.querySelector('[data-testid="live-panel"]')) return;
      waiting.current = e.timeStamp;
      e.preventDefault();
      e.stopPropagation();
      return;
    } else if (key === ',') command = 'settings';
    else if (key === '/') command = 'search';
    else if (key === 'n' && top) command = 'new';
    if (!command) return;
    e.preventDefault();
    e.stopPropagation();
    runCommand(command);
  });
  useEffect(() => {
    // In the capture phase: Inställningar's dialog keeps its keys from the page's listeners.
    addEventListener('keydown', onKey, true);
    const offMenu = window.gpDesktop?.onMenu?.((command) => runCommand(command as AppCommand));
    return () => {
      removeEventListener('keydown', onKey, true);
      offMenu?.();
    };
  }, []);
}
