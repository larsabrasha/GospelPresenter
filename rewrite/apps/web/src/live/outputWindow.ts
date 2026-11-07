/**
 * The output windows behind the live panel's switches (LivePanel.razor): on opens one, off closes it, and each switch
 * shows whether its window is open, so it turns off when the window is closed some other way. The desktop app opens
 * one on each display the main window is not on (Lars, 2026-11-02); a browser, and a computer with one display, one
 * in a window of its own (`OUTPUT_WINDOW`); the phone app one on each screen iOS gives it beside its own (AirPlay).
 */

import { serverChangeable } from '../server.ts';

/** The output in a window of its own. */
export const OUTPUT_WINDOW = 'window';

/** A display an output may go to, named by the operating system ("EPSON PJ"); the name may be empty. */
export interface OutputDisplay {
  id: string;
  name: string;
}

/** What can open and close the outputs, and tell when one closed by itself. */
export interface OutputHost {
  /** The desktop app and the phone app place an output on a display; a browser only opens a window, which the user moves. */
  kind: 'desktop' | 'phone' | 'browser';
  /** Opens the output on `target`; false when it could not be opened. */
  open(target: string): boolean;
  /** Closes the output on `target`, or every output with none. */
  close(target?: string): void;
  /** Starts telling `changed` where outputs are open whenever one opens or closes on its own. */
  watch(changed: (open: string[]) => void): void;
  /** The displays an output may go to; none where only a window of its own can be had. */
  displays(): Promise<OutputDisplay[]>;
  /** Starts telling `changed` when the displays change; returns how to stop. */
  watchDisplays(changed: () => void): () => void;
}

export class OutputWindow {
  private open: readonly string[] = [];
  private listeners = new Set<() => void>();

  constructor(private host: OutputHost) {
    host.watch((open) => this.set(open));
  }

  /** How this window's outputs are placed: on displays by the desktop or phone app, or in a browser's window. */
  kind = (): OutputHost['kind'] => this.host.kind;

  /** Whether any output is open. */
  isOpen = (): boolean => this.open.length > 0;

  /** Where outputs are open; the same array until that changes, for useSyncExternalStore. */
  openTargets = (): readonly string[] => this.open;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  displays = (): Promise<OutputDisplay[]> => this.host.displays();

  watchDisplays = (changed: () => void): (() => void) => this.host.watchDisplays(changed);

  /** Turns the output on `target` on or off, every output off with none; false when it could not be opened. */
  turn(on: boolean, target?: string): boolean {
    if (!on) {
      this.host.close(target);
      this.set(target === undefined ? [] : this.open.filter((x) => x !== target));
      return true;
    }
    const to = target ?? OUTPUT_WINDOW;
    const opened = this.host.open(to);
    if (opened && !this.open.includes(to)) this.set([...this.open, to]);
    return opened;
  }

  private set(open: readonly string[]) {
    if (open.length === this.open.length && open.every((x) => this.open.includes(x))) return;
    this.open = open;
    for (const listener of this.listeners) listener();
  }
}

/** The desktop app: native windows the main process opens, closes and reports on, one per display. */
export function desktopHost(desktop: NonNullable<Window['gpDesktop']>): OutputHost {
  return {
    kind: 'desktop',
    open(target) {
      desktop.openOutput(target);
      return true;
    },
    close: (target) => desktop.closeOutput(target),
    watch(changed) {
      desktop.onOutputsChanged(changed);
      // A reloaded page adopts the windows that are still open.
      void desktop.outputsOpen().then(changed);
    },
    displays: () => desktop.outputDisplays(),
    watchDisplays: (changed) => desktop.onDisplaysChanged(changed),
  };
}

/** The part of a browser window this needs, so tests can stand in for it. */
export interface PopupLike {
  readonly closed: boolean;
  close(): void;
}

/** How often a browser checks whether the popup was closed: it has no event for it. */
export const POPUP_POLL_MS = 500;

/**
 * A browser: a popup window. Closed by hand, it is noticed within half a
 * second. A reloaded page cannot know of a popup it opened before; switching
 * on again finds that one by its name rather than opening a second.
 */
export function browserHost(openPopup: () => PopupLike | null): OutputHost {
  let popup: PopupLike | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let report: (open: string[]) => void = () => {};
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
    popup = null;
  };
  return {
    kind: 'browser',
    open() {
      stop();
      popup = openPopup();
      if (!popup) return false;
      const watched = popup;
      timer = setInterval(() => {
        if (!watched.closed) return;
        stop();
        report([]);
      }, POPUP_POLL_MS);
      return true;
    },
    close() {
      popup?.close();
      stop();
    },
    watch(changed) {
      report = changed;
    },
    // A browser may not place a window on another display: the one popup.
    displays: () => Promise.resolve([]),
    watchDisplays: () => () => {},
  };
}

/** The phone app's screens beside its own (apps/mobile/ios/App/App/ExternalScreens.swift). */
export interface OutputScreens {
  displays(): Promise<{ displays: OutputDisplay[] }>;
  opened(): Promise<{ open: string[] }>;
  open(options: { id: string; url: string }): Promise<{ opened: boolean }>;
  close(options: { id?: string }): Promise<void>;
  addListener(event: 'changed', fn: (e: { displays: OutputDisplay[]; open: string[] }) => void): Promise<unknown>;
}

/**
 * The phone app: an AirPlay screen, or one on a cable, which iOS gives the app as a screen of its own; its output is
 * the output page in a web view of the app's on it (Lars, 2026-11-07). No window of its own: a phone has none to put
 * one in. `plugin` resolves once Capacitor's plugin is loaded; wrapped, since a plugin is a proxy that takes `then` for
 * a method of its own, so it cannot be a promise's value.
 */
export function phoneHost(plugin: Promise<{ screens: OutputScreens }>): OutputHost {
  const withScreens = <T>(fn: (s: OutputScreens) => T | Promise<T>) => plugin.then((p) => fn(p.screens));
  let report: (open: string[]) => void = () => {};
  const displaysChanged = new Set<() => void>();
  void withScreens((s) => {
    void s.addListener('changed', (e) => {
      report(e.open);
      for (const fn of displaysChanged) fn();
    });
    void s.opened().then((r) => report(r.open));
  });
  return {
    kind: 'phone',
    open(target) {
      // Told by `changed` once it shows, or that it did not.
      void withScreens((s) => s.open({ id: target, url: new URL(`/output${location.search}`, location.href).href }));
      return true;
    },
    close: (target) => void withScreens((s) => s.close({ id: target })),
    watch(changed) {
      report = changed;
    },
    displays: () => withScreens((s) => s.displays()).then((r) => r.displays),
    watchDisplays(changed) {
      displaysChanged.add(changed);
      return () => void displaysChanged.delete(changed);
    },
  };
}

let shared: OutputWindow | undefined;

/** This window's output, made on first use. */
export function outputWindow(): OutputWindow {
  shared ??= new OutputWindow(
    window.gpDesktop
      ? desktopHost(window.gpDesktop)
      : serverChangeable
        ? phoneHost(import('@capacitor/core').then(({ registerPlugin }) => ({ screens: registerPlugin<OutputScreens>('OutputScreens') })))
        : browserHost(() => window.open(`/output${location.search}`, 'gp-output', 'popup')),
  );
  return shared;
}
