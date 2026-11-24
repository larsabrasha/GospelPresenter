import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../i18n.ts';
import type { LiveControl } from '../live/remote.ts';
import { SquaresOverlapIcon } from '../ui/icons.tsx';
import { ToggleRow } from '../ui/Toggle.tsx';
import { GROUP_LIST } from './live/PanelGroup.tsx';

/**
 * The overlay toggles of the live page (LIVE-R15): one each, at most one on. Turning on another replaces the one
 * shown; turning off the one shown clears it.
 */
export function OverlayToggles({ overlays, pointer, live, cell }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl; cell?: boolean }) {
  const set = (o: Overlay, on: boolean) => live.set({ overlayId: on ? o.id : null });
  return (
    <ul className={cell ? GROUP_LIST : 'flex flex-col gap-3'} aria-label={t('overlays.title')}>
      {overlays.map((o) => {
        const on = pointer.overlayId === o.id;
        return (
          <li key={o.id}>
            <ToggleRow label={o.title} title={o.title} checked={on} onChange={(v) => set(o, v)} cell={cell} icon={cell && <SquaresOverlapIcon className="size-4 shrink-0 text-stone-500 dark:text-stone-400" />} />
          </li>
        );
      })}
    </ul>
  );
}
