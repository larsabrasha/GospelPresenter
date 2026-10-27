import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../i18n.ts';
import type { LiveControl } from '../live/remote.ts';
import { SWITCH, ToggleRow } from '../ui/Toggle.tsx';

/**
 * The overlay toggles of the live page and the stage view (LIVE-R15): one
 * each, at most one on. Turning on another replaces the one shown; turning
 * off the one shown clears it. `stage` draws them for the stage view's dark sheet.
 */
export function OverlayToggles({ overlays, pointer, live, stage }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl; stage?: boolean }) {
  const set = (o: Overlay, on: boolean) => live.set({ overlayId: on ? o.id : null });
  return (
    <ul className={`flex flex-col ${stage ? 'gap-2' : 'gap-3'}`} aria-label={t('overlays.title')}>
      {overlays.map((o) => {
        const on = pointer.overlayId === o.id;
        return (
          <li key={o.id}>
            {stage ? (
              <label
                title={o.title}
                className={`cursor-pointer flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm ${on ? 'bg-sky-900/30 ring-1 ring-sky-500 text-white' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}
              >
                <span className="truncate">{o.title}</span>
                <input type="checkbox" className={SWITCH} aria-label={o.title} checked={on} onChange={(e) => set(o, e.target.checked)} />
              </label>
            ) : (
              <ToggleRow label={o.title} checked={on} onChange={(v) => set(o, v)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
