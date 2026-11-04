import type { LivePointer, Overlay, Presentation, CustomPage, Slide, Theme } from '@gp/core';
import { useRef } from 'react';
import { orgRemoteControl } from '../../db/queries.ts';
import { useData } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { LivePicture } from './LivePicture.tsx';
import { useLiveMotion } from './liveMotion.ts';
import { useFold } from '../../ui/sidePanels.ts';
import { PanelToggle } from '../../ui/PanelToggle.tsx';
import { OutputsPanel } from './OutputsPanel.tsx';
import { OverlaysPanel } from './OverlaysPanel.tsx';
import { RemoteStatus } from './RemotePanel.tsx';

/**
 * The live column on a computer or an iPad lying down (docs/layout-2-0.md): what is used during a service and no
 * more. The picture shown with ‹ Rensa ›, as on a phone (LivePicture), the overlays and the outputs folded to their
 * state, and at the foot a quiet line for Fjärrstyrning, as the offline line in the left column (Lars, 2026-11-02).
 * Avsluta is in the bar.
 */
export function LivePanel({
  presentation,
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
  open = true,
  onFold,
}: {
  presentation: Pick<Presentation, 'id' | 'name'>;
  owner: { sessionId: string } | null;
  link: LiveLink;
  live: LiveControl;
  pointer: LivePointer;
  current: Slide | null;
  overlay: CustomPage | null;
  theme: Theme;
  overlays: Overlay[];
  canStep: { back: boolean; forward: boolean };
  onStep: (delta: number) => void;
  /** Out, or folded off the right edge (ui/sidePanels.ts). */
  open?: boolean;
  /** Folds it away, by the toggle at its foot. */
  onFold?: () => void;
}) {
  const remotePolicy = useData(orgRemoteControl, []);
  // The column, which slides in from the right before the picture fades in after a start (liveMotion.ts).
  const column = useRef<HTMLElement>(null);
  useLiveMotion(column, { side: true });
  useFold(column, 'right', open);
  // As wide at the right as at the left whatever the scrollbar, as the left column (app.css `--beside-scrollbar`).
  return (
    <aside ref={column} className="flex w-[340px] shrink-0 overflow-y-auto flex-col gap-5 pl-5 pr-(--beside-scrollbar) pb-safe-4 pt-5 bg-surface border-l-[0.5px] border-separator" data-testid="live-panel">
      <LivePicture slide={current} theme={theme} overlay={overlay} black={pointer.black} canStep={canStep} onStep={onStep} onClear={() => live.set({ black: true })} />
      {/* Utgångar first: whether anything shows is what matters most while presenting (Lars, 2026-11-02). */}
      {owner ? <OutputsPanel link={link} sessionId={owner.sessionId} /> : <p className="text-xs text-stone-500 dark:text-stone-400 text-center">{t('remote.onlyOwnerStops')}</p>}
      {!!overlays.length && <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />}
      {/* The foot: the column's toggle at its left (ui/PanelToggle.tsx), Fjärrstyrning at its right. */}
      <div className="mt-auto -mx-2 -mb-3 flex items-center gap-1 empty:hidden">
        {onFold && <PanelToggle side="right" onFold={onFold} />}
        {owner && remotePolicy && remotePolicy !== 'never' && (
          <RemoteStatus id={presentation.id} sessionId={owner.sessionId} always={remotePolicy === 'always'} className="ml-auto w-auto min-w-0" />
        )}
      </div>
    </aside>
  );
}
