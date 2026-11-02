import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserHost, desktopHost, OutputWindow, POPUP_POLL_MS, type PopupLike } from '../src/live/outputWindow.ts';

/** A popup that can be closed by hand, as a user would with its close button. */
function fakePopup(): PopupLike {
  const popup = { closed: false, close: () => void (popup.closed = true) };
  return popup;
}

/** The desktop preload's output API, with the main process played by the test. */
function fakeDesktop(openAtStart: string[] = []) {
  let changed: (open: string[]) => void = () => {};
  const desktop = {
    openOutput: vi.fn(),
    closeOutput: vi.fn(),
    outputsOpen: () => Promise.resolve(openAtStart),
    onOutputsChanged(cb: (open: string[]) => void) {
      changed = cb;
      return () => {};
    },
    outputDisplays: () => Promise.resolve([]),
    onDisplaysChanged: () => () => {},
  };
  return { desktop: desktop as unknown as NonNullable<Window['gpDesktop']>, mock: desktop, reported: (open: string[]) => changed(open) };
}

describe('the output window in a browser', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('is open after turning it on', () => {
    const output = new OutputWindow(browserHost(fakePopup));

    const opened = output.turn(true);

    expect(opened).toBe(true);
    expect(output.isOpen()).toBe(true);
  });

  it('closes the popup when turned off', () => {
    const popup = fakePopup();
    const output = new OutputWindow(browserHost(() => popup));
    output.turn(true);

    output.turn(false);

    expect(popup.closed).toBe(true);
    expect(output.isOpen()).toBe(false);
  });

  it('turns off by itself when the popup is closed by hand', () => {
    const popup = fakePopup();
    const output = new OutputWindow(browserHost(() => popup));
    const listener = vi.fn();
    output.subscribe(listener);
    output.turn(true);
    listener.mockClear();

    popup.close();
    vi.advanceTimersByTime(POPUP_POLL_MS);

    expect(output.isOpen()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('stays off and says so when the popup is blocked', () => {
    const output = new OutputWindow(browserHost(() => null));

    const opened = output.turn(true);

    expect(opened).toBe(false);
    expect(output.isOpen()).toBe(false);
  });
});

describe('the output windows in the desktop app', () => {
  it('asks the main process to open and to close the one on a display', () => {
    const { desktop, mock } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));

    output.turn(true, 'projector');
    output.turn(false, 'projector');

    expect(mock.openOutput).toHaveBeenCalledWith('projector');
    expect(mock.closeOutput).toHaveBeenCalledWith('projector');
  });

  it('keeps one output on each display, so two can be on at once', () => {
    const { desktop } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));

    output.turn(true, 'projector');
    output.turn(true, 'tv');

    expect(output.openTargets()).toEqual(['projector', 'tv']);
  });

  it('turns one off without the other', () => {
    const { desktop } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));
    output.turn(true, 'projector');
    output.turn(true, 'tv');

    output.turn(false, 'projector');

    expect(output.openTargets()).toEqual(['tv']);
  });

  it('turns every output off with no display named, as ending the presentation does', () => {
    const { desktop, mock } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));
    output.turn(true, 'projector');
    output.turn(true, 'tv');

    output.turn(false);

    expect(output.isOpen()).toBe(false);
    expect(mock.closeOutput).toHaveBeenCalledWith(undefined);
  });

  it('follows what the main process reports, as a window closed by hand', () => {
    const { desktop, reported } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));
    output.turn(true, 'projector');

    reported([]);

    expect(output.isOpen()).toBe(false);
  });

  it('is on at start where windows are already open, as after a reload', async () => {
    const { desktop } = fakeDesktop(['projector']);

    const output = new OutputWindow(desktopHost(desktop));
    await Promise.resolve();

    expect(output.openTargets()).toEqual(['projector']);
  });
});
