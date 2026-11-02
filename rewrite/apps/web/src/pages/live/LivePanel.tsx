import type { LivePointer, Overlay, Presentation, Slide, Theme } from '@gp/core';
import { orgRemoteControl, type ShownOverlay } from '../../db/queries.ts';
import { useData } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { LivePicture } from './LivePicture.tsx';
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
}: {
  presentation: Pick<Presentation, 'id' | 'name'>;
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
  const remotePolicy = useData(orgRemoteControl, []);
  return (
    <aside className="w-[340px] shrink-0 overflow-y-auto flex flex-col gap-5 p-4 pt-5 bg-surface border-l-[0.5px] border-separator" data-testid="live-panel">
      <LivePicture slide={current} theme={theme} overlay={overlay} black={pointer.black} canStep={canStep} onStep={onStep} onClear={() => live.set({ black: true })} />
      {!!overlays.length && <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />}
      {owner ? <OutputsPanel link={link} sessionId={owner.sessionId} /> : <p className="text-xs text-stone-500 dark:text-stone-400 text-center">{t('remote.onlyOwnerStops')}</p>}
      {owner && remotePolicy && remotePolicy !== 'never' && (
        <div className="mt-auto -mx-2 -mb-2">
          <RemoteStatus id={presentation.id} sessionId={owner.sessionId} name={presentation.name} always={remotePolicy === 'always'} />
        </div>
      )}
    </aside>
  );
}
