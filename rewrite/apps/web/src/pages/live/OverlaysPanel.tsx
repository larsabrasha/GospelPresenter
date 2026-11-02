import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../../i18n.ts';
import type { LiveControl } from '../../live/remote.ts';
import { OverlayToggles } from '../OverlayToggles.tsx';
import { PanelSection } from './PanelSection.tsx';

/**
 * Overlays on the live page (spec 04 §1): collapsed by default, with a dot while one is on; absent without overlays.
 * `bare` in a sheet of its own (a phone): the switches and the explanation, no section to fold.
 */
export function OverlaysPanel({ overlays, pointer, live, bare }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl; bare?: boolean }) {
  if (!overlays.length) return null;
  if (bare)
    return (
      <div className="space-y-2">
        <OverlayToggles overlays={overlays} pointer={pointer} live={live} />
        <p className="px-1 text-xs/4 text-stone-500 dark:text-stone-400">{t('live.overlaysHint')}</p>
      </div>
    );
  return (
    <PanelSection
      title={t('overlays.title')}
      hint={t('live.overlaysHint')}
      open={false}
      badge={pointer.overlayId && <span className="size-2 rounded-full bg-sky-500" data-testid="overlay-on" />}
    >
      <OverlayToggles overlays={overlays} pointer={pointer} live={live} />
    </PanelSection>
  );
}
