import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../../i18n.ts';
import type { LiveControl } from '../../live/remote.ts';
import { OverlayToggles } from '../OverlayToggles.tsx';
import { PanelSection } from './PanelSection.tsx';

/** Overlays on the live page (spec 04 §1): collapsed by default, with a dot while one is on; absent without overlays. */
export function OverlaysPanel({ overlays, pointer, live }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl }) {
  if (!overlays.length) return null;
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
