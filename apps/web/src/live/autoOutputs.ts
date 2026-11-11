import type { OutputDisplay } from './outputWindow.ts';

// Slå på utgångar automatiskt (Lars, 2026-11-02): on a church's computer that does nothing else, the outputs come on
// as a presentation starts and as a display is plugged in while it runs, each as it was left last time; a display
// unplugged has its output closed. A choice of the device, on at first, in the desktop app only: a browser cannot
// place an output on a display.

const AUTO_KEY = 'gp.autoOutputs';
/** Each display's switch as it was last left by hand, by the display's name. */
const LAST_KEY = 'gp.outputsLast';

export function autoOutputsSetting(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoOutputsSetting(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    // Storage refused: the choice is not kept.
  }
}

/** The switches as last left by hand: a display's name, and whether it was on. */
export function lastOutputs(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Keeps a display's switch as it was left by hand, for the next time it comes on by itself. */
export function rememberOutput(name: string, on: boolean) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...lastOutputs(), [name]: on }));
  } catch {
    // Storage refused: it is not remembered.
  }
}

/** The displays to switch on by themselves: every one but those last switched off by hand. */
export function displaysToTurnOn(displays: readonly OutputDisplay[], last: Record<string, boolean>): string[] {
  return displays.filter((d) => last[d.name] !== false).map((d) => d.id);
}
