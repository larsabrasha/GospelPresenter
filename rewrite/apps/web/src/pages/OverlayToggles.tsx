import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../i18n.ts';
import type { LiveControl } from '../live/remote.ts';
import { ToggleRow } from '../ui/Toggle.tsx';

/**
 * The overlay toggles of the live page (LIVE-R15): one each, at most one on. Turning on another replaces the one
 * shown; turning off the one shown clears it.
 */
export function OverlayToggles({ overlays, pointer, live }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl }) {
  const set = (o: Overlay, on: boolean) => live.set({ overlayId: on ? o.id : null });
  return (
    <ul className="flex flex-col gap-3" aria-label={t('overlays.title')}>
      {overlays.map((o) => {
        const on = pointer.overlayId === o.id;
        return (
          <li key={o.id}>
            <ToggleRow label={o.title} title={o.title} checked={on} onChange={(v) => set(o, v)} />
          </li>
        );
      })}
    </ul>
  );
}
