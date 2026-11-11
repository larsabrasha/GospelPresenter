import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserHost, desktopHost, OutputWindow, phoneHost, POPUP_POLL_MS, type OutputDisplay, type PopupLike } from '../src/live/outputWindow.ts';

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

/** The phone app's plugin for the screens beside its own (ExternalScreens.swift), with iOS played by the test. */
function fakeScreens(displays: OutputDisplay[] = [{ id: 'airplay', name: 'Vardagsrum' }]) {
  let changed: (e: { displays: OutputDisplay[]; open: string[] }) => void = () => {};
  const screens = {
    displays: () => Promise.resolve({ displays }),
    opened: () => Promise.resolve({ open: [] as string[] }),
    open: vi.fn((_: { id: string; url: string }) => Promise.resolve({ opened: true })),
    close: vi.fn((_: { id?: string }) => Promise.resolve()),
    addListener(_: 'changed', fn: typeof changed) {
      changed = fn;
      return Promise.resolve();
    },
  };
  return { plugin: Promise.resolve({ screens }), screens, changed: (e: { displays: OutputDisplay[]; open: string[] }) => changed(e) };
}

describe('the output on an AirPlay screen in the phone app', () => {
  beforeEach(() => vi.stubGlobal('location', { href: 'capacitor://localhost/presentations/P?x=1', search: '?x=1' }));
  afterEach(() => void vi.unstubAllGlobals());

  it('opens the output page on the screen chosen', async () => {
    const { plugin, screens } = fakeScreens();
    const output = new OutputWindow(phoneHost(plugin));

    output.turn(true, 'airplay');
    await Promise.resolve();
    await Promise.resolve();

    expect(screens.open).toHaveBeenCalledWith({ id: 'airplay', url: 'capacitor://localhost/output?x=1' });
  });

  it('lists the screens iOS gives the app, and follows what it reports open', async () => {
    const { plugin, changed } = fakeScreens();
    const output = new OutputWindow(phoneHost(plugin));
    const displays = await output.displays();
    await Promise.resolve();

    changed({ displays, open: ['airplay'] });

    expect(displays).toEqual([{ id: 'airplay', name: 'Vardagsrum' }]);
    expect(output.openTargets()).toEqual(['airplay']);
    expect(output.kind()).toBe('phone');
  });
});

/** Chrome's screens (Window Management API): the laptop's own, where the presenting window is, and an Apple TV beside it. */
function fakeScreens2(permission: PermissionState) {
  const laptop = { label: 'Inbyggd skärm', availLeft: 0, availTop: 0, availWidth: 1512, availHeight: 945 };
  const tv = { label: 'Vardagsrum', availLeft: 1512, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const details = { screens: [laptop, tv], currentScreen: laptop, addEventListener: () => undefined };
  return { permission: () => Promise.resolve(permission), details: vi.fn(() => Promise.resolve(details)) };
}

describe('the outputs in a browser that can place screens (Chrome)', () => {
  it('lists every screen but the presenting window’s, by name, once the user has let it see them', async () => {
    const output = new OutputWindow(browserHost(fakePopup, fakeScreens2('granted')));

    const displays = await output.displays();

    expect(displays).toEqual([{ id: '1512,0', name: 'Vardagsrum' }]);
    expect(output.canAskScreens()).toBe(false);
  });

  it('lists none, and offers to ask, before the user has answered', async () => {
    const screens = fakeScreens2('prompt');
    const output = new OutputWindow(browserHost(fakePopup, screens));

    const displays = await output.displays();

    expect(displays).toEqual([]);
    expect(screens.details).not.toHaveBeenCalled();
    expect(output.canAskScreens()).toBe(true);
  });

  it('opens the output over the whole of the screen chosen', async () => {
    const open = vi.fn((_name: string, _features: string) => fakePopup());
    const output = new OutputWindow(browserHost(open, fakeScreens2('granted')));
    await output.displays();

    output.turn(true, '1512,0');

    expect(open).toHaveBeenCalledWith('gp-output-1512,0', 'popup,left=1512,top=0,width=1920,height=1080');
    expect(output.openTargets()).toEqual(['1512,0']);
  });

  it('does not ask again once the user has refused', async () => {
    const output = new OutputWindow(browserHost(fakePopup, fakeScreens2('denied')));

    await output.displays();

    expect(output.canAskScreens()).toBe(false);
  });

  it('cannot ask where the browser cannot place screens', () => {
    const output = new OutputWindow(browserHost(fakePopup));

    expect(output.canAskScreens()).toBe(false);
  });
});
