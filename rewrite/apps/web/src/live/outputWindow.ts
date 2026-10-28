/**
 * The output window behind the live panel's Extern skärm switch
 * (LivePanel.razor): on opens it, off closes it, and the switch shows whether
 * it is open, so it turns off when the window is closed some other way.
 */

/** What can open and close the output, and tell when it closed by itself. */
export interface OutputHost {
  /** Opens the output; false when it could not be opened. */
  open(): boolean;
  close(): void;
  /** Starts telling `changed` whenever the output opens or closes on its own. */
  watch(changed: (open: boolean) => void): void;
}

export class OutputWindow {
  private open = false;
  private listeners = new Set<() => void>();

  constructor(private host: OutputHost) {
    host.watch((open) => this.set(open));
  }

  isOpen = (): boolean => this.open;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Turns the output on or off; false when it could not be opened. */
  turn(on: boolean): boolean {
    if (!on) {
      this.host.close();
      this.set(false);
      return true;
    }
    const opened = this.host.open();
    this.set(opened);
    return opened;
  }

  private set(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    for (const listener of this.listeners) listener();
  }
}

/** The desktop app: a native window the main process opens, closes and reports on. */
export function desktopHost(desktop: NonNullable<Window['gpDesktop']>): OutputHost {
  return {
    open() {
      desktop.openOutput();
      return true;
    },
    close: () => desktop.closeOutput(),
    watch(changed) {
      desktop.onOutputChanged(changed);
      // A reloaded page adopts a window that is still open.
      void desktop.outputOpen().then(changed);
    },
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
  let report: (open: boolean) => void = () => {};
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
        report(false);
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
