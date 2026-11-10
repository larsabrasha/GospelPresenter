// The output windows (spec 04 §1; Lars, 2026-11-02): one fullscreen on each display the main window is not on, each
// switched on and off on its own from Utgångar, so a projector and a TV can both show, or the laptop's own display
// while the app stands on an external one; with no other display, one in a window of its own (`WINDOW`).
import { BrowserWindow, screen, type WebPreferences } from 'electron';
import { goneTargets, WINDOW } from './output-targets.ts';

/** A display an output may go to, named as the operating system names it ("EPSON PJ", "Built-in Retina Display"). */
export interface OutputDisplay {
  id: string;
  name: string;
}

export function outputWindows({
  hidden,
  webPreferences,
  main,
  guard,
  url,
  log,
}: {
  /** The tests' hidden windows: never shown, and never on another display, so what they see does not hang on the desk. */
  hidden: boolean;
  webPreferences: WebPreferences;
  main: () => BrowserWindow | null;
  guard: (win: BrowserWindow) => void;
  url: () => string;
  log: (entry: Record<string, unknown>) => void;
}) {
  const open = new Map<string, BrowserWindow>();
  const send = (channel: string, value: unknown) => {
    const m = main();
    if (m && !m.isDestroyed()) m.webContents.send(channel, value);
  };
  const changed = () => send('outputs-changed', [...open.keys()]);

  /** Every display but the one the main window stands on. */
  function displays(): OutputDisplay[] {
    const m = main();
    if (hidden || !m || m.isDestroyed()) return [];
    const here = screen.getDisplayMatching(m.getBounds());
    return screen
      .getAllDisplays()
      .filter((d) => d.id !== here.id)
      .map((d) => ({ id: String(d.id), name: d.label }));
  }

  /** Opens the output on `target` (a display's id, or WINDOW), or brings it forward if it is open there. */
  function show(target: string) {
    const opened = open.get(target);
    if (opened && !opened.isDestroyed()) {
      changed();
      if (!hidden) opened.focus();
      return;
    }
    const display = target === WINDOW ? undefined : screen.getAllDisplays().find((d) => String(d.id) === target);
    if (target !== WINDOW && (!display || hidden)) return changed();
    const win = new BrowserWindow({
      title: 'Gospel Presenter – output',
      backgroundColor: '#000000',
      show: false,
      ...(display ? { ...display.bounds, fullscreen: true } : { width: 960, height: 540 }),
      autoHideMenuBar: true,
      webPreferences,
    });
    open.set(target, win);
    guard(win);
    // A page that crashed would leave the projector black with its switch on: it starts again, and says so in the log.
    win.webContents.on('render-process-gone', (_e, details) => {
      log({ event: 'output-crashed', target, reason: details.reason });
      if (!win.isDestroyed()) win.reload();
    });
    if (!hidden) win.once('ready-to-show', () => win.show());
    // However it closes (the switch, the window's own close button, the OS), the switches hear of it.
    win.on('closed', () => {
      if (open.get(target) === win) open.delete(target);
      changed();
      log({ event: 'output-closed', target });
    });
    void win.loadURL(url());
    changed();
    log({ event: 'output-opened', target });
  }

  /** Closes the output on `target`, or every output with none (Avsluta presentation). */
  function hide(target?: string) {
    for (const [at, win] of open) if ((target === undefined || at === target) && !win.isDestroyed()) win.close();
  }

  /**
   * Tells the page when the displays change: one plugged in or out, or the main window moved to another. A display
   * never has both the main window and an output (Lars, 2026-11-02): the main window moved onto a display with an
   * output closes that output, which would cover it and which its list no longer shows; the page says so in a toast.
   */
  function watchDisplays(win: BrowserWindow) {
    const tell = () => {
      // An output whose display went away closes; its switch goes off, and the display back opens it again.
      for (const target of goneTargets([...open.keys()], screen.getAllDisplays().map((d) => String(d.id)))) hide(target);
      if (!hidden && !win.isDestroyed()) {
        const here = screen.getDisplayMatching(win.getBounds());
        if (open.has(String(here.id))) {
          hide(String(here.id));
          send('output-closed-here', here.label);
        }
      }
      send('displays-changed', null);
    };
    screen.on('display-added', tell);
    screen.on('display-removed', tell);
    screen.on('display-metrics-changed', tell);
    win.on('moved', tell);
  }

  return { displays, show, hide, openTargets: () => [...open.keys()], watchDisplays };
}
