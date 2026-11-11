import type { LivePointer, Overlay } from '@gp/core';
import { t } from '../../i18n.ts';
import type { LiveControl } from '../../live/remote.ts';
import { OverlayToggles } from '../OverlayToggles.tsx';
import { PanelGroup } from './PanelGroup.tsx';

/**
 * Overlays on the live page (spec 04 §1): a group as Utgångar's (Lars, 2026-11-02), a switch for each; absent without
 * overlays. `sheet` in a phone's Visning sheet.
 */
export function OverlaysPanel({ overlays, pointer, live, sheet }: { overlays: Overlay[]; pointer: LivePointer; live: LiveControl; sheet?: boolean }) {
  if (!overlays.length) return null;
  return (
    <PanelGroup title={t('overlays.title')} hint={t('live.overlaysHint')} sheet={sheet}>
      <OverlayToggles overlays={overlays} pointer={pointer} live={live} cell />
    </PanelGroup>
  );
}
