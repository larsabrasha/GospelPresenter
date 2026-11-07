import { useEffect } from 'react';
import { autoOutputsSetting, displaysToTurnOn, lastOutputs } from '../../live/autoOutputs.ts';
import { outputWindow, type OutputDisplay } from '../../live/outputWindow.ts';

/**
 * Slå på utgångar automatiskt (live/autoOutputs.ts) while this window presents: at the start every display as it was
 * left last time, then each display plugged in the same way, and a display unplugged has its output closed. Nothing
 * before the presentation starts, nor with the setting off. The desktop app's displays and the phone app's AirPlay
 * screen alike; a browser places no output.
 */
export function useAutoOutputs(presenting: boolean) {
  useEffect(() => {
    const output = outputWindow();
    if (!presenting || output.kind() === 'browser' || !autoOutputsSetting()) return;
    let known: OutputDisplay[] | null = null;
    let current = true;
    const follow = () =>
      void output.displays().then((now) => {
        if (!current) return;
        const before = known;
        known = now;
        const added = before ? now.filter((d) => !before.some((k) => k.id === d.id)) : now;
        for (const id of displaysToTurnOn(added, lastOutputs())) output.turn(true, id);
        for (const d of before ?? []) if (!now.some((n) => n.id === d.id) && output.openTargets().includes(d.id)) output.turn(false, d.id);
      });
    follow();
    const stop = output.watchDisplays(follow);
    return () => {
      current = false;
      stop();
    };
  }, [presenting]);
}
