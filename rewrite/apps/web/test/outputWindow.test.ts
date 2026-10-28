import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserHost, desktopHost, OutputWindow, POPUP_POLL_MS, type PopupLike } from '../src/live/outputWindow.ts';

/** A popup that can be closed by hand, as a user would with its close button. */
function fakePopup(): PopupLike {
  const popup = { closed: false, close: () => void (popup.closed = true) };
  return popup;
}

/** The desktop preload's output API, with the main process played by the test. */
function fakeDesktop(openAtStart = false) {
  let changed: (open: boolean) => void = () => {};
  const desktop = {
    openOutput: vi.fn(),
    closeOutput: vi.fn(),
    outputOpen: () => Promise.resolve(openAtStart),
    onOutputChanged(cb: (open: boolean) => void) {
      changed = cb;
      return () => {};
    },
  };
  return { desktop: desktop as unknown as NonNullable<Window['gpDesktop']>, mock: desktop, closedByMain: () => changed(false) };
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

describe('the output window in the desktop app', () => {
  it('asks the main process to open and to close it', () => {
    const { desktop, mock } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));

    output.turn(true);
    output.turn(false);

    expect(mock.openOutput).toHaveBeenCalledOnce();
    expect(mock.closeOutput).toHaveBeenCalledOnce();
  });

  it('turns off by itself when the main process reports the window closed', () => {
    const { desktop, closedByMain } = fakeDesktop();
    const output = new OutputWindow(desktopHost(desktop));
    output.turn(true);

    closedByMain();

    expect(output.isOpen()).toBe(false);
  });

  it('is on at start when the window is already open, as after a reload', async () => {
    const { desktop } = fakeDesktop(true);

    const output = new OutputWindow(desktopHost(desktop));
    await Promise.resolve();

    expect(output.isOpen()).toBe(true);
  });
});
