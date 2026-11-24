// Where the presentation's sound goes (Lars, 2026-11-07, for AirPlay): the computer's own output, or a device the
// operator picks under Utgångar, as an Apple TV used as a display through AirPlay, whose picture the output window
// shows while the computer's sound stays on its speakers, or a projector's HDMI. Kept for this computer
// (localStorage), so the output window, a window of its own, hears a change too ('storage'). Only where a page may
// send an element's sound elsewhere (`setSinkId`, not Safari) and can name the devices (the desktop app).

const KEY = 'gp.soundOutput';
const CHANGED = 'gp:sound-output';

/** A device the sound may go to, named as the operating system names it. */
export interface SoundDevice {
  id: string;
  name: string;
}

/** The device chosen; '' is the computer's own output, as the operating system has it. */
export function soundOutput(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSoundOutput(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // no storage: the choice is lost, the sound stays where it was
  }
  dispatchEvent(new Event(CHANGED));
}

/** Calls `fn` when the choice changes, in this window or another of this computer's. */
export function onSoundOutput(fn: () => void): () => void {
  const other = (e: StorageEvent) => e.key === KEY && fn();
  addEventListener(CHANGED, fn);
  addEventListener('storage', other);
  return () => {
    removeEventListener(CHANGED, fn);
    removeEventListener('storage', other);
  };
}

/** Whether this browser may send an element's sound to another device. */
const canChooseSound = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** The devices sound may go to, when the page may name them: none in a browser that hides their names. */
export async function soundDevices(): Promise<SoundDevice[]> {
  if (!canChooseSound() || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  // Chromium's 'default' and 'communications' are aliases of a real device: the first is the computer's own choice.
  return all.filter((d) => d.kind === 'audiooutput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, name: d.label }));
}

/** Sends the elements' sound to the device chosen, now and on every change; a device gone leaves it where it was. */
export function followSoundOutput(elements: () => HTMLMediaElement[]): () => void {
  const apply = () => {
    if (!canChooseSound()) return;
    const id = soundOutput();
    for (const el of elements()) void (el as HTMLMediaElement & { setSinkId(id: string): Promise<void> }).setSinkId(id).catch(() => undefined);
  };
  apply();
  return onSoundOutput(apply);
}
