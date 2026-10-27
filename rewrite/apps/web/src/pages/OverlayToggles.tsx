import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../i18n.ts';
import type { LiveControl } from '../live/remote.ts';

/**
 * The overlay toggles of the live page and the stage view (LIVE-R15): one
 * each, at most one on. Turning on another replaces the one shown; turning
 * off the one shown clears it.
 */
export function OverlayToggles({ overlays, pointer, live }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl }) {
  return (
    <ul className="list" aria-label={t('overlays.title')}>
      {overlays.map((o) => (
        <li key={o.id}>
          <label className="row">
            <input type="checkbox" checked={pointer.overlayId === o.id} onChange={(e) => live.set({ overlayId: e.target.checked ? o.id : null })} />
            {o.title}
          </label>
        </li>
      ))}
    </ul>
  );
}
