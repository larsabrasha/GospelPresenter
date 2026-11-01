import type { LivePointer, Overlay, Slide, Theme } from '@gp/core';
import type { ShownOverlay } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { LivePicture } from './LivePicture.tsx';
import { OutputsPanel } from './OutputsPanel.tsx';
import { OverlaysPanel } from './OverlaysPanel.tsx';

/**
 * The live column on a computer or an iPad lying down (docs/layout-2-0.md): what is used during a service and no
 * more. The picture shown with ‹ Rensa ›, as on a phone (LivePicture), the overlays and the outputs folded to their
 * state. Scenläge, Fjärrstyrning and Avsluta are in the bar.
 */
export function LivePanel({
  owner,
  link,
  live,
  pointer,
  current,
  overlay,
  theme,
  overlays,
  canStep,
  onStep,
}: {
  owner: { sessionId: string } | null;
  link: LiveLink;
  live: LiveControl;
  pointer: LivePointer;
  current: Slide | null;
  overlay: ShownOverlay | null;
  theme: Theme;
  overlays: Overlay[];
  canStep: { back: boolean; forward: boolean };
  onStep: (delta: number) => void;
}) {
  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto flex flex-col gap-5 p-4 pt-5 bg-surface border-l-[0.5px] border-separator" data-testid="live-panel">
      <LivePicture slide={current} theme={theme} overlay={overlay} black={pointer.black} canStep={canStep} onStep={onStep} onClear={() => live.set({ black: true })} />
      {!!overlays.length && <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />}
      {owner ? <OutputsPanel link={link} sessionId={owner.sessionId} /> : <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">{t('remote.onlyOwnerStops')}</p>}
    </aside>
  );
}
