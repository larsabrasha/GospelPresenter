/**
 * The output windows behind the live panel's switches (LivePanel.razor): on opens one, off closes it, and each switch
 * shows whether its window is open, so it turns off when the window is closed some other way. The desktop app opens
 * one on each display the main window is not on (Lars, 2026-11-02); a browser, and a computer with one display, one
 * in a window of its own (`OUTPUT_WINDOW`).
 */

/** The output in a window of its own. */
export const OUTPUT_WINDOW = 'window';

/** A display an output may go to, named by the operating system ("EPSON PJ"); the name may be empty. */
export interface OutputDisplay {
  id: string;
  name: string;
}

/** What can open and close the outputs, and tell when one closed by itself. */
export interface OutputHost {
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

let shared: OutputWindow | undefined;

/** This window's output, made on first use. */
export function outputWindow(): OutputWindow {
  shared ??= new OutputWindow(
    window.gpDesktop ? desktopHost(window.gpDesktop) : browserHost(() => window.open(`/output${location.search}`, 'gp-output', 'popup')),
  );
  return shared;
}
